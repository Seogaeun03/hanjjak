package com.hanjjak.balancelab

import com.hanjjak.equipment.domain.EquipmentGrade
import com.hanjjak.equipment.domain.EquipmentRules
import com.hanjjak.gems.domain.GemDungeonRewards
import com.hanjjak.gems.domain.GemPreset
import com.hanjjak.gems.domain.GemRules
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 이 스펙의 핵심 약속을 고정한다.
 *
 * 모든 스펙을 최고치로 올려도 20단계까지만 깨지고, 21단계부터는 노출되지만 도달할 수 없다.
 * 한 축이라도 덜 채우면 20단계가 실패한다.
 */
class DungeonCeilingTest {
    private val ladder = buildDungeonLadder(referenceArrivalMinutes(1L, loadProgressionSimulationContent()))
    private val values = generateDungeonStages(ladder).associateBy { it.boss to it.stage }

    private fun value(boss: GemPreset, stage: Int) = values.getValue(boss to stage)

    @Test
    fun `ceiling stage build is the absolute maximum`() {
        val state = ladder.stateFor(DUNGEON_CEILING_STAGE, GemPreset.BERSERK)
        assertEquals(MAX_PLAYER_LEVEL, state.level)
        assertEquals(EquipmentGrade.LEGENDARY, state.grade)
        assertEquals(EquipmentRules.MAX_ENHANCEMENT_LEVEL, state.enhancement)
        assertEquals(MAX_GEM_LEVEL, state.gemLevel)
        assertEquals(MAX_COSMETIC_STAR, state.cosmeticStar)
        assertEquals(EquipmentGrade.EPIC, state.skillGrade, "던전 기준 빌드는 전설을 의도적으로 제외한다 (SKILL_SLOTS = 30)")
        assertEquals(10, state.skillLevel)
    }

    @Test
    fun `every reachable stage clears with its reference build`() {
        GemRules.DUNGEON_BOSSES.forEach { boss ->
            (1..DUNGEON_CEILING_STAGE).forEach { stage ->
                assertEquals(
                    100.0,
                    value(boss, stage).referenceSuccessRate,
                    "$boss $stage 단계 기준 빌드가 1,000 seed 를 전부 통과하지 못했다",
                )
            }
        }
    }

    @Test
    fun `the previous stage build cannot carry the next one`() {
        GemRules.DUNGEON_BOSSES.forEach { boss ->
            (2..DUNGEON_CEILING_STAGE).forEach { stage ->
                assertTrue(
                    value(boss, stage).deficientSuccessRate < 50.0,
                    "$boss $stage 단계를 직전 단계 빌드가 ${value(boss, stage).deficientSuccessRate}% 로 넘었다",
                )
            }
        }
    }

    /** 상한을 넘는 단계는 노출되지만 절대 상한 빌드로도 닿지 않는다. */
    @Test
    fun `stages beyond the ceiling demand more than the maximum build`() {
        GemRules.DUNGEON_BOSSES.forEach { boss ->
            val ceiling = value(boss, DUNGEON_CEILING_STAGE)
            (DUNGEON_CEILING_STAGE + 1..GemDungeonRewards.MAX_STAGE).forEach { stage ->
                val beyond = value(boss, stage)
                val ceilingLoad = if (boss == GemPreset.SURVIVAL) ceiling.strikeDamage else ceiling.bossHp
                val beyondLoad = if (boss == GemPreset.SURVIVAL) beyond.strikeDamage else beyond.bossHp
                assertTrue(beyondLoad > ceilingLoad, "$boss $stage 단계가 상한 단계보다 약하다")
            }
        }
    }

    /** 곡선이 튀면 "조금만 더 키우면 될 것 같은데" 로 읽히지 않는다. */
    @Test
    fun `the ladder grows monotonically without a cliff`() {
        GemRules.DUNGEON_BOSSES.forEach { boss ->
            (2..GemDungeonRewards.MAX_STAGE).forEach { stage ->
                val previous = value(boss, stage - 1)
                val current = value(boss, stage)
                val previousLoad = if (boss == GemPreset.SURVIVAL) previous.strikeDamage else previous.bossHp
                val currentLoad = if (boss == GemPreset.SURVIVAL) current.strikeDamage else current.bossHp
                assertTrue(currentLoad > previousLoad, "$boss $stage 단계가 직전보다 약하다")
                assertTrue(
                    currentLoad < previousLoad * 3,
                    "$boss $stage 단계가 직전의 세 배를 넘어 곡선이 끊긴다",
                )
            }
        }
    }

    /** 장갑형만 하한을 낮춰 관통을 공격력으로 때우지 못하게 한다. */
    @Test
    fun `only the armored boss lowers the damage floor`() {
        (1..GemDungeonRewards.MAX_STAGE).forEach { stage ->
            assertEquals(2_000, value(GemPreset.ARMORED, stage).damageFloorBasisPoints)
            assertEquals(5_000, value(GemPreset.BERSERK, stage).damageFloorBasisPoints)
            assertEquals(5_000, value(GemPreset.SURVIVAL, stage).damageFloorBasisPoints)
        }
    }

    /* 장비 등급을 추가하는 것만으로 던전 천장이 올라가면 20단계 보스 수치가 조용히 움직인다.
       천장은 밸런스 결정이므로 enum 길이와 무관하게 고정돼야 한다. */
    @Test
    fun `equipment ladder stays pinned to the dungeon ceiling grade`() {
        assertEquals(120, EQUIPMENT_Q_LADDER.size)
        assertEquals(DUNGEON_CEILING_GRADE to EquipmentRules.MAX_ENHANCEMENT_LEVEL, EQUIPMENT_Q_LADDER.last())
    }

    /** 보스별 검사축을 바꾸지 않는다. */
    @Test
    fun `each boss keeps its check axis`() {
        (1..GemDungeonRewards.MAX_STAGE).forEach { stage ->
            val survival = value(GemPreset.SURVIVAL, stage)
            assertEquals(1, survival.bossHp)
            assertTrue(survival.strikeDamage > 0)
            assertEquals(0, survival.defense)

            val berserk = value(GemPreset.BERSERK, stage)
            assertEquals(0, berserk.defense)
            assertEquals(0, berserk.strikeDamage)

            val armored = value(GemPreset.ARMORED, stage)
            assertTrue(armored.defense > 0)
            assertEquals(0, armored.strikeDamage)

            listOf(survival, berserk, armored).forEach { assertEquals(0, it.bossAttack) }
        }
    }
}
