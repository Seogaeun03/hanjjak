package com.hanjjak.balancelab

import com.hanjjak.gems.domain.GemOption
import com.hanjjak.gems.domain.GemRules
import kotlin.test.Test
import kotlin.test.assertEquals

class GemBonusTest {
    @Test
    fun `duplicate special gems accumulate in the reference build`() {
        val bonus = gemBonus(
            listOf(
                GemOption.ATTACK_PERCENT,
                GemOption.ATTACK_PERCENT,
                GemOption.FLAT_PENETRATION,
                GemOption.FLAT_PENETRATION,
            ),
            level = 7,
        )

        assertEquals(GemRules.fixedValue(7, GemOption.ATTACK_PERCENT) * 2, bonus.attackPercentBasisPoints)
        assertEquals(GemRules.fixedValue(7, GemOption.FLAT_PENETRATION) * 2, bonus.flatPenetration)
    }
}
