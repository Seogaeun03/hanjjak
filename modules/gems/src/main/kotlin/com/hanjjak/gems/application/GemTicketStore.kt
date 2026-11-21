package com.hanjjak.gems.application

import com.hanjjak.gems.domain.StoredGemTickets
import org.springframework.jdbc.core.simple.JdbcClient
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/**
 * `gem_account_state` 한 행을 읽고 쓰는 자리.
 *
 * 조회는 [readGemTickets] 만 쓴다 — 행을 만들지도, 잠그지도, 되쓰지도 않는다. 행이 아직
 * 없으면 `null` 을 돌려주고, 그 계정이 무엇을 보아야 하는지는
 * [com.hanjjak.gems.domain.GemDungeonPolicy.ticketBalance] 가 안다.
 *
 * 티켓을 바꾸는 명령만 [lockGemTickets] 로 내려온다. 그쪽은 행이 없으면 최초 지급분으로
 * 만들고 `for update` 로 잠근 뒤, 같은 transaction 에서 [writeGemTickets] 로 마무리한다.
 */
internal fun readGemTickets(jdbc: JdbcClient, accountId: UUID): StoredGemTickets? =
    jdbc.sql("select tickets,last_ticket_at from gem_account_state where account_id=:account")
        .param("account", accountId).query(::mapGemTickets).optional().orElse(null)

internal fun lockGemTickets(jdbc: JdbcClient, accountId: UUID, initialGrant: Int, now: Instant): StoredGemTickets {
    jdbc.sql("insert into gem_account_state(account_id,tickets,last_ticket_at) values (:account,:grant,:now) on conflict(account_id) do nothing")
        .params(mapOf("account" to accountId, "grant" to initialGrant, "now" to Timestamp.from(now))).update()
    return jdbc.sql("select tickets,last_ticket_at from gem_account_state where account_id=:account for update")
        .param("account", accountId).query(::mapGemTickets).single()
}

internal fun writeGemTickets(jdbc: JdbcClient, accountId: UUID, tickets: Int, rechargeAnchor: Instant) {
    jdbc.sql("update gem_account_state set tickets=:tickets,last_ticket_at=:time where account_id=:account")
        .params(mapOf("tickets" to tickets, "time" to Timestamp.from(rechargeAnchor), "account" to accountId)).update()
}

private fun mapGemTickets(row: ResultSet, ignored: Int): StoredGemTickets =
    StoredGemTickets(row.getInt("tickets"), row.getTimestamp("last_ticket_at").toInstant())
