package com.hanjjak.liveops.application

import com.hanjjak.liveops.domain.LiveopsAccrualPolicy
import com.hanjjak.liveops.domain.LiveopsContent
import com.hanjjak.liveops.domain.LiveopsOutcome
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import com.hanjjak.liveops.domain.LiveopsPrize
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class TicketAccrualServiceTest {
    private val account: UUID = UUID.randomUUID()
    private val event = "hunt-ticket-gacha-2026-09"

    private val content = LiveopsContent(
        "hunt-ticket-gacha-v1", event, "사냥 이벤트 뽑기",
        Instant.parse("2026-09-30T15:00:00Z"), Instant.parse("2026-10-14T15:00:00Z"),
        LiveopsAccrualPolicy(180, 40, 60),
        listOf(
            LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 100, prizeId = "prize.gifticon.cyburger"),
            LiveopsOutcome(LiveopsOutcomeKind.COSMETIC_TICKET, 50_000, quantity = 1),
            LiveopsOutcome(LiveopsOutcomeKind.RICE, 949_900, minQuantity = 10, maxQuantity = 100),
        ),
        listOf(LiveopsPrize("prize.gifticon.cyburger", "싸이버거 기프티콘", 5, 1)),
    )

    private class MovableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
        fun advance(seconds: Long) { now = now.plusSeconds(seconds) }
    }

    private val clock = MovableClock(Instant.parse("2026-10-02T01:00:00Z"))
    private val repository = FakeLiveopsRepository()
    private val service = TicketAccrualService(LiveopsCatalog(content), repository, clock)

    private fun tickets() = repository.ticketBalance(event, account)

    /** 하트비트를 [times] 번, 매번 [seconds] 초 간격으로 보낸다. */
    private fun heartbeat(times: Int, seconds: Long) = repeat(times) {
        clock.advance(seconds)
        service.accrueForHeartbeat(account)
    }

    @Test
    fun `첫 하트비트는 지나간 시간을 소급 인정하지 않는다`() {
        service.accrueForHeartbeat(account)
        assertEquals(0, tickets())
    }

    @Test
    fun `삼 분마다 한 장을 준다`() {
        service.accrueForHeartbeat(account) // 기준점만 만든다
        heartbeat(times = 5, seconds = 30) // 150초
        assertEquals(0, tickets())
        heartbeat(times = 1, seconds = 30) // 180초
        assertEquals(1, tickets())
        heartbeat(times = 12, seconds = 30) // 누적 540초
        assertEquals(3, tickets())
    }

    @Test
    fun `십 초 미만 간격은 인정하지 않고 시간을 버리지도 않는다`() {
        service.accrueForHeartbeat(account) // 기준점만 만든다
        val kstDate = LocalDate.parse("2026-10-02")
        val baseline = repository.accrual(event, account, kstDate)

        // 문턱(10초) 아래인 5초 호출은 저장 없이 돌아간다 — accruedSeconds 와 lastTickAt 이
        // 그대로임을 직접 확인한다. 문턱이 없었다면 accruedSeconds 는 5로 늘었을 것이다.
        heartbeat(times = 1, seconds = 5)
        val afterBelowFloor = repository.accrual(event, account, kstDate)
        assertEquals(0, afterBelowFloor.accruedSeconds, "문턱 아래 호출은 초를 쌓지 않는다")
        assertEquals(baseline.lastTickAt, afterBelowFloor.lastTickAt, "문턱 아래 호출은 기준점을 옮기지 않는다")
        assertEquals(0, tickets())

        // 기준점이 그대로라 두 번째 5초 호출은 (옮겨지지 않은 기준점 기준) 10초 간격으로
        // 인정되어, 앞서 저장되지 않았던 시간이 이번 호출에서 함께 등록된다 — 시간을 버리지
        // 않는다는 뜻이다.
        heartbeat(times = 1, seconds = 5)
        val afterSecondBeat = repository.accrual(event, account, kstDate)
        assertEquals(10, afterSecondBeat.accruedSeconds, "버려지지 않은 시간이 다음 호출에서 인정된다")
        assertEquals(0, tickets())

        // 문턱을 넘는 호출이 계속 이어지면 이렇게 쌓인 초는 정상적으로 한 장(180초)까지 이어진다.
        heartbeat(times = 3, seconds = 60)
        assertEquals(1, tickets())
    }

    @Test
    fun `끊겼다 돌아온 구간은 육십 초까지만 인정한다`() {
        service.accrueForHeartbeat(account)
        // 한 시간을 통째로 인정하면 즉시 20장이 된다. 상한이 그것을 60초로 자른다.
        heartbeat(times = 1, seconds = 3_600)
        assertEquals(0, tickets())
        heartbeat(times = 2, seconds = 60)
        assertEquals(1, tickets())
    }

    @Test
    fun `일일 상한에서 멈추고 남은 초를 버린다`() {
        service.accrueForHeartbeat(account)
        // 60초씩 충분히 많이 보낸다. 상한 40장은 7,200초에 해당한다.
        heartbeat(times = 200, seconds = 60)
        assertEquals(40, tickets())
        val row = repository.accrual(event, account, LocalDate.parse("2026-10-02"))
        assertEquals(0, row.accruedSeconds, "상한에 닿으면 잔여 초를 다음으로 넘기지 않는다")
        heartbeat(times = 50, seconds = 60)
        assertEquals(40, tickets(), "같은 날에는 더 늘지 않는다")
    }

    @Test
    fun `KST 자정을 넘기면 상한이 초기화된다`() {
        service.accrueForHeartbeat(account)
        heartbeat(times = 200, seconds = 60)
        assertEquals(40, tickets())
        // 2026-10-02T15:00:00Z 가 2026-10-03 00:00 KST 다. 그 뒤로 넘긴다.
        clock.now = Instant.parse("2026-10-02T15:30:00Z")
        service.accrueForHeartbeat(account) // 새 날짜 행의 기준점
        heartbeat(times = 10, seconds = 60)
        assertEquals(43, tickets(), "새 날에는 다시 쌓인다")
    }

    @Test
    fun `기간 밖에서는 적립하지 않는다`() {
        clock.now = Instant.parse("2026-10-14T15:00:00Z") // endsAt 은 제외 경계다
        service.accrueForHeartbeat(account)
        heartbeat(times = 10, seconds = 60)
        assertEquals(0, tickets())
    }

    @Test
    fun `비상정지 중에는 적립하지 않는다`() {
        service.accrueForHeartbeat(account)
        repository.halted = true
        heartbeat(times = 10, seconds = 60)
        assertEquals(0, tickets())
        repository.halted = false
        heartbeat(times = 4, seconds = 60)
        assertEquals(1, tickets(), "정지가 풀리면 다시 쌓는다")
    }
}
