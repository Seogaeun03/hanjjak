package com.hanjjak.gameapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.account.application.LiveopsAccrualLifecycle
import com.hanjjak.liveops.application.LiveopsAccountLock
import com.hanjjak.liveops.application.LiveopsCatalog
import com.hanjjak.liveops.application.LiveopsDrawResponse
import com.hanjjak.liveops.application.LiveopsGachaService
import com.hanjjak.liveops.application.LiveopsGemBoxCredit
import com.hanjjak.liveops.application.LiveopsPrizeService
import com.hanjjak.liveops.application.LiveopsRepository
import com.hanjjak.liveops.application.LiveopsStateService
import com.hanjjak.liveops.domain.LiveopsOutcome
import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 실제 Flyway 스키마·실제 콘텐츠 파일·실제 빈 배선으로 돈다. 모듈 테스트가 H2 와 가짜
 * 저장소로 본 규칙이 진짜 환경에서도 성립하는지 확인하는 자리다.
 */
@GameApiIntegrationTest
class LiveopsGachaIntegrationTest {
    @Autowired private lateinit var jdbc: JdbcClient
    @Autowired private lateinit var catalog: LiveopsCatalog
    @Autowired private lateinit var repository: LiveopsRepository
    @Autowired private lateinit var gacha: LiveopsGachaService
    @Autowired private lateinit var accountLock: LiveopsAccountLock
    @Autowired private lateinit var prizeService: LiveopsPrizeService
    @Autowired private lateinit var state: LiveopsStateService
    @Autowired private lateinit var accrual: LiveopsAccrualLifecycle
    @Autowired private lateinit var transactionManager: PlatformTransactionManager
    /* 애플리케이션 빈을 쓴다. 직접 만들면 jackson-module-kotlin 이 game-api 테스트 컴파일
       클래스패스에 있는지에 결과가 달라진다(모듈들이 implementation 으로 들고 있어 전이되지 않는다). */
    @Autowired private lateinit var mapper: ObjectMapper

    private val eventId get() = catalog.current().eventId
    private val prizeId get() = catalog.current().prizes.single().prizeId

    private fun newAccount(): UUID {
        val accountId = UUID.randomUUID()
        jdbc.sql("insert into account(id,email,password_hash,state_version,created_at) values (:id,:email,'x',1,now())")
            .params(mapOf("id" to accountId, "email" to "liveops-$accountId@example.com")).update()
        jdbc.sql("insert into character(id,account_id,level,experience,rice,nickname) values (:character,:account,1,0,0,:nickname)")
            .params(mapOf("character" to UUID.randomUUID(), "account" to accountId, "nickname" to "liveops-${accountId.toString().take(8)}")).update()
        return accountId
    }

    private fun cosmeticTickets(accountId: UUID): Long = jdbc.sql("select cosmetic_ticket_balance from character where account_id=:account")
        .param("account", accountId).query(Long::class.java).single()

    @Test
    fun `실제 스키마에서 뽑기가 티켓을 쓰고 결과를 남긴다`() {
        val accountId = newAccount()
        repository.creditTickets(eventId, accountId, 10)
        val response = gacha.draw(accountId, eventId, 10, UUID.randomUUID())
        assertEquals(10, response.lines.size)
        assertEquals(0, response.ticketBalance)
        assertEquals(response.riceGained, response.lines.filter { it.kind == "RICE" }.sumOf { it.quantity })
        assertEquals(response.cosmeticTicketsGained, cosmeticTickets(accountId))
        val stored = jdbc.sql("select count(*) from liveops_draw where event_id=:event and account_id=:account")
            .params(mapOf("event" to eventId, "account" to accountId)).query(Long::class.java).single()
        assertEquals(1, stored, "열 회차가 한 행으로 저장된다")
    }

    @Test
    fun `같은 멱등 키 재요청이 티켓을 두 번 쓰지 않는다`() {
        val accountId = newAccount()
        repository.creditTickets(eventId, accountId, 3)
        val commandId = UUID.randomUUID()
        val first = gacha.draw(accountId, eventId, 1, commandId)
        val second = gacha.draw(accountId, eventId, 1, commandId)
        assertEquals(first, second)
        assertEquals(2, repository.ticketBalance(eventId, accountId))
    }

    @Test
    fun `같은 명령이 동시에 들어와도 잠금 경합에서 재추첨하지 않는다`() {
        /* account 잠금을 가장 먼저 잡도록 순서를 고친 뒤에도, 같은 idempotency 키의 동시
           요청은 안전해야 한다. 잠금을 기다리다 깨어난 쪽은 재추첨을 시도하는 대신 먼저
           커밋된 결과를 그대로 받아야 한다 — 그러지 못하면 saveDraw 의
           unique(event_id,account_id,command_id) 위반이 bare 500 으로 샌다. */
        val accountId = newAccount()
        repository.creditTickets(eventId, accountId, 10)
        val commandId = UUID.randomUUID()
        val pool = Executors.newFixedThreadPool(5)
        val results = java.util.Collections.synchronizedList(mutableListOf<Result<LiveopsDrawResponse>>())
        repeat(5) {
            pool.submit { results += runCatching { gacha.draw(accountId, eventId, 1, commandId) } }
        }
        pool.shutdown()
        assertTrue(pool.awaitTermination(60, TimeUnit.SECONDS))

        assertTrue(results.all { it.isSuccess }, "동시 재시도 중 하나도 실패하면 안 된다: ${results.map { it.exceptionOrNull()?.message }}")
        assertEquals(1, results.mapNotNull { it.getOrNull() }.distinct().size, "모두 같은 결과를 받는다")
        assertEquals(9, repository.ticketBalance(eventId, accountId), "티켓은 딱 한 번만 소비된다")
    }

    @Test
    fun `동시 뽑기가 재고를 초과해 당첨시키지 않는다`() {
        /* 실제 확률표(0.01%)로는 100회차를 돌려도 경품이 거의 안 나와서, 잠금이 깨져 있어도
           테스트가 통과한다. 그래서 경품이 반드시 나오는 표를 만들어 진짜 저장소·진짜 행
           잠금에 부딪히게 한다. 바꾸는 것은 확률뿐이고 eventId·경품은 그대로다. */
        val real = catalog.current()
        val alwaysPrize = real.copy(
            outcomes = listOf(
                LiveopsOutcome(LiveopsOutcomeKind.PRIZE, 999_999, prizeId = prizeId),
                LiveopsOutcome(LiveopsOutcomeKind.RICE, 1, minQuantity = 10, maxQuantity = 100),
            ),
        )
        /* 손으로 만든 서비스에는 Spring 트랜잭션 프록시가 없다. TransactionTemplate 로
           감싸야 `for update` 가 의미를 갖는다. 감싸지 않으면 매 SQL 이 자동 커밋돼
           잠금 검증이 통째로 헛돈다.
           경품 지급 쪽은 자동주입된 진짜 LiveopsPrizeService 빈을 그대로 쓴다 — 그래야
           MailLiveopsPrizeNotice 의 11열 insert 와 outbox 발행이 이 테스트에서 실제로 돈다.
           손으로 만든 no-op 안내는 그 SQL 에 아무 실행 경로를 남기지 않는다. */
        val contended = LiveopsGachaService(
            LiveopsCatalog(alwaysPrize), repository, accountLock,
            prizeService,
            /* 이 표에는 보석함 칸이 없어 가방 확인도 지급도 일어나지 않는다. 포트는 메서드가
               둘이라 람다로 줄일 수 없으므로 아무것도 하지 않는 객체를 넘긴다. */
            { _, _, _ -> }, { _, _ -> },
            object : LiveopsGemBoxCredit {
                override fun preflight(accountId: UUID, quantity: Long) = Unit
                override fun credit(accountId: UUID, quantity: Long) = Unit
            },
            mapper, Clock.systemUTC(),
        )

        jdbc.sql("delete from liveops_prize_win where event_id=:event").param("event", eventId).update()
        /* 다음 줄은 raw UPDATE 라 행이 이미 있어야 값이 먹는다. 운영 경로(LiveopsPrizeService.
           isGrantable)는 draw 안에서만 행을 만드는데, 그건 이 UPDATE 보다 뒤에 일어난다.
           GameApiIntegrationTestListener 가 반마다 전체 표를 truncate 하므로 이 반이 컨텍스트를
           처음 띄운 반이 아니면 이 시점엔 행이 없다 — 값은 상관없다, 바로 다음 줄이 덮어쓴다. */
        repository.ensurePrizeStock(eventId, prizeId, real.prizeOf(prizeId).stock)
        jdbc.sql("update liveops_prize_stock set total=1,claimed=0 where event_id=:event and prize_id=:prize")
            .params(mapOf("event" to eventId, "prize" to prizeId)).update()

        val accounts = (1..10).map { newAccount() }
        accounts.forEach { repository.creditTickets(eventId, it, 10) }
        val template = TransactionTemplate(transactionManager)
        val pool = Executors.newFixedThreadPool(10)
        accounts.forEach { accountId ->
            pool.submit { runCatching { template.execute { contended.draw(accountId, eventId, 10, UUID.randomUUID()) } } }
        }
        pool.shutdown()
        assertTrue(pool.awaitTermination(60, TimeUnit.SECONDS))

        val stock = repository.readPrizeStock(eventId, prizeId)
        assertEquals(1, stock.claimed, "재고 1개가 정확히 한 번만 나간다")
        val wins = jdbc.sql("select count(*) from liveops_prize_win where event_id=:event").param("event", eventId).query(Long::class.java).single()
        assertEquals(1, wins, "당첨 행도 하나뿐이다")

        /* 진짜 MailLiveopsPrizeNotice(11열 insert·outbox 발행)가 실제로 돌았는지 본다.
           손으로 만든 no-op 안내를 쓰던 예전 버전은 이 두 표를 전혀 건드리지 않아
           통과했다 — 여기서 막는다. */
        val winnerAccountId = jdbc.sql("select account_id from liveops_prize_win where event_id=:event")
            .param("event", eventId).query(UUID::class.java).single()
        val mailCount = jdbc.sql("select count(*) from mail_message where account_id=:account and type='LIVEOPS_PRIZE'")
            .param("account", winnerAccountId).query(Long::class.java).single()
        assertEquals(1, mailCount, "당첨 계정에 경품 안내 우편이 정확히 하나 온다")
        val outboxCount = jdbc.sql("select count(*) from outbox_event where event_type='LIVEOPS_PRIZE_WON' and aggregate_id=:account")
            .param("account", winnerAccountId).query(Long::class.java).single()
        assertEquals(1, outboxCount, "당첨 아웃박스 이벤트도 하나뿐이다")
    }

    @Test
    fun `비상정지가 뽑기와 적립을 함께 막는다`() {
        val accountId = newAccount()
        repository.creditTickets(eventId, accountId, 5)
        /* 마찬가지로 raw UPDATE 앞에서 행을 보장한다 — 없으면 이 UPDATE 가 0행에 적용되어
           halted 가 조용히 false 로 남는다. */
        repository.ensureSwitch(eventId)
        jdbc.sql("update liveops_switch set halted=true where event_id=:event").param("event", eventId).update()
        try {
            assertTrue(runCatching { gacha.draw(accountId, eventId, 1, UUID.randomUUID()) }.isFailure)
            assertEquals(5, repository.ticketBalance(eventId, accountId))
            assertTrue(state.state(accountId, eventId).halted)
        } finally {
            jdbc.sql("update liveops_switch set halted=false where event_id=:event").param("event", eventId).update()
        }
    }

    @Test
    fun `하트비트 경로가 적립 서비스에 연결되어 있다`() {
        // 첫 호출은 기준점만 만든다. 행이 생기면 배선이 살아 있다는 뜻이다.
        // 기간은 test-window-open 속성이 열어 두므로 콘텐츠 날짜에 흔들리지 않는다.
        val accountId = newAccount()
        accrual.accrueForHeartbeat(accountId)
        val rows = jdbc.sql("select count(*) from liveops_ticket_accrual where event_id=:event and account_id=:account")
            .params(mapOf("event" to eventId, "account" to accountId)).query(Long::class.java).single()
        assertEquals(1, rows)
    }

    @Test
    fun `상태 조회가 확률표와 재고를 전부 내려 준다`() {
        val accountId = newAccount()
        val view = state.state(accountId, eventId)
        assertEquals(eventId, view.eventId)
        /* 콘텐츠에서 가져온다. 일정이 바뀔 때마다 깨지는 리터럴 대신, 상태 조회가 설정값을
           그대로 반영하는지를 본다. 실제 값은 JsonLiveopsContentTest 가 고정한다. */
        assertEquals(catalog.current().accrual.dailyCap, view.dailyCap)
        assertEquals(catalog.current().accrual.secondsPerTicket, view.secondsPerTicket)
        assertTrue(view.outcomes.isNotEmpty())
        assertEquals(1_000_000, view.outcomes.sumOf { it.millionths }, "화면에 보이는 확률 합도 백만이다")
        assertEquals(1, view.prizes.size)
        assertTrue(view.prizes.single().remaining >= 0)
    }
}
