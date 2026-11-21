package com.hanjjak.balancelab

import com.hanjjak.equipment.domain.EquipmentRules
import com.hanjjak.equipment.domain.EquipmentSlot
import com.hanjjak.equipment.domain.EquipmentSlotState
import com.hanjjak.gems.domain.GemDungeonRewards
import com.hanjjak.gems.domain.GemPreset
import com.hanjjak.gems.domain.GemRules
import com.hanjjak.sim.DungeonBossStats
import com.hanjjak.sim.DungeonCombatInput
import com.hanjjak.sim.DungeonCombatSimulator
import com.hanjjak.sim.DungeonMode
import com.hanjjak.sim.FighterStats
import com.hanjjak.sim.SkillProfile
import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.skills.domain.SkillContentLoader
import com.hanjjak.skills.domain.SkillGrade
import com.hanjjak.skills.domain.SkillRules
import com.hanjjak.skills.domain.SkillState
import java.io.File
import java.util.UUID
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.roundToInt

/**
 * 보스 절대 수치를 [DungeonLadder] 의 기준 빌드에서 산출한다.
 *
 * 수치를 손으로 적지 않는다. 각 단계의 기준 빌드가 150틱 안에 **확정 처치**할 수 있는 최대치를
 * 이분 탐색으로 찾고, 그 값이 곧 그 단계의 난이도 정의가 된다.
 */

private const val ENCOUNTER_TICKS = 150
private const val SURVIVAL_STRIKE_COUNT = 7
private const val VERIFICATION_SEEDS = 1_000

/** 장갑형만 쓰는 피해 배율 하한. 관통을 공격력으로 때우지 못하게 한다 (설계서 12.2장). */
private const val ARMORED_DAMAGE_FLOOR_BASIS_POINTS = 2_000

/** 기준 관통에서 배율이 0.75 가 되도록 방어력을 띄우는 폭. `ln(3) / 0.015`. */
private val ARMORED_DEFENSE_OFFSET = (ln(3.0) / 0.015).roundToInt()

/** 액티브 네 칸을 모두 장착한다. 패시브 둘은 해금만 되면 늘 적용된다. */
private val SKILL_LOADOUT = listOf("active_heavy", "active_dot", "active_haste", "active_basic_amp")
private val SKILL_IDS = SKILL_LOADOUT + listOf("passive_critical", "passive_all_damage")

internal data class DungeonStageValues(
    val boss: GemPreset,
    val stage: Int,
    val bossHp: Int,
    val bossAttack: Int,
    val defense: Int,
    val strikeDamage: Int,
    val damageFloorBasisPoints: Int,
    val referenceSuccessRate: Double,
    val deficientSuccessRate: Double,
    val worstClearTicks: Int,
)

/** 기준 빌드 상태를 실제 전투 스탯으로 바꾼다. `CharacterStatsCalculator` 의 합산 순서를 따른다. */
internal fun dungeonFighter(state: DungeonReferenceState, boss: GemPreset): FighterStats {
    fun summary(slot: EquipmentSlot) =
        EquipmentRules.statSummary(slot, EquipmentSlotState(UUID(0, slot.ordinal.toLong()), slot, state.grade, state.enhancement))

    val gems = gemBonus(referenceGemOptions(boss, state.gemLevel), state.gemLevel)
    val setBasisPoints = cosmeticSetBasisPoints(state.cosmeticStar)
    val baseAttack = 40 + 2 * (state.level - 1) +
        summary(EquipmentSlot.WEAPON).attack + summary(EquipmentSlot.GLOVES).attack + gems.flatAttack
    val baseHp = 400 + 20 * (state.level - 1) +
        summary(EquipmentSlot.ARMOR).maxHp + summary(EquipmentSlot.HELMET).maxHp + gems.flatHp
    val basePenetration = 20 +
        summary(EquipmentSlot.CAPE).penetration + summary(EquipmentSlot.SHOES).penetration + gems.flatPenetration
    return FighterStats(
        attack = (baseAttack * (1 + gems.attackPercentBasisPoints / 10_000.0) * (1 + setBasisPoints / 10_000.0)).roundToInt(),
        maxHp = (baseHp * (1 + setBasisPoints / 10_000.0)).roundToInt(),
        penetration = (basePenetration * (1 + setBasisPoints / 10_000.0)).roundToInt(),
    )
}

/**
 * 스킬 수치는 `skills.json` 에서 읽는다. 하드코딩하면 콘텐츠와 조용히 어긋난다.
 *
 * balance-lab 의 리소스 루트는 `versions` 라 `SkillContentLoader.load()` 의 classpath 경로가
 * 맞지 않는다. 다른 콘텐츠와 같은 방식으로 파일에서 직접 읽는다.
 */
private val skillRules: SkillRules by lazy {
    val file = File("packages/game-content/versions/progression-rebalance-v1/skills/skills.json")
    SkillRules(SkillContentLoader(ObjectMapper()).load(file.inputStream()))
}

internal fun dungeonSkills(state: DungeonReferenceState): SkillProfile {
    val grade = SkillGrade.valueOf(state.skillGrade.name)
    return skillRules.profile(SKILL_IDS.map { SkillState(it, grade, state.skillLevel, 0) }, SKILL_LOADOUT)
}

private fun simulate(
    player: FighterStats,
    skills: SkillProfile,
    boss: DungeonBossStats,
    mode: DungeonMode,
    seed: Long,
) = DungeonCombatSimulator.simulate(
    DungeonCombatInput("gem-dungeon-v3-candidate", seed, mode, player, skills, boss),
)

/** 치명타를 0 으로 둔 빌드가 확정 처치할 수 있는 최대 HP. 운이 좋아야 깨지는 단계를 만들지 않는다. */
private fun maximumGuaranteedBossHp(
    player: FighterStats,
    skills: SkillProfile,
    defense: Int,
    damageFloorBasisPoints: Int,
): Int {
    val noCritical = skills.copy(criticalChanceBasisPoints = 0)
    var low = 1
    var high = player.attack.toLong() * 5_000L
    while (low < high) {
        val mid = low + ((high - low + 1) / 2)
        val boss = DungeonBossStats(
            hp = mid.toInt(),
            attack = 0,
            defense = defense,
            durationTicks = ENCOUNTER_TICKS,
            damageFloorBasisPoints = damageFloorBasisPoints,
        )
        if (simulate(player, noCritical, boss, DungeonMode.DEFEAT_BOSS, 1L).success) low = mid.toInt() else high = mid - 1
    }
    return low
}

internal fun generateDungeonStages(ladder: DungeonLadder): List<DungeonStageValues> =
    GemRules.DUNGEON_BOSSES.flatMap { boss ->
        (1..GemDungeonRewards.MAX_STAGE).map { stage -> stageValues(ladder, boss, stage) }
    }

private fun stageValues(ladder: DungeonLadder, boss: GemPreset, stage: Int): DungeonStageValues {
    val state = ladder.stateFor(stage, boss)
    val player = dungeonFighter(state, boss)
    val skills = dungeonSkills(state)
    /*
     * 26~30 은 절대 상한 빌드로도 못 깬다. 기준 빌드가 25단계에서 멈추므로, 마지막 실제 구간의
     * 증가율을 그대로 연장해 수치만 올린다. 곡선이 튀면 "조금만 더 키우면 될 것 같은데" 로
     * 읽히지 않는다.
     */
    val overshoot = if (stage > DUNGEON_CEILING_STAGE) {
        val previous = ladder.stateFor(DUNGEON_CEILING_STAGE - 1, boss)
        val ratio = dungeonFighter(state, boss).attack.toDouble() / dungeonFighter(previous, boss).attack
        ratio.coerceAtLeast(1.05).let { Math.pow(it, (stage - DUNGEON_CEILING_STAGE).toDouble()) }
    } else {
        1.0
    }
    val deficient = if (stage > 1) {
        val previousState = ladder.stateFor(stage - 1, boss)
        dungeonFighter(previousState, boss) to dungeonSkills(previousState)
    } else {
        null
    }

    return when (boss) {
        GemPreset.SURVIVAL -> {
            val strike = (floor((player.maxHp - 1) / SURVIVAL_STRIKE_COUNT.toDouble()).toInt() * overshoot)
                .roundToInt().coerceAtLeast(1)
            val survives = { fighter: FighterStats -> fighter.maxHp > strike * SURVIVAL_STRIKE_COUNT }
            DungeonStageValues(
                boss, stage, bossHp = 1, bossAttack = 0, defense = 0, strikeDamage = strike,
                damageFloorBasisPoints = 5_000,
                referenceSuccessRate = if (survives(player)) 100.0 else 0.0,
                deficientSuccessRate = if (deficient != null && survives(deficient.first)) 100.0 else 0.0,
                worstClearTicks = ENCOUNTER_TICKS,
            )
        }
        else -> {
            val armored = boss == GemPreset.ARMORED
            val defense = if (armored) player.penetration + ARMORED_DEFENSE_OFFSET else 0
            val floor = if (armored) ARMORED_DAMAGE_FLOOR_BASIS_POINTS else 5_000
            val hp = (maximumGuaranteedBossHp(player, skills, defense, floor) * overshoot).roundToInt().coerceAtLeast(1)
            val stats = DungeonBossStats(hp, 0, defense, ENCOUNTER_TICKS, damageFloorBasisPoints = floor)
            val reference = (1L..VERIFICATION_SEEDS.toLong()).map { simulate(player, skills, stats, DungeonMode.DEFEAT_BOSS, it) }
            val deficientResults = deficient?.let { (fighter, deficientSkills) ->
                (1L..VERIFICATION_SEEDS.toLong()).map { simulate(fighter, deficientSkills, stats, DungeonMode.DEFEAT_BOSS, it) }
            }.orEmpty()
            DungeonStageValues(
                boss, stage, bossHp = hp, bossAttack = 0, defense = defense, strikeDamage = 0,
                damageFloorBasisPoints = floor,
                referenceSuccessRate = reference.count { it.success } * 100.0 / VERIFICATION_SEEDS,
                deficientSuccessRate = if (deficientResults.isEmpty()) 0.0 else deficientResults.count { it.success } * 100.0 / VERIFICATION_SEEDS,
                worstClearTicks = reference.filter { it.success }.maxOfOrNull { it.elapsedTicks } ?: ENCOUNTER_TICKS,
            )
        }
    }
}

internal fun dungeonContentJson(values: List<DungeonStageValues>): String {
    val bosses = GemRules.DUNGEON_BOSSES.joinToString(",\n") { boss ->
        val stages = values.filter { it.boss == boss }.sortedBy { it.stage }.joinToString(",\n") { row ->
            val extra = if (row.damageFloorBasisPoints != 5_000) ", \"damageFloorBasisPoints\": ${row.damageFloorBasisPoints}" else ""
            """        { "stage": ${row.stage}, "bossHp": ${row.bossHp}, "bossAttack": ${row.bossAttack}, "defense": ${row.defense}, "strikeDamage": ${row.strikeDamage}$extra }"""
        }
        """    {
      "bossType": "${boss.name}",
      "stages": [
$stages
      ]
    }"""
    }
    return """{
  "authority": "applied",
  "contentVersion": "gem-dungeon-v3-30stage-applied",
  "durationTicks": $ENCOUNTER_TICKS,
  "completionWindowSeconds": 15,
  "bosses": [
$bosses
  ]
}
"""
}

fun main(args: Array<String>) {
    val ladder = buildDungeonLadder(referenceArrivalMinutes(1L, loadProgressionSimulationContent()))
    val values = generateDungeonStages(ladder)

    val report = File("build/reports/balance/gem-dungeon-candidate.csv")
    report.parentFile.mkdirs()
    report.writeText(
        "bossType,stage,days,level,equipment,gemLevel,cosmeticStar,skill,bossHp,bossAttack,defense,strikeDamage,damageFloor,referenceSuccessRate,deficientSuccessRate,worstClearTicks\n" +
            values.joinToString("\n") { row ->
                val state = ladder.stateFor(row.stage, row.boss)
                listOf(
                    row.boss.name, row.stage, "%.2f".format(state.days), state.level,
                    "${state.grade.name}+${state.enhancement}", state.gemLevel, state.cosmeticStar,
                    "${state.skillGrade.name}${state.skillLevel}",
                    row.bossHp, row.bossAttack, row.defense, row.strikeDamage, row.damageFloorBasisPoints,
                    "%.1f".format(row.referenceSuccessRate), "%.1f".format(row.deficientSuccessRate), row.worstClearTicks,
                ).joinToString(",")
            } + "\n",
    )

    if ("--write" in args) {
        val target = File("packages/game-content/versions/v1/gem-dungeons/gem-dungeons-v3.json")
        target.parentFile.mkdirs()
        target.writeText(dungeonContentJson(values))
        println("written=${target.path}")
    }

    val reachable = values.filter { it.stage <= DUNGEON_CEILING_STAGE }
    println("generated=${values.size} seeds=$VERIFICATION_SEEDS report=${report.path}")
    println("referenceAlwaysClears=${reachable.all { it.referenceSuccessRate == 100.0 }}")
    println("previousStageFails=${reachable.filter { it.stage > 1 }.all { it.deficientSuccessRate < 50.0 }}")
}
