package com.hanjjak.liveops.infrastructure

import com.hanjjak.liveops.application.LiveopsRepository
import org.h2.jdbcx.JdbcDataSource
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * H2 에는 jsonb 가 없어 result_json 을 text 로 만든다. 실제 Flyway 스키마가 도는지는
 * game-api 통합 테스트가 본다. 여기서는 SQL 의 의미(잠금 대상, 상한, 멱등)만 확인한다.
 */
class JdbcLiveopsRepositoryTest {
    private val event = "hunt-ticket-gacha-2026-09"
    private val prize = "prize.gifticon.cyburger"
    private val account: UUID = UUID.randomUUID()
    private val now: Instant = Instant.parse("2026-10-02T03:00:00Z")
    private val jdbc = JdbcClient.create(
        JdbcDataSource().apply { setURL("jdbc:h2:mem:liveops" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1") },
    )
    private val repository: LiveopsRepository = JdbcLiveopsRepository(jdbc)

    init {
        // H2 에는 jsonb 가 없다. 운영 SQL 의 cast 를 그대로 쓰기 위해 같은 이름의 도메인을 만든다.
        jdbc.sql("create domain if not exists jsonb as varchar;").update()
        jdbc.sql(
            """create table liveops_ticket_accrual(
                 event_id varchar(80) not null, account_id uuid not null, kst_date date not null,
                 accrued_seconds bigint not null default 0, granted_today bigint not null default 0,
                 last_tick_at timestamp with time zone not null,
                 primary key(event_id, account_id, kst_date))""",
        ).update()
        jdbc.sql(
            """create table liveops_ticket_balance(
                 event_id varchar(80) not null, account_id uuid not null,
                 balance bigint not null default 0 check (balance >= 0),
                 primary key(event_id, account_id))""",
        ).update()
        jdbc.sql(
            """create table liveops_draw(
                 draw_id uuid primary key, event_id varchar(80) not null, account_id uuid not null,
                 command_id uuid not null, content_version varchar(80) not null, result_json jsonb not null,
                 drawn_at timestamp with time zone not null,
                 unique(event_id, account_id, command_id))""",
        ).update()
        jdbc.sql(
            """create table liveops_prize_stock(
                 event_id varchar(80) not null, prize_id varchar(120) not null,
                 total bigint not null, claimed bigint not null default 0,
                 primary key(event_id, prize_id), check (claimed <= total))""",
        ).update()
        jdbc.sql(
            """create table liveops_prize_win(
                 win_id uuid primary key, event_id varchar(80) not null, prize_id varchar(120) not null,
                 account_id uuid not null, draw_id uuid not null,
                 status varchar(16) not null default 'PENDING', operator_note varchar(500),
                 won_at timestamp with time zone not null, updated_at timestamp with time zone not null,
                 unique(event_id, prize_id, account_id))""",
        ).update()
        jdbc.sql(
            """create table liveops_switch(
                 event_id varchar(80) primary key, halted boolean not null default false,
                 halted_reason varchar(500), updated_at timestamp with time zone not null,
                 updated_by varchar(120))""",
        ).update()
    }

    @Test
    fun `첫 적립 행은 지금 시각을 기준으로 만든다`() {
        // 새 행의 last_tick_at 이 자정이나 접속 시각이면 첫 하트비트가 지나간 시간을 소급 인정한다.
        val row = repository.lockOrCreateAccrual(event, account, LocalDate.parse("2026-10-02"), now)
        assertEquals(0, row.accruedSeconds)
        assertEquals(0, row.grantedToday)
        assertEquals(now, row.lastTickAt)
    }

    @Test
    fun `적립 행을 저장하고 다시 읽는다`() {
        val date = LocalDate.parse("2026-10-02")
        repository.lockOrCreateAccrual(event, account, date, now)
        repository.saveAccrual(event, account, date, accruedSeconds = 45, grantedToday = 3, lastTickAt = now.plusSeconds(120))
        val row = repository.lockOrCreateAccrual(event, account, date, now.plusSeconds(600))
        assertEquals(45, row.accruedSeconds)
        assertEquals(3, row.grantedToday)
        assertEquals(now.plusSeconds(120), row.lastTickAt)
    }

    @Test
    fun `티켓을 올리고 내린다`() {
        repository.creditTickets(event, account, 5)
        repository.creditTickets(event, account, 3)
        assertEquals(8, repository.ticketBalance(event, account))
        assertEquals(8, repository.lockTicketBalance(event, account))
        repository.debitTickets(event, account, 8)
        assertEquals(0, repository.ticketBalance(event, account))
    }

    @Test
    fun `없는 계정의 티켓 잔액은 영이다`() {
        assertEquals(0, repository.ticketBalance(event, UUID.randomUUID()))
        assertEquals(0, repository.lockTicketBalance(event, UUID.randomUUID()))
    }

    @Test
    fun `잔액보다 많이 내리면 제약이 막는다`() {
        repository.creditTickets(event, account, 2)
        assertFailsWith<org.springframework.dao.DataIntegrityViolationException> { repository.debitTickets(event, account, 3) }
    }

    @Test
    fun `같은 명령 식별자의 뽑기 결과를 다시 준다`() {
        val commandId = UUID.randomUUID()
        assertNull(repository.findDrawResult(event, account, commandId))
        repository.saveDraw(UUID.randomUUID(), event, account, commandId, "hunt-ticket-gacha-v1", "{\"count\":1}", now)
        assertEquals("{\"count\":1}", repository.findDrawResult(event, account, commandId))
    }

    @Test
    fun `재고를 시딩하고 이미 있으면 총량을 덮어쓰지 않는다`() {
        repository.ensurePrizeStock(event, prize, 5)
        repository.incrementPrizeClaimed(event, prize)
        // 운영자가 DB 에서 총량을 조정했을 수 있다. 재시작이 그것을 되돌리면 안 된다.
        repository.ensurePrizeStock(event, prize, 99)
        val stock = repository.lockPrizeStock(event, prize)
        assertEquals(5, stock.total)
        assertEquals(1, stock.claimed)
    }

    @Test
    fun `재고를 넘겨 올리면 제약이 막는다`() {
        repository.ensurePrizeStock(event, prize, 1)
        repository.incrementPrizeClaimed(event, prize)
        assertFailsWith<org.springframework.dao.DataIntegrityViolationException> { repository.incrementPrizeClaimed(event, prize) }
    }

    @Test
    fun `같은 계정의 당첨은 한 번만 기록된다`() {
        val drawId = UUID.randomUUID()
        repository.saveDraw(drawId, event, account, UUID.randomUUID(), "hunt-ticket-gacha-v1", "{}", now)
        assertEquals(0, repository.countPrizeWins(event, prize, account))
        assertTrue(repository.insertPrizeWin(UUID.randomUUID(), event, prize, account, drawId, now))
        assertEquals(1, repository.countPrizeWins(event, prize, account))
        // 두 번째 시도는 예외가 아니라 false 다. 호출자가 사고를 식별해 되돌릴 수 있어야 한다.
        assertFalse(repository.insertPrizeWin(UUID.randomUUID(), event, prize, account, drawId, now))
        assertEquals(1, repository.countPrizeWins(event, prize, account))
    }

    @Test
    fun `비상정지 기본값은 꺼짐이고 행이 없어도 꺼짐이다`() {
        assertFalse(repository.isHalted(event))
        repository.ensureSwitch(event)
        assertFalse(repository.isHalted(event))
        jdbc.sql("update liveops_switch set halted=true where event_id=:event").param("event", event).update()
        assertTrue(repository.isHalted(event))
    }
}
