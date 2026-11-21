package com.hanjjak.liveops.infrastructure

import com.hanjjak.liveops.application.LiveopsRepository
import org.springframework.jdbc.core.simple.JdbcClient
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

class JdbcLiveopsRepository(private val jdbc: JdbcClient) : LiveopsRepository {
    override fun lockOrCreateAccrual(eventId: String, accountId: UUID, kstDate: LocalDate, now: Instant): LiveopsRepository.AccrualRow {
        /* 새 행의 last_tick_at 은 반드시 지금이다. 자정으로 잡으면 첫 하트비트가 하루치를 인정한다. */
        /* on conflict 의 충돌 대상 열 목록은 H2(PostgreSQL 모드)가 파싱하지 못한다. 이 표에는
           기본키 하나뿐이라 대상을 생략한 on conflict do nothing 으로도 의미가 같다. */
        jdbc.sql(
            """insert into liveops_ticket_accrual(event_id,account_id,kst_date,accrued_seconds,granted_today,last_tick_at)
               values (:event,:account,:date,0,0,:now)
               on conflict do nothing""",
        ).params(mapOf("event" to eventId, "account" to accountId, "date" to kstDate, "now" to utc(now))).update()
        return jdbc.sql(
            """select accrued_seconds,granted_today,last_tick_at from liveops_ticket_accrual
               where event_id=:event and account_id=:account and kst_date=:date for update""",
        ).params(mapOf("event" to eventId, "account" to accountId, "date" to kstDate))
            .query { row, _ ->
                LiveopsRepository.AccrualRow(
                    row.getLong("accrued_seconds"),
                    row.getLong("granted_today"),
                    row.getObject("last_tick_at", OffsetDateTime::class.java).toInstant(),
                )
            }.single()
    }

    override fun saveAccrual(eventId: String, accountId: UUID, kstDate: LocalDate, accruedSeconds: Long, grantedToday: Long, lastTickAt: Instant) {
        jdbc.sql(
            """update liveops_ticket_accrual
               set accrued_seconds=:accrued,granted_today=:granted,last_tick_at=:tick
               where event_id=:event and account_id=:account and kst_date=:date""",
        ).params(
            mapOf(
                "accrued" to accruedSeconds, "granted" to grantedToday, "tick" to utc(lastTickAt),
                "event" to eventId, "account" to accountId, "date" to kstDate,
            ),
        ).update()
    }

    override fun creditTickets(eventId: String, accountId: UUID, amount: Long) {
        require(amount > 0) { "INVALID_TICKET_AMOUNT" }
        /* H2(PostgreSQL 모드)는 on conflict ... do update 를 파싱하지 못한다. 행을 0 잔액으로
           먼저 보장한 뒤 더하는 update 로 나누어도 두 문장 다 원자적이라 합계는 같다. */
        jdbc.sql(
            "insert into liveops_ticket_balance(event_id,account_id,balance) values (:event,:account,0) on conflict do nothing",
        ).params(mapOf("event" to eventId, "account" to accountId)).update()
        val changed = jdbc.sql(
            "update liveops_ticket_balance set balance=balance+:amount where event_id=:event and account_id=:account",
        ).params(mapOf("event" to eventId, "account" to accountId, "amount" to amount)).update()
        require(changed == 1) { "EVENT_TICKET_BALANCE_MISSING" }
    }

    override fun ticketBalance(eventId: String, accountId: UUID): Long = balance(eventId, accountId, lock = false)

    override fun lockTicketBalance(eventId: String, accountId: UUID): Long = balance(eventId, accountId, lock = true)

    private fun balance(eventId: String, accountId: UUID, lock: Boolean): Long {
        val suffix = if (lock) " for update" else ""
        return jdbc.sql("select balance from liveops_ticket_balance where event_id=:event and account_id=:account" + suffix)
            .params(mapOf("event" to eventId, "account" to accountId)).query(Long::class.java).optional().orElse(0L)
    }

    override fun debitTickets(eventId: String, accountId: UUID, amount: Long) {
        require(amount > 0) { "INVALID_TICKET_AMOUNT" }
        /* balance >= 0 제약이 초과 차감을 막는다. 0행이면 잔액이 아니라 행 자체가 없다는 뜻이다. */
        val changed = jdbc.sql(
            "update liveops_ticket_balance set balance=balance-:amount where event_id=:event and account_id=:account",
        ).params(mapOf("amount" to amount, "event" to eventId, "account" to accountId)).update()
        require(changed == 1) { "EVENT_TICKET_BALANCE_MISSING" }
    }

    override fun findDrawResult(eventId: String, accountId: UUID, commandId: UUID): String? = jdbc.sql(
        "select result_json::text from liveops_draw where event_id=:event and account_id=:account and command_id=:command",
    ).params(mapOf("event" to eventId, "account" to accountId, "command" to commandId))
        .query(String::class.java).optional().orElse(null)

    override fun saveDraw(drawId: UUID, eventId: String, accountId: UUID, commandId: UUID, contentVersion: String, resultJson: String, drawnAt: Instant) {
        /* cast(:result as jsonb) 가 필요하다. varchar 바인드는 jsonb 로 암시적 변환되지 않는다. */
        jdbc.sql(
            """insert into liveops_draw(draw_id,event_id,account_id,command_id,content_version,result_json,drawn_at)
               values (:draw,:event,:account,:command,:version,cast(:result as jsonb),:drawn)""",
        ).params(
            mapOf(
                "draw" to drawId, "event" to eventId, "account" to accountId, "command" to commandId,
                "version" to contentVersion, "result" to resultJson, "drawn" to utc(drawnAt),
            ),
        ).update()
    }

    override fun ensurePrizeStock(eventId: String, prizeId: String, total: Long) {
        /* 이미 있으면 총량을 건드리지 않는다. 운영자가 DB 에서 조정한 값을 재시작이 되돌리면
           경품 예산이 조용히 원래대로 돌아간다.
           claimed 는 리터럴 0 이 아니라 liveops_prize_win 의 실제 당첨 행 수에서 시딩한다.
           운영자가 이 행을 지워서 지급을 멈추려 하면(정석은 아니다 — LiveopsPorts.kt 의
           ensurePrizeStock 참고) 다음 뽑기나 화면 조회가 이 insert 를 다시 태운다. claimed 를
           0으로 되살리면 이미 내준 실물 경품 수를 잊고 같은 개수를 다시 내주게 된다. */
        jdbc.sql(
            """insert into liveops_prize_stock(event_id,prize_id,total,claimed)
               values (:event,:prize,:total,(select count(*) from liveops_prize_win where event_id=:event and prize_id=:prize))
               on conflict do nothing""",
        ).params(mapOf("event" to eventId, "prize" to prizeId, "total" to total)).update()
    }

    override fun readPrizeStock(eventId: String, prizeId: String): LiveopsRepository.StockRow = jdbc.sql(
        "select total,claimed from liveops_prize_stock where event_id=:event and prize_id=:prize",
    ).params(mapOf("event" to eventId, "prize" to prizeId))
        .query { row, _ -> LiveopsRepository.StockRow(row.getLong("total"), row.getLong("claimed")) }
        .optional().orElse(LiveopsRepository.StockRow(0, 0))

    override fun readAccrual(eventId: String, accountId: UUID, kstDate: LocalDate): LiveopsRepository.AccrualRow? = jdbc.sql(
        """select accrued_seconds,granted_today,last_tick_at from liveops_ticket_accrual
           where event_id=:event and account_id=:account and kst_date=:date""",
    ).params(mapOf("event" to eventId, "account" to accountId, "date" to kstDate))
        .query { row, _ ->
            LiveopsRepository.AccrualRow(
                row.getLong("accrued_seconds"),
                row.getLong("granted_today"),
                row.getObject("last_tick_at", OffsetDateTime::class.java).toInstant(),
            )
        }.optional().orElse(null)

    override fun lockPrizeStock(eventId: String, prizeId: String): LiveopsRepository.StockRow = jdbc.sql(
        "select total,claimed from liveops_prize_stock where event_id=:event and prize_id=:prize for update",
    ).params(mapOf("event" to eventId, "prize" to prizeId))
        .query { row, _ -> LiveopsRepository.StockRow(row.getLong("total"), row.getLong("claimed")) }
        .optional().orElseThrow { IllegalStateException("LIVEOPS_PRIZE_STOCK_MISSING") }

    override fun incrementPrizeClaimed(eventId: String, prizeId: String) {
        val changed = jdbc.sql(
            "update liveops_prize_stock set claimed=claimed+1 where event_id=:event and prize_id=:prize",
        ).params(mapOf("event" to eventId, "prize" to prizeId)).update()
        require(changed == 1) { "LIVEOPS_PRIZE_STOCK_MISSING" }
    }

    override fun countPrizeWins(eventId: String, prizeId: String, accountId: UUID): Long = jdbc.sql(
        "select count(*) from liveops_prize_win where event_id=:event and prize_id=:prize and account_id=:account",
    ).params(mapOf("event" to eventId, "prize" to prizeId, "account" to accountId)).query(Long::class.java).single()

    /* on conflict 의 충돌 대상 열 목록은 H2(PostgreSQL 모드)가 파싱하지 못한다. 대상을 생략하면
       이 표의 모든 유니크 인덱스(unique(event_id,prize_id,account_id) 와 win_id 기본키)를 함께
       중재한다. win_id 충돌은 호출마다 새 UUID 를 쓰므로 사실상 일어나지 않아 무해하다. */
    override fun insertPrizeWin(winId: UUID, eventId: String, prizeId: String, accountId: UUID, drawId: UUID, wonAt: Instant): Boolean = jdbc.sql(
        """insert into liveops_prize_win(win_id,event_id,prize_id,account_id,draw_id,status,won_at,updated_at)
           values (:win,:event,:prize,:account,:draw,'PENDING',:at,:at)
           on conflict do nothing""",
    ).params(
        mapOf("win" to winId, "event" to eventId, "prize" to prizeId, "account" to accountId, "draw" to drawId, "at" to utc(wonAt)),
    ).update() == 1

    override fun sumGrantedTickets(eventId: String): Long = jdbc.sql(
        "select coalesce(sum(granted_today),0) from liveops_ticket_accrual where event_id=:event",
    ).param("event", eventId).query(Long::class.java).single()

    override fun sumOutstandingTickets(eventId: String): Long = jdbc.sql(
        "select coalesce(sum(balance),0) from liveops_ticket_balance where event_id=:event",
    ).param("event", eventId).query(Long::class.java).single()

    override fun countDraws(eventId: String): Long = jdbc.sql(
        "select count(*) from liveops_draw where event_id=:event",
    ).param("event", eventId).query(Long::class.java).single()

    /* 뽑기 한 행이 최대 열 회차를 담는다. 줄을 펼쳐서 세야 실제 회차 분포가 나온다. */
    override fun outcomeCounts(eventId: String): Map<String, Long> = jdbc.sql(
        """select line->>'kind' as kind, count(*) as total
           from liveops_draw, jsonb_array_elements(result_json->'lines') as line
           where event_id=:event group by 1""",
    ).param("event", eventId).query { row, _ -> row.getString("kind") to row.getLong("total") }.list().toMap()

    override fun listWins(eventId: String, limit: Int): List<LiveopsRepository.WinRow> = jdbc.sql(
        """select win_id,prize_id,account_id,status,operator_note,won_at,updated_at
           from liveops_prize_win where event_id=:event order by won_at desc, win_id desc limit :limit""",
    ).params(mapOf("event" to eventId, "limit" to limit)).query { row, _ ->
        LiveopsRepository.WinRow(
            row.getObject("win_id", UUID::class.java),
            row.getString("prize_id"),
            row.getObject("account_id", UUID::class.java),
            row.getString("status"),
            row.getString("operator_note"),
            row.getObject("won_at", OffsetDateTime::class.java).toInstant(),
            row.getObject("updated_at", OffsetDateTime::class.java).toInstant(),
        )
    }.list()

    override fun setHalted(eventId: String, halted: Boolean, reason: String?, updatedBy: String, at: Instant) {
        jdbc.sql(
            """insert into liveops_switch(event_id,halted,halted_reason,updated_at,updated_by)
               values (:event,:halted,:reason,:at,:by)
               on conflict(event_id) do update set halted=:halted,halted_reason=:reason,updated_at=:at,updated_by=:by""",
        ).params(mapOf("event" to eventId, "halted" to halted, "reason" to reason, "at" to utc(at), "by" to updatedBy)).update()
    }

    override fun updateWinStatus(winId: UUID, status: String, operatorNote: String?, at: Instant): Boolean = jdbc.sql(
        "update liveops_prize_win set status=:status,operator_note=:note,updated_at=:at where win_id=:win",
    ).params(mapOf("status" to status, "note" to operatorNote, "at" to utc(at), "win" to winId)).update() == 1

    override fun ensureSwitch(eventId: String) {
        jdbc.sql(
            """insert into liveops_switch(event_id,halted,updated_at) values (:event,false,now())
               on conflict do nothing""",
        ).param("event", eventId).update()
    }

    /* 스위치 행이 없으면 꺼짐으로 읽는다. 시딩 전에 들어온 요청을 정지로 오해하지 않는다. */
    override fun isHalted(eventId: String): Boolean = jdbc.sql(
        "select halted from liveops_switch where event_id=:event",
    ).param("event", eventId).query(Boolean::class.java).optional().orElse(false)

    private fun utc(instant: Instant): OffsetDateTime = OffsetDateTime.ofInstant(instant, ZoneOffset.UTC)
}
