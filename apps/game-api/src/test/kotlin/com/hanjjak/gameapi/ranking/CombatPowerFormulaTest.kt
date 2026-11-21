package com.hanjjak.gameapi.ranking

import com.hanjjak.sim.FighterStats
import com.hanjjak.sim.SkillProfile
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CombatPowerFormulaTest {
    /** Legendary +30 in every slot, the deepest build the equipment curves reach. */
    private val endgame = FighterStats(2_361, 23_615, 902)

    @Test
    fun `initial fighter stats produce the baseline score`() {
        assertEquals(3_000L, CombatPowerFormula.calculate(FighterStats(40, 400, 20)))
    }

    @Test
    fun `weights standard offense, maximum hp and penetration equally`() {
        assertEquals(3_780L, CombatPowerFormula.calculate(FighterStats(80, 400, 20)))
        assertEquals(3_780L, CombatPowerFormula.calculate(FighterStats(40, 800, 20)))
        assertEquals(3_780L, CombatPowerFormula.calculate(FighterStats(40, 400, 40)))
    }

    @Test
    fun `doubling any single axis moves the score by the same amount at endgame scale`() {
        val attack = CombatPowerFormula.calculate(endgame.copy(attack = endgame.attack * 2))
        val maxHp = CombatPowerFormula.calculate(endgame.copy(maxHp = endgame.maxHp * 2))
        val penetration = CombatPowerFormula.calculate(endgame.copy(penetration = endgame.penetration * 2))

        assertEquals(attack, maxHp)
        assertEquals(attack, penetration)
    }

    /**
     * combat-power-v2 scored penetration through a damage multiplier against a
     * standard defense fixed at 100, which saturated past roughly 400. Every
     * mature character sat at the top of that curve and earned nothing for
     * penetration at all.
     */
    @Test
    fun `penetration keeps scoring past the old saturation point`() {
        val baseline = CombatPowerFormula.calculate(endgame)
        val invested = CombatPowerFormula.calculate(endgame.copy(penetration = 992))

        assert(invested > baseline) { "penetration saturated again at ${endgame.penetration}" }
        assert(invested > baseline * 103 / 100) { "10% more penetration moved the score by less than 3%" }
    }

    @Test
    fun `every equipped active effect increases standard combat power`() {
        val fighter = FighterStats(40, 400, 20)
        val baseline = CombatPowerFormula.calculate(fighter)
        val profiles = listOf(
            SkillProfile(heavyBasisPoints = 20_000, activeOrder = listOf("active_heavy")),
            SkillProfile(dotTotalBasisPoints = 25_000, activeOrder = listOf("active_dot")),
            SkillProfile(hasteBasisPoints = 2_000, activeOrder = listOf("active_haste")),
            SkillProfile(basicAmplificationBasisPoints = 2_000, activeOrder = listOf("active_basic_amp")),
        )

        profiles.forEach { profile ->
            assert(CombatPowerFormula.calculate(fighter, profile) > baseline)
        }
    }

    @Test
    fun `permanent offensive effects increase standard combat power`() {
        val fighter = FighterStats(40, 400, 20)
        val baseline = CombatPowerFormula.calculate(fighter)

        assert(CombatPowerFormula.calculate(fighter, SkillProfile(allDamageBasisPoints = 1_000)) > baseline)
        assert(CombatPowerFormula.calculate(fighter, SkillProfile(criticalChanceBasisPoints = 1_000)) > baseline)
        assert(CombatPowerFormula.calculate(fighter, SkillProfile(permanentHasteBasisPoints = 1_000)) > baseline)
        assert(CombatPowerFormula.calculate(fighter, SkillProfile(permanentBasicAmplificationBasisPoints = 1_000)) > baseline)
    }

    @Test
    fun `unmounted active effects do not change combat power`() {
        val fighter = FighterStats(40, 400, 20)
        val unmounted = SkillProfile(heavyBasisPoints = 92_500, activeOrder = emptyList())

        assertEquals(CombatPowerFormula.calculate(fighter), CombatPowerFormula.calculate(fighter, unmounted))
    }

    @Test
    fun `buff casts replace their action instead of adding a phantom basic hit`() {
        val fighter = FighterStats(40, 400, 20)
        val hasteOnly = SkillProfile(hasteBasisPoints = 2_000, activeOrder = listOf("active_haste"))
        val amplificationOnly = SkillProfile(basicAmplificationBasisPoints = 2_000, activeOrder = listOf("active_basic_amp"))

        assertEquals(3_059L, CombatPowerFormula.calculate(fighter, hasteOnly))
        assertEquals(3_055L, CombatPowerFormula.calculate(fighter, amplificationOnly))
    }

    @Test
    fun `buff duration extends haste and basic amplification windows`() {
        val fighter = FighterStats(40, 400, 20)
        val haste = SkillProfile(hasteBasisPoints = 2_000, activeOrder = listOf("active_haste"))
        val amplification = SkillProfile(basicAmplificationBasisPoints = 2_000, activeOrder = listOf("active_basic_amp"))

        assert(CombatPowerFormula.calculate(fighter, haste.copy(buffDurationBonusTicks = 20)) > CombatPowerFormula.calculate(fighter, haste))
        assert(CombatPowerFormula.calculate(fighter, amplification.copy(buffDurationBonusTicks = 20)) > CombatPowerFormula.calculate(fighter, amplification))
    }
}
