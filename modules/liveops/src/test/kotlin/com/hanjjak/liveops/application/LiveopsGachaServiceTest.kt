package com.hanjjak.liveops.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.hanjjak.liveops.domain.LiveopsAccrualPolicy
import com.hanjjak.liveops.domain.LiveopsContent
import com.hanjjak.liveops.domain.LiveopsOutcome
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import com.hanjjak.liveops.domain.LiveopsPrize
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class LiveopsGachaServiceTest {
    private val event = "hunt-ticket-gacha-2026-09"
    private val prizeId = "prize.gifticon.cyburger"
    private val account: UUID = UUID.randomUUID()
    private val other: UUID = UUID.randomUUID()
    private val now: Instant = Instant.parse("2026-10-02T01:00:00Z")

    /** 경품이 반드시 나오는 표. 확률 경로가 아니라 경품 규칙만 보려는 테스트에 쓴다. */
    private fun alwaysPrize() = content(
        listOf(
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 999_999, prizeId = prizeId),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 1, minQuantity = 10, maxQuantity = 100),
        ),
    )

    /** 치장권이 반드시 나오는 표. 지급 합산 검증에 5% 확률을 끌어들이지 않으려고 쓴다. */
    private fun alwaysCosmeticTicket() = content(
        listOf(
            LiveopsOutcome(LiveopsOutcomeKind.COSMETIC_TICKET, 999_999, quantity = 1),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 1, minQuantity = 10, maxQuantity = 100),
        ),
    )

    /** 보석함이 반드시 나오는 표. 가방 확인과 지급 합산을 10% 확률에 기대지 않고 본다. */
    private fun alwaysGemBox(quantity: Long = 1) = content(
        listOf(
            LiveopsOutcome(LiveopsOutcomeKind.GEM_BOX, 999_999, quantity = quantity),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 1, minQuantity = 10, maxQuantity = 100),
        ),
    )

    private fun content(
        outcomes: List<LiveopsOutcome> = listOf(
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = prizeId),
            LiveopsOutcome(LiveopsOutcomeKind.COSMETIC_TICKET, 50_000, quantity = 1),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 949_900, minQuantity = 10, maxQuantity = 100),
        ),
        stock: Long = 5,
        endsAt: Instant = Instant.parse("2026-10-14T15:00:00Z"),
    ) = LiveopsContent(
        "hunt-ticket-gacha-v1", event, "사냥 이벤트 뽑기",
        Instant.parse("2026-09-30T15:00:00Z"), endsAt,
        LiveopsAccrualPolicy(180, 40, 60), outcomes,
        listOf(LiveopsPrize(prizeId, "싸이버거 기프티콘", stock, 1)),
    )

    private class RecordingRice : LiveopsRiceCredit {
        var total = 0L
        var calls = 0
        override fun credit(accountId: UUID, amount: Long, sourceId: UUID) { total += amount; calls += 1 }
    }

    private class RecordingCosmeticTicket : LiveopsCosmeticTicketCredit {
        var total = 0L
        var calls = 0
        override fun credit(accountId: UUID, amount: Long) { total += amount; calls += 1 }
    }

    private class RecordingNotice : LiveopsPrizeNotice {
        val notified = mutableListOf<UUID>()
        override fun notify(accountId: UUID, prizeDisplayName: String, winId: UUID, at: Instant) { notified += accountId }
    }

    /** 가방은 기본적으로 여유가 있다. [capacity] 를 false 로 두면 지급 전 확인이 거부한다. */
    private class RecordingGemBox(var capacity: Boolean = true) : LiveopsGemBoxCredit {
        var total = 0L
        var calls = 0
        var preflighted = 0L
        override fun preflight(accountId: UUID, quantity: Long) {
            preflighted = quantity
            require(capacity) { "INVENTORY_CAPACITY_EXCEEDED" }
        }
        override fun credit(accountId: UUID, quantity: Long) { total += quantity; calls += 1 }
    }

    private val repository = FakeLiveopsRepository()
    private val rice = RecordingRice()
    private val cosmeticTickets = RecordingCosmeticTicket()
    private val gemBoxes = RecordingGemBox()
    private val notice = RecordingNotice()
    private val mapper = ObjectMapper().registerKotlinModule()

    /** 이 테스트들은 잠금 자체를 흉내 내지 않는다 — 잠금 순서는 SQL 로 확인할 대상이라 no-op 이면 충분하다. */
    private val accountLock = LiveopsAccountLock { }

    private fun service(content: LiveopsContent = content()): LiveopsGachaService {
        repository.ensurePrizeStock(event, prizeId, content.prizeOf(prizeId).stock)
        return LiveopsGachaService(
            LiveopsCatalog(content), repository, accountLock, LiveopsPrizeService(repository, notice),
            rice, cosmeticTickets, gemBoxes, mapper, Clock.fixed(now, ZoneOffset.UTC),
        )
    }

    @Test
    fun `보석함은 한 번에 합산해 지급하고 응답에 총량을 싣는다`() {
        val subject = service(alwaysGemBox())
        repository.creditTickets(event, account, 10)

        val response = subject.draw(account, event, 10, UUID.randomUUID())

        assertEquals(10, response.gemBoxesGained)
        assertEquals(10, gemBoxes.total)
        assertEquals(1, gemBoxes.calls, "열 줄을 따로 올리지 않고 한 번에 합쳐 지급한다")
        assertTrue(response.lines.all { it.kind == "GEM_BOX" })
    }

    @Test
    fun `가방이 모자라면 티켓을 쓰기 전에 거부한다`() {
        // 굴림 뒤에 확인하면 보석함이 나오지 않은 회차까지 되돌아가고, 플레이어는 티켓만
        // 쓴 것처럼 보이는 실패를 본다. 티켓 차감 전에 막혀야 한다.
        val subject = service(alwaysGemBox())
        repository.creditTickets(event, account, 10)
        gemBoxes.capacity = false

        val failure = assertFailsWith<IllegalArgumentException> { subject.draw(account, event, 10, UUID.randomUUID()) }

        assertEquals("INVENTORY_CAPACITY_EXCEEDED", failure.message)
        assertEquals(10, repository.ticketBalance(event, account), "거부는 티켓을 쓰지 않는다")
        assertEquals(0, gemBoxes.total)
        assertEquals(0, rice.total)
    }

    @Test
    fun `가방 여유는 회차 수만큼의 최악치로 확인한다`() {
        val subject = service(alwaysGemBox(quantity = 3))
        repository.creditTickets(event, account, 10)

        subject.draw(account, event, 10, UUID.randomUUID())

        assertEquals(30, gemBoxes.preflighted, "10회 × 3개를 미리 확인한다")
    }

    @Test
    fun `보석함 칸이 없는 이벤트는 가방을 확인하지 않는다`() {
        val subject = service(alwaysCosmeticTicket())
        repository.creditTickets(event, account, 10)
        gemBoxes.capacity = false

        subject.draw(account, event, 10, UUID.randomUUID())

        assertEquals(0, gemBoxes.preflighted, "보석함이 없으면 가방 확인 자체를 부르지 않는다")
    }

    @Test
    fun `티켓이 모자라면 한 장도 쓰지 않고 실패한다`() {
        val subject = service()
        repository.creditTickets(event, account, 9)
        assertEquals("INSUFFICIENT_EVENT_TICKETS", assertFailsWith<IllegalArgumentException> { subject.draw(account, event, 10, UUID.randomUUID()) }.message)
        assertEquals(9, repository.ticketBalance(event, account))
        assertEquals(0, rice.total)
    }

    @Test
    fun `뽑은 만큼 티켓을 쓴다`() {
        val subject = service()
        repository.creditTickets(event, account, 12)
        val response = subject.draw(account, event, 10, UUID.randomUUID())
        assertEquals(10, response.ticketCost)
        assertEquals(10, response.lines.size)
        assertEquals(2, response.ticketBalance)
        assertEquals(2, repository.ticketBalance(event, account))
    }

    @Test
    fun `같은 명령 식별자는 결과를 다시 만들지 않는다`() {
        val subject = service()
        repository.creditTickets(event, account, 5)
        val commandId = UUID.randomUUID()
        val first = subject.draw(account, event, 1, commandId)
        val riceAfterFirst = rice.total
        val second = subject.draw(account, event, 1, commandId)
        assertEquals(first, second)
        assertEquals(4, repository.ticketBalance(event, account), "재시도가 티켓을 더 쓰지 않는다")
        assertEquals(riceAfterFirst, rice.total, "재시도가 보상을 다시 주지 않는다")
    }

    @Test
    fun `잠금을 얻는 동안 경쟁한 같은 명령이 이미 저장한 결과를 그대로 돌려준다`() {
        // 멱등 재확인(findDrawResult)이 fast-path 뿐 아니라 잠금을 다 쥔 뒤에도 한 번 더
        // 일어나는지 본다. lockTicketBalance 호출 시점에, 이 잠금을 먼저 얻어 커밋까지 마친
        // 다른 트랜잭션이 있었던 것처럼 흉내 낸다: 티켓을 차감하고 결과를 저장해 둔다.
        // 이 재확인이 없으면 뒤에 온 요청이 다시 추첨을 시도하다 saveDraw 의 유니크 제약을
        // 위반해 500 을 낸다.
        val commandId = UUID.randomUUID()
        val storedResponse = LiveopsDrawResponse(event, 1, 10, 0, 0, 4, listOf(LiveopsDrawLine("RICE", null, null, 10)))
        var triggered = false
        val racing = object : LiveopsRepository by repository {
            override fun lockTicketBalance(eventId: String, accountId: UUID): Long {
                if (!triggered) {
                    triggered = true
                    repository.debitTickets(eventId, accountId, 1)
                    repository.saveDraw(UUID.randomUUID(), eventId, accountId, commandId, "v1", mapper.writeValueAsString(storedResponse), now)
                }
                return repository.lockTicketBalance(eventId, accountId)
            }
        }
        repository.creditTickets(event, account, 5)
        val subject = LiveopsGachaService(
            LiveopsCatalog(content()), racing, accountLock, LiveopsPrizeService(racing, notice),
            rice, cosmeticTickets, gemBoxes, mapper, Clock.fixed(now, ZoneOffset.UTC),
        )

        val result = subject.draw(account, event, 1, commandId)

        assertEquals(storedResponse, result)
        assertEquals(4, repository.ticketBalance(event, account), "재확인에서 걸리면 잔액을 더 건드리지 않는다")
        assertEquals(0, rice.total, "재확인에서 걸리면 보상을 다시 주지 않는다")
    }

    @Test
    fun `당첨 결과도 명령 재시도에서 직렬화를 그대로 복원한다`() {
        // 위 재시도 테스트는 기본 표라 거의 항상 RICE 줄만 저장·복원해, prizeId·경품명 같은
        // null 허용 필드가 실제로 JSON을 오간 적이 없다. 경품이 반드시 나오는 표로 그 경로를 본다.
        val subject = service(alwaysPrize())
        repository.creditTickets(event, account, 1)
        val commandId = UUID.randomUUID()
        val first = subject.draw(account, event, 1, commandId)
        val second = subject.draw(account, event, 1, commandId)
        assertEquals(first, second)
        val prizeLine = second.lines.single()
        assertEquals("PRIZE", prizeLine.kind)
        assertEquals(prizeId, prizeLine.prizeId)
        assertEquals("싸이버거 기프티콘", prizeLine.prizeDisplayName)
    }

    @Test
    fun `비상정지 중에는 뽑을 수 없다`() {
        val subject = service()
        repository.creditTickets(event, account, 5)
        repository.halted = true
        assertEquals("LIVEOPS_EVENT_HALTED", assertFailsWith<IllegalArgumentException> { subject.draw(account, event, 1, UUID.randomUUID()) }.message)
        assertEquals(5, repository.ticketBalance(event, account))
    }

    @Test
    fun `뽑기 횟수는 일 회나 십 회만 허용한다`() {
        val subject = service()
        repository.creditTickets(event, account, 50)
        assertEquals("INVALID_DRAW_COUNT", assertFailsWith<IllegalArgumentException> { subject.draw(account, event, 3, UUID.randomUUID()) }.message)
    }

    @Test
    fun `한 계정은 경품을 한 번만 받고 이후는 쌀로 바뀐다`() {
        val subject = service(alwaysPrize())
        repository.creditTickets(event, account, 10)
        val response = subject.draw(account, event, 10, UUID.randomUUID())
        val prizeLines = response.lines.filter { it.kind == "PRIZE" }
        assertEquals(1, prizeLines.size, "10연차 안에서도 경품은 한 번뿐이다")
        assertEquals("싸이버거 기프티콘", prizeLines.single().prizeDisplayName)
        assertEquals(9, response.lines.count { it.kind == "RICE" }, "나머지는 전부 쌀로 대체된다")
        assertEquals(1, repository.lockPrizeStock(event, prizeId).claimed)
        assertEquals(listOf(account), notice.notified, "당첨 안내는 한 번만 간다")
    }

    @Test
    fun `재고가 떨어지면 다른 계정도 쌀을 받는다`() {
        val subject = service(alwaysPrize().let { content(it.outcomes, stock = 1) })
        repository.creditTickets(event, account, 1)
        repository.creditTickets(event, other, 1)
        assertEquals(1, subject.draw(account, event, 1, UUID.randomUUID()).lines.count { it.kind == "PRIZE" })
        val second = subject.draw(other, event, 1, UUID.randomUUID())
        assertEquals(0, second.lines.count { it.kind == "PRIZE" })
        assertEquals(1, second.lines.count { it.kind == "RICE" })
        assertEquals(1, repository.lockPrizeStock(event, prizeId).claimed, "재고를 넘겨 나가지 않는다")
    }

    @Test
    fun `기간이 끝나면 뽑기는 열려 있고 경품만 빠진다`() {
        // 남은 티켓은 경품만 못 뽑는 재화로 계속 쓴다.
        val ended = content(alwaysPrize().outcomes, endsAt = Instant.parse("2026-10-01T00:00:00Z"))
        val subject = service(ended)
        repository.creditTickets(event, account, 5)
        val response = subject.draw(account, event, 1, UUID.randomUUID())
        assertEquals(0, response.lines.count { it.kind == "PRIZE" })
        assertEquals(1, response.lines.count { it.kind == "RICE" })
        assertEquals(4, response.ticketBalance, "티켓은 여전히 쓰인다")
        assertEquals(0, repository.lockPrizeStock(event, prizeId).claimed)
    }

    @Test
    fun `재고 행이 지워졌다 되살아나도 이미 나간 당첨 수를 되찾는다`() {
        // 운영자가 liveops_prize_stock 행을 지워 지급을 멈추려 한 상황을 흉내낸다 — 정석이
        // 아니라고 LiveopsPorts.kt 가 경고하는 바로 그 경로다. 행이 아예 없던 채로 당첨
        // 두 건이 이미 기록돼 있다가, 다음 뽑기(혹은 화면 조회)가 ensurePrizeStock 을 다시 태운다.
        val winnerA = UUID.randomUUID()
        val winnerB = UUID.randomUUID()
        repository.insertPrizeWin(UUID.randomUUID(), event, prizeId, winnerA, UUID.randomUUID(), now)
        repository.insertPrizeWin(UUID.randomUUID(), event, prizeId, winnerB, UUID.randomUUID(), now)

        repository.ensurePrizeStock(event, prizeId, 5)

        val stock = repository.lockPrizeStock(event, prizeId)
        assertEquals(5, stock.total)
        assertEquals(2, stock.claimed, "0 이 아니라 실제 당첨 두 건을 되살린다")
    }

    @Test
    fun `쌀과 치장권을 합산해 한 번씩만 지급한다`() {
        val subject = service()
        repository.creditTickets(event, account, 10)
        val response = subject.draw(account, event, 10, UUID.randomUUID())
        assertEquals(rice.total, response.riceGained)
        assertEquals(response.lines.filter { it.kind == "RICE" }.sumOf { it.quantity }, response.riceGained)
        assertTrue(response.riceGained > 0)
        assertEquals(1, rice.calls, "쌀 줄이 여럿이어도 지갑은 한 번만 잠근다")

        /* 치장권은 기본 확률(5%)로는 열 번을 뽑아도 약 40%는 한 줄도 안 나와, 위 검증 방식으로는
           우연히 통과하는 셈이 된다. 반드시 나오는 표로 바꾸고, 다른 계정과 별도 이중을 써서
           위 결과와 섞이지 않게 한다. */
        val cosmeticOnlyContent = alwaysCosmeticTicket()
        repository.ensurePrizeStock(event, prizeId, cosmeticOnlyContent.prizeOf(prizeId).stock)
        val cosmeticRice = RecordingRice()
        val cosmeticTicketsOnly = RecordingCosmeticTicket()
        val cosmeticSubject = LiveopsGachaService(
            LiveopsCatalog(cosmeticOnlyContent), repository, accountLock, LiveopsPrizeService(repository, notice),
            cosmeticRice, cosmeticTicketsOnly, gemBoxes, mapper, Clock.fixed(now, ZoneOffset.UTC),
        )
        repository.creditTickets(event, other, 10)
        val cosmeticResponse = cosmeticSubject.draw(other, event, 10, UUID.randomUUID())
        assertEquals(cosmeticTicketsOnly.total, cosmeticResponse.cosmeticTicketsGained)
        assertEquals(cosmeticResponse.lines.filter { it.kind == "COSMETIC_TICKET" }.sumOf { it.quantity }, cosmeticResponse.cosmeticTicketsGained)
        assertTrue(cosmeticResponse.cosmeticTicketsGained > 0)
        assertEquals(1, cosmeticTicketsOnly.calls, "치장권 줄이 여럿이어도 한 번만 지급한다")
    }
}
