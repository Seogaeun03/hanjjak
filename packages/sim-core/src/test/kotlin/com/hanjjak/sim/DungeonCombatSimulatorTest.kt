package com.hanjjak.sim

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DungeonCombatSimulatorTest {
    @Test
    fun `survival applies seven strikes and succeeds at one hp`() {
        val result = DungeonCombatSimulator.simulate(
            DungeonCombatInput("test", 1, DungeonMode.SURVIVE, FighterStats(1, 701, 0), SkillProfile(), DungeonBossStats(1, 0, 0, 150, 100)),
        )
        assertTrue(result.success)
        assertEquals(1, result.remainingPlayerHp)
        assertEquals(7, result.events.count { it.type == DungeonEventType.SURVIVAL_STRIKE })
    }

    @Test
    fun `survival fails when the final strike consumes all hp`() {
        val result = DungeonCombatSimulator.simulate(
            DungeonCombatInput("test", 1, DungeonMode.SURVIVE, FighterStats(1, 700, 0), SkillProfile(), DungeonBossStats(1, 0, 0, 150, 100)),
        )
        assertFalse(result.success)
        assertEquals("PLAYER_DIED", result.failureCode)
    }

    @Test
    fun `offensive encounter is deterministic and emits ordered events`() {
        val input = DungeonCombatInput("test", 42, DungeonMode.DEFEAT_BOSS, FighterStats(100, 1_000, 100), SkillProfile(criticalChanceBasisPoints = 5_000), DungeonBossStats(1_000, 0, 100, 150))
        val first = DungeonCombatSimulator.simulate(input)
        val second = DungeonCombatSimulator.simulate(input)
        assertEquals(first, second)
        assertTrue(first.events.zipWithNext().all { (a, b) -> a.sequence < b.sequence && a.tick <= b.tick })
    }

    @Test
    fun `permanent basic amplification increases dungeon basic attack damage`() {
        fun firstHit(skills: SkillProfile) = DungeonCombatSimulator.simulate(
            DungeonCombatInput("test", 1, DungeonMode.DEFEAT_BOSS, FighterStats(100, 1_000, 0), skills, DungeonBossStats(10_000, 0, 0, 10)),
        ).events.first { it.type == DungeonEventType.PLAYER_HIT }.amount

        assertEquals(100, firstHit(SkillProfile(activeOrder = emptyList())))
        assertEquals(200, firstHit(SkillProfile(permanentBasicAmplificationBasisPoints = 10_000, activeOrder = emptyList())))
    }

    @Test
    fun `permanent haste increases dungeon basic attack frequency`() {
        fun hitCount(skills: SkillProfile) = DungeonCombatSimulator.simulate(
            DungeonCombatInput("test", 1, DungeonMode.DEFEAT_BOSS, FighterStats(1, 1_000, 0), skills, DungeonBossStats(10_000, 0, 0, 15)),
        ).events.count { it.type == DungeonEventType.PLAYER_HIT }

        assertEquals(4, hitCount(SkillProfile(activeOrder = emptyList())))
        assertEquals(8, hitCount(SkillProfile(permanentHasteBasisPoints = 10_000, activeOrder = emptyList())))
    }

    @Test
    fun `small permanent haste accumulates across dungeon actions`() {
        fun hitCount(skills: SkillProfile) = DungeonCombatSimulator.simulate(
            DungeonCombatInput("test", 1, DungeonMode.DEFEAT_BOSS, FighterStats(1, 1_000, 0), skills, DungeonBossStats(100_000, 0, 0, 150)),
        ).events.count { it.type == DungeonEventType.PLAYER_HIT }

        val baseline = hitCount(SkillProfile(activeOrder = emptyList()))
        val withHaste = hitCount(SkillProfile(permanentHasteBasisPoints = 1_200, activeOrder = emptyList()))
        assertTrue(withHaste > baseline)
    }

    /**
     * 공속이 붙으면 행동 간격(3.2틱)이 나누어떨어지지 않아 48.000000000000004 같은 값이 쌓인다.
     * 메인 전투와 같은 보정이 없으면 이런 행동이 한 틱씩 뒤로 밀렸다가 따라잡곤 했다.
     */
    @Test
    fun `haste keeps the dungeon action grid on the same ticks as the main simulator`() {
        val result = DungeonCombatSimulator.simulate(
            DungeonCombatInput(
                "test",
                1,
                DungeonMode.DEFEAT_BOSS,
                FighterStats(1, 1_000, 0),
                SkillProfile(permanentHasteBasisPoints = 2_500, activeOrder = emptyList()),
                DungeonBossStats(1_000_000, 0, 0, 150),
            ),
        )

        val hitTicks = result.events.filter { it.type == DungeonEventType.PLAYER_HIT }.map { it.tick }
        assertTrue(hitTicks.containsAll(listOf(48, 64, 80, 96, 112, 128)), "밀린 행동: $hitTicks")
    }

    @Test
    fun `dot cast lock is one third of the normal action lock`() {
        val result = DungeonCombatSimulator.simulate(
            DungeonCombatInput(
                "dot-field-v1",
                1,
                DungeonMode.DEFEAT_BOSS,
                FighterStats(1, 1_000, 0),
                SkillProfile(dotTotalBasisPoints = 10_000, activeOrder = listOf("active_dot")),
                DungeonBossStats(100, 0, 0, 12),
            ),
        )

        assertEquals(0, result.events.first { it.type == DungeonEventType.SKILL_CAST }.tick)
        assertEquals(2, result.events.first { it.type == DungeonEventType.PLAYER_HIT }.tick)
        assertEquals(listOf(10), result.events.filter { it.type == DungeonEventType.DOT_HIT }.map { it.tick })
    }

    @Test
    fun `damage floor defaults to the historical half multiplier`() {
        assertEquals(5_000, DungeonBossStats(1, 0, 0, 150).damageFloorBasisPoints)
    }

    /**
     * 관통이 방어력에 크게 못 미치면 로지스틱이 포화해 배율이 하한으로 수렴한다. 장갑형은 이 하한을
     * 낮춰 관통을 공격력으로 때우지 못하게 한다.
     */
    @Test
    fun `damage floor bounds the multiplier when penetration is hopeless`() {
        fun firstHit(floorBasisPoints: Int) = DungeonCombatSimulator.simulate(
            DungeonCombatInput(
                "test",
                1,
                DungeonMode.DEFEAT_BOSS,
                FighterStats(1_000, 1_000, 0),
                SkillProfile(activeOrder = emptyList()),
                DungeonBossStats(
                    hp = 1_000_000,
                    attack = 0,
                    defense = 10_000,
                    durationTicks = 10,
                    damageFloorBasisPoints = floorBasisPoints,
                ),
            ),
        ).events.first { it.type == DungeonEventType.PLAYER_HIT }.amount

        assertEquals(500, firstHit(5_000))
        assertEquals(200, firstHit(2_000))
    }

    /** 하한만 파라미터다. 관통이 방어력과 같으면 배율은 하한 + 0.5 로 기울기·폭이 그대로다. */
    @Test
    fun `damage floor shifts the curve without changing its slope`() {
        fun firstHit(floorBasisPoints: Int) = DungeonCombatSimulator.simulate(
            DungeonCombatInput(
                "test",
                1,
                DungeonMode.DEFEAT_BOSS,
                FighterStats(1_000, 1_000, 500),
                SkillProfile(activeOrder = emptyList()),
                DungeonBossStats(
                    hp = 1_000_000,
                    attack = 0,
                    defense = 500,
                    durationTicks = 10,
                    damageFloorBasisPoints = floorBasisPoints,
                ),
            ),
        ).events.first { it.type == DungeonEventType.PLAYER_HIT }.amount

        assertEquals(1_000, firstHit(5_000))
        assertEquals(700, firstHit(2_000))
    }
}
