package com.hanjjak.liveops.application

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 적립·뽑기 로직만 보려고 쓰는 메모리 저장소다. 잠금과 제약은 흉내 내지 않는다.
 * SQL 자체는 `JdbcLiveopsRepositoryTest`, 실제 스키마는 game-api 통합 테스트가 본다.
 */
class FakeLiveopsRepository : LiveopsRepository {
    private data class AccrualKey(val eventId: String, val accountId: UUID, val date: LocalDate)

    private val accruals = mutableMapOf<AccrualKey, LiveopsRepository.AccrualRow>()
    private val balances = mutableMapOf<Pair<String, UUID>, Long>()
    private val draws = mutableMapOf<Triple<String, UUID, UUID>, String>()
    private val stocks = mutableMapOf<Pair<String, String>, LiveopsRepository.StockRow>()
    private val wins = mutableSetOf<Triple<String, String, UUID>>()

    var halted: Boolean = false

    fun accrual(eventId: String, accountId: UUID, date: LocalDate): LiveopsRepository.AccrualRow =
        accruals.getValue(AccrualKey(eventId, accountId, date))

    override fun lockOrCreateAccrual(eventId: String, accountId: UUID, kstDate: LocalDate, now: Instant): LiveopsRepository.AccrualRow =
        accruals.getOrPut(AccrualKey(eventId, accountId, kstDate)) { LiveopsRepository.AccrualRow(0, 0, now) }

    override fun saveAccrual(eventId: String, accountId: UUID, kstDate: LocalDate, accruedSeconds: Long, grantedToday: Long, lastTickAt: Instant) {
        accruals[AccrualKey(eventId, accountId, kstDate)] = LiveopsRepository.AccrualRow(accruedSeconds, grantedToday, lastTickAt)
    }

    override fun creditTickets(eventId: String, accountId: UUID, amount: Long) {
        balances[eventId to accountId] = (balances[eventId to accountId] ?: 0) + amount
    }

    override fun ticketBalance(eventId: String, accountId: UUID): Long = balances[eventId to accountId] ?: 0
    override fun lockTicketBalance(eventId: String, accountId: UUID): Long = ticketBalance(eventId, accountId)

    override fun debitTickets(eventId: String, accountId: UUID, amount: Long) {
        val current = ticketBalance(eventId, accountId)
        require(current >= amount) { "EVENT_TICKET_BALANCE_NEGATIVE" }
        balances[eventId to accountId] = current - amount
    }

    override fun findDrawResult(eventId: String, accountId: UUID, commandId: UUID): String? = draws[Triple(eventId, accountId, commandId)]

    override fun saveDraw(drawId: UUID, eventId: String, accountId: UUID, commandId: UUID, contentVersion: String, resultJson: String, drawnAt: Instant) {
        draws[Triple(eventId, accountId, commandId)] = resultJson
    }

    override fun ensurePrizeStock(eventId: String, prizeId: String, total: Long) {
        /* JdbcLiveopsRepository 와 같은 규칙: claimed 를 0 이 아니라 이미 기록된 당첨(wins) 수에서
           되살린다. 행이 지워졌다가 재시딩되어도 실제로 나간 경품 수를 잊지 않아야 한다. */
        stocks.getOrPut(eventId to prizeId) {
            val claimed = wins.count { it.first == eventId && it.second == prizeId }.toLong()
            LiveopsRepository.StockRow(total, claimed)
        }
    }

    override fun readPrizeStock(eventId: String, prizeId: String): LiveopsRepository.StockRow =
        stocks[eventId to prizeId] ?: LiveopsRepository.StockRow(0, 0)

    override fun readAccrual(eventId: String, accountId: UUID, kstDate: LocalDate): LiveopsRepository.AccrualRow? =
        accruals[AccrualKey(eventId, accountId, kstDate)]

    override fun lockPrizeStock(eventId: String, prizeId: String): LiveopsRepository.StockRow =
        stocks[eventId to prizeId] ?: throw IllegalStateException("LIVEOPS_PRIZE_STOCK_MISSING")

    override fun incrementPrizeClaimed(eventId: String, prizeId: String) {
        val current = lockPrizeStock(eventId, prizeId)
        require(current.claimed < current.total) { "LIVEOPS_PRIZE_STOCK_EXHAUSTED" }
        stocks[eventId to prizeId] = current.copy(claimed = current.claimed + 1)
    }

    override fun countPrizeWins(eventId: String, prizeId: String, accountId: UUID): Long =
        if (Triple(eventId, prizeId, accountId) in wins) 1 else 0

    override fun insertPrizeWin(winId: UUID, eventId: String, prizeId: String, accountId: UUID, drawId: UUID, wonAt: Instant): Boolean =
        wins.add(Triple(eventId, prizeId, accountId))

    override fun sumGrantedTickets(eventId: String): Long = accruals.filterKeys { it.eventId == eventId }.values.sumOf { it.grantedToday }
    override fun sumOutstandingTickets(eventId: String): Long = balances.filterKeys { it.first == eventId }.values.sum()
    override fun countDraws(eventId: String): Long = draws.keys.count { it.first == eventId }.toLong()
    override fun outcomeCounts(eventId: String): Map<String, Long> = emptyMap()
    override fun listWins(eventId: String, limit: Int): List<LiveopsRepository.WinRow> = emptyList()
    override fun setHalted(eventId: String, halted: Boolean, reason: String?, updatedBy: String, at: Instant) { this.halted = halted }
    override fun updateWinStatus(winId: UUID, status: String, operatorNote: String?, at: Instant): Boolean = false

    override fun ensureSwitch(eventId: String) = Unit
    override fun isHalted(eventId: String): Boolean = halted
}
