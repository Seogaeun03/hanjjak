package com.hanjjak.wallet.infrastructure

import com.hanjjak.wallet.application.WalletCreditEntry
import com.hanjjak.wallet.application.WalletDebitEntry
import com.hanjjak.wallet.application.WalletRepository
import org.springframework.jdbc.core.simple.JdbcClient
import java.util.UUID

/**
 * 한 문장에 담는 ledger 행 수 상한이다. 한 요청이 체결을 아무리 많이 만들어도
 * bind 파라미터 수가 PostgreSQL 한계에 닿지 않도록 이 크기로 나눠 넣는다.
 */
internal const val WALLET_LEDGER_BATCH_SIZE = 100

class JdbcWalletRepository(private val jdbc: JdbcClient, private val batchLedgerInsert: Boolean = true) : WalletRepository {
    override fun balance(accountId: UUID): Long = jdbc.sql("select balance from wallet_balance where account_id=:account")
        .param("account", accountId)
        .query(Long::class.java)
        .optional()
        .orElseThrow { IllegalArgumentException("WALLET_NOT_FOUND") }

    override fun lockBalance(accountId: UUID): Long = jdbc.sql("select balance from wallet_balance where account_id=:account for update")
        .param("account", accountId)
        .query(Long::class.java)
        .optional()
        .orElseThrow { IllegalArgumentException("WALLET_NOT_FOUND") }

    override fun applyBatchedDebit(accountId: UUID, entries: List<WalletDebitEntry>, bumpStateVersion: Boolean): Long {
        if (entries.isEmpty()) return lockBalance(accountId)
        val total = entries.sumOf { it.amount }
        // 잔액은 총액으로 한 번만 줄인다. 음수 방지 조건은 건별 차감 때와 같은 자리에 그대로 둔다.
        val updated = jdbc.sql("update wallet_balance set balance=balance-:total, updated_at=now() where account_id=:account and balance-:total>=0 returning balance")
            .params(mapOf("account" to accountId, "total" to total))
            .query(Long::class.java)
            .optional()
            .orElseThrow { IllegalArgumentException("INSUFFICIENT_RICE") }
        insertLedger(accountId, updated + total, entries.map { -it.amount to (it.sourceType to it.sourceId) })
        bumpStateVersion(accountId, bumpStateVersion)
        return updated
    }

    override fun applyBatchedCredit(accountId: UUID, entries: List<WalletCreditEntry>, bumpStateVersion: Boolean): Long {
        if (entries.isEmpty()) return lockBalance(accountId)
        val total = entries.sumOf { it.amount }
        // 지급도 총액으로 한 번만 늘린다. 차감과 같은 자리에 같은 조건을 둔다.
        val updated = jdbc.sql("update wallet_balance set balance=balance+:total, updated_at=now() where account_id=:account and balance+:total>=0 returning balance")
            .params(mapOf("account" to accountId, "total" to total))
            .query(Long::class.java)
            .optional()
            .orElseThrow { IllegalArgumentException("INSUFFICIENT_RICE") }
        insertLedger(accountId, updated - total, entries.map { it.amount to (it.sourceType to it.sourceId) })
        bumpStateVersion(accountId, bumpStateVersion)
        return updated
    }

    private fun bumpStateVersion(accountId: UUID, enabled: Boolean) {
        if (!enabled) return
        jdbc.sql("update account set state_version=state_version+1 where id=:account")
            .param("account", accountId)
            .update()
    }

    private fun insertLedger(accountId: UUID, balanceBefore: Long, deltas: List<Pair<Long, Pair<String, UUID>>>) {
        var running = balanceBefore
        if (batchLedgerInsert) {
            deltas.chunked(WALLET_LEDGER_BATCH_SIZE).forEach { chunk ->
                val statement = WalletLedgerBatchInsert.build(accountId, running, chunk)
                jdbc.sql(statement.sql).params(statement.params).update()
                running += chunk.sumOf { it.first }
            }
            return
        }
        deltas.forEach { (delta, source) ->
            running += delta
            jdbc.sql("insert into wallet_ledger(ledger_id,account_id,delta,balance_after,source_type,source_id,created_at) values (:ledger,:account,:delta,:balance,:sourceType,:sourceId,now())")
                .params(mapOf("ledger" to UUID.randomUUID(), "account" to accountId, "delta" to delta, "balance" to running, "sourceType" to source.first, "sourceId" to source.second))
                .update()
        }
    }

    override fun applyDelta(accountId: UUID, delta: Long, sourceType: String, sourceId: UUID, bumpStateVersion: Boolean): Long {
        val updated = jdbc.sql("update wallet_balance set balance=balance+:delta, updated_at=now() where account_id=:account and balance+:delta>=0 returning balance")
            .params(mapOf("account" to accountId, "delta" to delta))
            .query(Long::class.java)
            .optional()
            .orElseThrow { IllegalArgumentException("INSUFFICIENT_RICE") }
        jdbc.sql("insert into wallet_ledger(ledger_id,account_id,delta,balance_after,source_type,source_id,created_at) values (:ledger,:account,:delta,:balance,:sourceType,:sourceId,now())")
            .params(mapOf("ledger" to UUID.randomUUID(), "account" to accountId, "delta" to delta, "balance" to updated, "sourceType" to sourceType, "sourceId" to sourceId))
            .update()
        bumpStateVersion(accountId, bumpStateVersion)
        return updated
    }
}

internal data class WalletLedgerBatchStatement(val sql: String, val params: Map<String, Any>)

internal object WalletLedgerBatchInsert {
    fun buildDebit(accountId: UUID, balanceBefore: Long, entries: List<WalletDebitEntry>): WalletLedgerBatchStatement {
        require(entries.isNotEmpty()) { "EMPTY_DEBIT_ENTRIES" }
        return build(accountId, balanceBefore, entries.map { -it.amount to (it.sourceType to it.sourceId) })
    }

    fun buildCredit(accountId: UUID, balanceBefore: Long, entries: List<WalletCreditEntry>): WalletLedgerBatchStatement {
        require(entries.isNotEmpty()) { "EMPTY_CREDIT_ENTRIES" }
        return build(accountId, balanceBefore, entries.map { it.amount to (it.sourceType to it.sourceId) })
    }

    fun build(accountId: UUID, balanceBefore: Long, deltas: List<Pair<Long, Pair<String, UUID>>>): WalletLedgerBatchStatement {
        require(deltas.isNotEmpty()) { "EMPTY_LEDGER_ENTRIES" }
        val params = mutableMapOf<String, Any>()
        var running = balanceBefore
        val values = deltas.mapIndexed { index, (delta, source) ->
            running = Math.addExact(running, delta)
            params["ledger$index"] = UUID.randomUUID()
            params["account$index"] = accountId
            params["delta$index"] = delta
            params["balance$index"] = running
            params["sourceType$index"] = source.first
            params["sourceId$index"] = source.second
            "(cast(:ledger$index as uuid), cast(:account$index as uuid), cast(:delta$index as bigint), cast(:balance$index as bigint), cast(:sourceType$index as varchar), cast(:sourceId$index as uuid), now())"
        }.joinToString(",")
        return WalletLedgerBatchStatement(
            "insert into wallet_ledger(ledger_id,account_id,delta,balance_after,source_type,source_id,created_at) values $values",
            params,
        )
    }
}
