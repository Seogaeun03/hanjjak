package com.hanjjak.liveops.application

import com.hanjjak.liveops.domain.LiveopsOutcomeKind
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.Locale
import java.util.UUID

data class LiveopsOutcomeView(
    val kind: String,
    val prizeId: String?,
    val displayName: String?,
    val millionths: Int,
    val probabilityDisplay: String,
    val quantity: Long?,
    val minQuantity: Long?,
    val maxQuantity: Long?,
)

data class LiveopsPrizeView(
    val prizeId: String,
    val displayName: String,
    val total: Long,
    val claimed: Long,
    val remaining: Long,
    val alreadyWon: Boolean,
)

data class LiveopsStateView(
    val eventId: String,
    val displayName: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val open: Boolean,
    val halted: Boolean,
    val ticketBalance: Long,
    val grantedToday: Long,
    val dailyCap: Long,
    val secondsPerTicket: Long,
    val outcomes: List<LiveopsOutcomeView>,
    val prizes: List<LiveopsPrizeView>,
)

@Service
class LiveopsStateService(
    private val catalog: LiveopsCatalog,
    private val repository: LiveopsRepository,
    private val clock: Clock,
) {
    fun state(accountId: UUID, eventId: String): LiveopsStateView {
        val content = catalog.require(eventId)
        val now = clock.instant()
        val today = LocalDate.ofInstant(now, TicketAccrualService.KST)
        val open = content.isOpenAt(now)
        /* liveops_switch 도 같은 ApplicationRunner 가 기동 시 한 번만 만든다. 존재를 여기서도
           보장해 둔다(이미 있으면 손대지 않는다) — 그래야 이 행의 존재가 기동 순서의
           우연에 기대지 않는다. */
        repository.ensureSwitch(content.eventId)
        return LiveopsStateView(
            eventId = content.eventId,
            displayName = content.displayName,
            startsAt = content.startsAt,
            endsAt = content.endsAt,
            open = open,
            halted = repository.isHalted(content.eventId),
            ticketBalance = repository.ticketBalance(content.eventId, accountId),
            grantedToday = repository.readAccrual(content.eventId, accountId, today)?.grantedToday ?: 0,
            dailyCap = content.accrual.dailyCap,
            secondsPerTicket = content.accrual.secondsPerTicket,
            /* 기간이 끝나면 경품 칸을 목록에서 빼고 그 몫을 쌀에 얹어 보여 준다.
               화면이 0.01% 경품을 계속 보여 주면서 절대 주지 않는 쪽이 더 나쁘다. */
            outcomes = outcomeViews(open),
            prizes = content.prizes.map { prize ->
                /* readPrizeStock 은 행이 없으면 (0,0) 을 돌려주는데, 그러면 화면에 "잔여 0"
                   으로 보여 실제로는 시딩만 안 된 것을 품절로 오해하게 만든다. 여기서
                   존재를 보장해 둔다(이미 있으면 손대지 않는다). */
                repository.ensurePrizeStock(content.eventId, prize.prizeId, prize.stock)
                val stock = repository.readPrizeStock(content.eventId, prize.prizeId)
                LiveopsPrizeView(
                    prize.prizeId, prize.displayName, stock.total, stock.claimed,
                    (stock.total - stock.claimed).coerceAtLeast(0),
                    repository.countPrizeWins(content.eventId, prize.prizeId, accountId) > 0,
                )
            },
        )
    }

    private fun outcomeViews(open: Boolean): List<LiveopsOutcomeView> {
        val content = catalog.current()
        val prizeShare = if (open) 0 else content.outcomes.filter { it.kind == LiveopsOutcomeKind.PRIZE }.sumOf { it.millionths }
        return content.outcomes.mapNotNull { outcome ->
            if (!open && outcome.kind == LiveopsOutcomeKind.PRIZE) return@mapNotNull null
            val millionths = outcome.millionths + if (outcome.kind == LiveopsOutcomeKind.RICE) prizeShare else 0
            LiveopsOutcomeView(
                kind = outcome.kind.name,
                prizeId = outcome.prizeId,
                displayName = outcome.prizeId?.let { content.prizeOf(it).displayName },
                millionths = millionths,
                probabilityDisplay = formatProbability(millionths),
                quantity = outcome.quantity,
                minQuantity = outcome.minQuantity,
                maxQuantity = outcome.maxQuantity,
            )
        }
    }

    private fun formatProbability(millionths: Int): String =
        "%.4f".format(Locale.ROOT, millionths / 10_000.0).trimEnd('0').trimEnd('.') + "%"
}
