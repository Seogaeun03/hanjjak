package com.hanjjak.liveops.application

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class LiveopsWinView(
    val winId: UUID,
    val prizeId: String,
    val prizeDisplayName: String,
    val accountId: UUID,
    val status: String,
    val operatorNote: String?,
    val wonAt: Instant,
    val updatedAt: Instant,
)

data class LiveopsAdminOverview(
    val eventId: String,
    val displayName: String,
    val open: Boolean,
    val halted: Boolean,
    val ticketsGranted: Long,
    val ticketsOutstanding: Long,
    val drawCount: Long,
    val outcomeCounts: Map<String, Long>,
    val prizes: List<LiveopsPrizeView>,
    val wins: List<LiveopsWinView>,
)

@Service
class LiveopsAdminService(
    private val catalog: LiveopsCatalog,
    private val repository: LiveopsRepository,
    private val clock: Clock,
) {
    fun overview(eventId: String, limit: Int = 200): LiveopsAdminOverview {
        val content = catalog.require(eventId)
        val now = clock.instant()
        return LiveopsAdminOverview(
            eventId = content.eventId,
            displayName = content.displayName,
            open = content.isOpenAt(now),
            halted = repository.isHalted(content.eventId),
            ticketsGranted = repository.sumGrantedTickets(content.eventId),
            ticketsOutstanding = repository.sumOutstandingTickets(content.eventId),
            drawCount = repository.countDraws(content.eventId),
            outcomeCounts = repository.outcomeCounts(content.eventId),
            prizes = content.prizes.map { prize ->
                val stock = repository.readPrizeStock(content.eventId, prize.prizeId)
                LiveopsPrizeView(
                    prize.prizeId, prize.displayName, stock.total, stock.claimed,
                    (stock.total - stock.claimed).coerceAtLeast(0), false,
                )
            },
            wins = repository.listWins(content.eventId, limit).map { row ->
                LiveopsWinView(
                    row.winId, row.prizeId, content.prizeOf(row.prizeId).displayName, row.accountId,
                    row.status, row.operatorNote, row.wonAt, row.updatedAt,
                )
            },
        )
    }

    @Transactional
    fun halt(eventId: String, reason: String, operator: String): LiveopsAdminOverview {
        val content = catalog.require(eventId)
        require(reason.isNotBlank()) { "HALT_REASON_REQUIRED" }
        repository.setHalted(content.eventId, true, reason, operator, clock.instant())
        return overview(eventId)
    }

    @Transactional
    fun resume(eventId: String, operator: String): LiveopsAdminOverview {
        val content = catalog.require(eventId)
        repository.setHalted(content.eventId, false, null, operator, clock.instant())
        return overview(eventId)
    }

    @Transactional
    fun updateWin(winId: UUID, status: String, operatorNote: String?): LiveopsWinView {
        require(status in ALLOWED_STATUSES) { "INVALID_WIN_STATUS" }
        val content = catalog.current()
        val current = requireNotNull(repository.listWins(content.eventId, MAX_WIN_LOOKUP).firstOrNull { it.winId == winId }) { "LIVEOPS_PRIZE_WIN_NOT_FOUND" }
        /* SSOT 가 문서화한 순서만 허용한다: PENDING → CONTACTED → FULFILLED, 또는 PENDING·
           CONTACTED 어느 쪽에서든 VOIDED 로. FULFILLED·VOIDED 는 종결 상태라 그 뒤로는
           되돌리기도 건너뛰기도 막는다 — 실물을 내줬는지 기록하는 원장이라 운영자 오클릭이
           조용히 이력을 덮어써서는 안 된다. */
        require(status in ALLOWED_TRANSITIONS.getValue(current.status)) { "LIVEOPS_PRIZE_WIN_INVALID_TRANSITION" }
        require(repository.updateWinStatus(winId, status, operatorNote, clock.instant())) { "LIVEOPS_PRIZE_WIN_NOT_FOUND" }
        val row = requireNotNull(repository.listWins(content.eventId, MAX_WIN_LOOKUP).firstOrNull { it.winId == winId }) { "LIVEOPS_PRIZE_WIN_NOT_FOUND" }
        return LiveopsWinView(
            row.winId, row.prizeId, content.prizeOf(row.prizeId).displayName, row.accountId,
            row.status, row.operatorNote, row.wonAt, row.updatedAt,
        )
    }

    companion object {
        val ALLOWED_STATUSES = setOf("PENDING", "CONTACTED", "FULFILLED", "VOIDED")

        /** 상태 전이 그래프. FULFILLED·VOIDED 는 종결 상태라 목적지 집합이 비어 있다. */
        val ALLOWED_TRANSITIONS: Map<String, Set<String>> = mapOf(
            "PENDING" to setOf("CONTACTED", "VOIDED"),
            "CONTACTED" to setOf("FULFILLED", "VOIDED"),
            "FULFILLED" to emptySet(),
            "VOIDED" to emptySet(),
        )
        const val MAX_WIN_LOOKUP = 10_000
    }
}
