package com.hanjjak.gems.application

import com.hanjjak.gems.domain.GemInstance
import com.hanjjak.gems.domain.GemOption
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class GemCombatStatsTest {
    private val accountId = UUID.randomUUID()

    private fun gem(id: Long, option: GemOption, value: Int) =
        GemInstance(UUID(0, id), accountId, 7, option, value, false)

    @Test
    fun `all equipped values accumulate by option`() {
        val attackStats = aggregateGemCombatStats(
            listOf(
                gem(1, GemOption.FLAT_ATTACK, 100),
                gem(2, GemOption.FLAT_ATTACK, 150),
                gem(3, GemOption.FLAT_HP, 500),
                gem(4, GemOption.ATTACK_PERCENT, 800),
                gem(5, GemOption.ATTACK_PERCENT, 1_500),
                gem(6, GemOption.FLAT_PENETRATION, 120),
            ),
        )
        val utilityStats = aggregateGemCombatStats(
            listOf(
                gem(7, GemOption.FLAT_PENETRATION, 120),
                gem(8, GemOption.FLAT_PENETRATION, 120),
                gem(9, GemOption.CRITICAL_CHANCE, 1_200),
                gem(10, GemOption.CRITICAL_CHANCE, 1_200),
                gem(11, GemOption.HASTE, 1_200),
                gem(12, GemOption.HASTE, 1_200),
            ),
        )

        assertEquals(250, attackStats.flatAttack)
        assertEquals(500, attackStats.flatHp)
        assertEquals(2_300, attackStats.attackPercentBasisPoints)
        assertEquals(120, attackStats.flatPenetration)
        assertEquals(240, utilityStats.flatPenetration)
        assertEquals(2_400, utilityStats.criticalChanceBasisPoints)
        assertEquals(2_400, utilityStats.hasteBasisPoints)
    }
}
