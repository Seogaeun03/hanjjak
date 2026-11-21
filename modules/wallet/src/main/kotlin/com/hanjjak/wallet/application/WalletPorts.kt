package com.hanjjak.wallet.application

import java.util.UUID

data class WalletDebitEntry(val amount: Long, val sourceType: String, val sourceId: UUID)
data class WalletCreditEntry(val amount: Long, val sourceType: String, val sourceId: UUID)

interface WalletRepository {
    fun balance(accountId: UUID): Long = lockBalance(accountId)
    fun lockBalance(accountId: UUID): Long
    /** bumpStateVersion=false면 account.state_version 증가를 호출자에게 맡긴다. (실험용) */
    fun applyDelta(accountId: UUID, delta: Long, sourceType: String, sourceId: UUID, bumpStateVersion: Boolean = true): Long

    /**
     * 여러 건을 한 번에 차감한다. 잔액 update는 총액으로 1회만 하고, ledger는 건별로 남긴다.
     * ledger의 balance_after는 입력 순서대로 차감한 중간 잔액이다. 건별로 차감할 때와 값이 같다.
     */
    fun applyBatchedDebit(accountId: UUID, entries: List<WalletDebitEntry>, bumpStateVersion: Boolean = true): Long

    /**
     * 여러 건을 한 번에 지급한다. 차감과 대칭이다. 잔액 update는 총액으로 1회만 하고 ledger는 건별로 남긴다.
     * 기본 구현은 한 건씩 반영한다. 왕복을 줄이려는 구현만 재정의한다.
     */
    fun applyBatchedCredit(accountId: UUID, entries: List<WalletCreditEntry>, bumpStateVersion: Boolean = true): Long {
        if (entries.isEmpty()) return lockBalance(accountId)
        var balance = lockBalance(accountId)
        entries.forEachIndexed { index, entry ->
            balance = applyDelta(accountId, entry.amount, entry.sourceType, entry.sourceId, bumpStateVersion && index == 0)
        }
        return balance
    }
}
