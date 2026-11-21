package com.hanjjak.liveops.domain

import java.time.Instant

enum class LiveopsOutcomeKind { PRIZE, COSMETIC_TICKET, GEM_BOX, RICE }

/**
 * 뽑기 한 칸. `millionths` 는 백만분율이고 전체 합이 정확히 1,000,000 이어야 한다.
 * 칸의 종류마다 쓰는 필드가 다르다. PRIZE 는 [prizeId], COSMETIC_TICKET 과 GEM_BOX 는
 * [quantity], RICE 는 [minQuantity]~[maxQuantity] 를 쓴다.
 */
data class LiveopsOutcome(
    val kind: LiveopsOutcomeKind,
    val millionths: Int,
    val prizeId: String? = null,
    val quantity: Long? = null,
    val minQuantity: Long? = null,
    val maxQuantity: Long? = null,
) {
    init {
        require(millionths in 0..1_000_000) { "INVALID_OUTCOME_MILLIONTHS" }
        when (kind) {
            LiveopsOutcomeKind.PRIZE -> require(!prizeId.isNullOrBlank()) { "PRIZE_OUTCOME_REQUIRES_PRIZE_ID" }
            LiveopsOutcomeKind.COSMETIC_TICKET -> require((quantity ?: 0) > 0) { "COSMETIC_TICKET_OUTCOME_REQUIRES_QUANTITY" }
            LiveopsOutcomeKind.GEM_BOX -> require((quantity ?: 0) > 0) { "GEM_BOX_OUTCOME_REQUIRES_QUANTITY" }
            LiveopsOutcomeKind.RICE -> {
                val min = minQuantity
                val max = maxQuantity
                require(min != null && max != null && min > 0) { "INVALID_RICE_RANGE" }
            }
        }
    }
}

data class LiveopsPrize(
    val prizeId: String,
    val displayName: String,
    val stock: Long,
    val perAccountLimit: Long,
) {
    init {
        require(prizeId.isNotBlank()) { "INVALID_PRIZE_ID" }
        require(displayName.isNotBlank()) { "INVALID_PRIZE_DISPLAY_NAME" }
        require(stock >= 0) { "INVALID_PRIZE_STOCK" }
        require(perAccountLimit >= 1) { "INVALID_PRIZE_PER_ACCOUNT_LIMIT" }
    }
}

data class LiveopsAccrualPolicy(
    val secondsPerTicket: Long,
    val dailyCap: Long,
    val maxHeartbeatGapSeconds: Long,
) {
    init {
        require(secondsPerTicket >= 1 && dailyCap >= 1 && maxHeartbeatGapSeconds >= 1) { "INVALID_ACCRUAL_POLICY" }
    }
}

data class LiveopsContent(
    val contentVersion: String,
    val eventId: String,
    val displayName: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val accrual: LiveopsAccrualPolicy,
    val outcomes: List<LiveopsOutcome>,
    val prizes: List<LiveopsPrize>,
) {
    init {
        require(contentVersion.isNotBlank()) { "INVALID_CONTENT_VERSION" }
        require(eventId.isNotBlank()) { "INVALID_EVENT_ID" }
        require(displayName.isNotBlank()) { "INVALID_EVENT_DISPLAY_NAME" }
        require(startsAt.isBefore(endsAt)) { "INVALID_EVENT_WINDOW" }
        require(outcomes.isNotEmpty()) { "NO_OUTCOME_DECLARED" }
        require(outcomes.sumOf { it.millionths } == 1_000_000) { "OUTCOME_MILLIONTHS_MUST_SUM_TO_ONE_MILLION" }
        /* 경품이 빠지는 경우(기간 종료·재고 소진·계정 중복)에 대체할 곳이 반드시 하나 있어야 한다.
           둘 이상이면 어디로 대체할지 코드가 임의로 고르게 되므로 정확히 하나로 못 박는다. */
        require(outcomes.count { it.kind == LiveopsOutcomeKind.RICE } == 1) { "EXACTLY_ONE_RICE_OUTCOME_REQUIRED" }
        /* 굴림이 고른 칸과 지급 전에 재검사하는 칸이 어긋나면 안 된다. 뽑기 서비스는 첫 PRIZE 칸으로
           기간·재고·중복 당첨을 검사하지만 실제로 당첨된 칸으로 지급하므로, 칸이 둘 이상이면
           엉뚱한 경품의 재고 검사를 건너뛴 채 지급될 수 있다. */
        require(outcomes.count { it.kind == LiveopsOutcomeKind.PRIZE } <= 1) { "AT_MOST_ONE_PRIZE_OUTCOME_ALLOWED" }
        require(prizes.map { it.prizeId }.distinct().size == prizes.size) { "DUPLICATE_PRIZE_DEFINITION" }
        val declared = prizes.map { it.prizeId }.toSet()
        require(outcomes.filter { it.kind == LiveopsOutcomeKind.PRIZE }.all { it.prizeId in declared }) { "UNKNOWN_PRIZE_REFERENCE" }
        /* 쌀 범위가 뒤집히면 거부한다. */
        outcomes.filter { it.kind == LiveopsOutcomeKind.RICE }.forEach { outcome ->
            require(outcome.minQuantity!! <= outcome.maxQuantity!!) { "INVALID_RICE_RANGE" }
        }
    }

    val riceOutcome: LiveopsOutcome get() = outcomes.first { it.kind == LiveopsOutcomeKind.RICE }

    /**
     * 한 회차가 줄 수 있는 보석함의 최대 개수. 보석함 칸이 없는 이벤트는 0 이다.
     *
     * 보석함은 쌀·치장 뽑기권과 달리 가방 칸을 쓴다. 뽑기 서비스가 티켓을 쓰기 전에
     * `회차 수 × 이 값` 만큼의 여유를 확인해, 굴림 결과가 나온 뒤에야 가방이 모자란 것을
     * 알고 회차를 통째로 되돌리는 일이 없게 한다.
     */
    val maxGemBoxesPerDraw: Long
        get() = outcomes.filter { it.kind == LiveopsOutcomeKind.GEM_BOX }.maxOfOrNull { it.quantity ?: 0 } ?: 0

    fun prizeOf(prizeId: String): LiveopsPrize =
        prizes.firstOrNull { it.prizeId == prizeId } ?: throw IllegalArgumentException("UNKNOWN_PRIZE_REFERENCE")

    /** 시작 시각은 포함하고 종료 시각은 제외한다. 적립과 경품 지급이 같은 경계를 쓴다. */
    fun isOpenAt(at: Instant): Boolean = !at.isBefore(startsAt) && at.isBefore(endsAt)
}
