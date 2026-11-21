package com.hanjjak.liveops.domain

import kotlin.random.Random

sealed interface LiveopsDrawResult {
    data class Prize(val prizeId: String) : LiveopsDrawResult
    data class CosmeticTicket(val quantity: Long) : LiveopsDrawResult
    data class GemBox(val quantity: Long) : LiveopsDrawResult
    data class Rice(val quantity: Long) : LiveopsDrawResult
}

/**
 * 뽑기 한 회차를 결정한다. 저장소를 모르므로 `prizeGrantable` 판정은 호출자가 넘긴다.
 *
 * 경품 칸이 뽑혔는데 줄 수 없으면 쌀로 대체한다. 확률을 미리 재정규화하지 않고 뽑은 뒤에
 * 바꾸는 이유는, 쌀 칸이 정확히 하나라서 경품 몫이 늘 쌀로만 흘러가기 때문이다. 재정규화와
 * 결과가 같고 콘텐츠 표를 두 벌 들고 있을 필요가 없다.
 */
class LiveopsDrawTable(private val content: LiveopsContent) {
    fun roll(random: Random, prizeGrantable: Boolean): LiveopsDrawResult {
        val pick = random.nextInt(1_000_000)
        var cumulative = 0
        for (outcome in content.outcomes) {
            cumulative += outcome.millionths
            if (pick < cumulative) return materialize(random, outcome, prizeGrantable)
        }
        /* 합이 1,000,000 이라는 불변 조건을 LiveopsContent 가 이미 막는다. 여기 오면 표가 깨졌다. */
        error("INVALID_OUTCOME_TABLE")
    }

    private fun materialize(random: Random, outcome: LiveopsOutcome, prizeGrantable: Boolean): LiveopsDrawResult = when (outcome.kind) {
        LiveopsOutcomeKind.PRIZE -> {
            /* prizeGrantable 조건과 무관하게 항상 호출해야 random 소비가 동일해지고, 같은 시드로 동일한 결과를 얻는다. */
            val fallback = rice(random)
            if (prizeGrantable) LiveopsDrawResult.Prize(requireNotNull(outcome.prizeId)) else fallback
        }
        LiveopsOutcomeKind.COSMETIC_TICKET -> LiveopsDrawResult.CosmeticTicket(requireNotNull(outcome.quantity))
        LiveopsOutcomeKind.GEM_BOX -> LiveopsDrawResult.GemBox(requireNotNull(outcome.quantity))
        LiveopsOutcomeKind.RICE -> rice(random)
    }

    private fun rice(random: Random): LiveopsDrawResult.Rice {
        val outcome = content.riceOutcome
        val min = requireNotNull(outcome.minQuantity)
        val max = requireNotNull(outcome.maxQuantity)
        return LiveopsDrawResult.Rice(min + random.nextLong(max - min + 1))
    }
}
