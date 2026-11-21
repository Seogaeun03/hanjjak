package com.hanjjak.balancelab

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.equipment.domain.EquipmentGrade
import com.hanjjak.equipment.domain.EquipmentRules
import com.hanjjak.gems.domain.GemDungeonRewards
import com.hanjjak.gems.domain.GemOption
import com.hanjjak.gems.domain.GemPreset
import com.hanjjak.gems.domain.GemRules
import java.io.File
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * 던전 30단계 사다리를 공급량에서 역산한다.
 *
 * 메인 생성기의 기준 빌드 모델은 그대로 못 쓴다. `referenceGemLevels()` 가 4레벨에서 멈추고
 * `normalOneSkills()` 가 노말 1레벨 고정이라 절대 상한이 필요한 후반 단계가 표현되지 않고,
 * `referenceQ(100) = 231` 은 실제 장비 상한 Q147 을 한참 넘는다.
 *
 * 대신 메인 진행 타임라인 위에 보석 수급을 얹어 시점별 계정 상태를 만들고, 단계를 **도달 시간
 * 등비**로 배치해 그 시점의 상태를 기준 빌드로 삼는다.
 */

/** 던전 해금 지점. `stage.01-05` 를 처음 깬 시점이다. */
internal const val DUNGEON_UNLOCK_STAGE_INDEX = 5

/**
 * 절대 상한 빌드로 클리어 가능한 마지막 단계. 21~30 은 노출되지만 도달할 수 없다.
 *
 * 20 인 이유는 산수다. 1단계에서 상한까지 필요 화력이 약 100배인데, 치명타가 판마다 ±18% 를
 * 흔들어 한 칸이 구분되려면 최소 +20% 는 벌어져야 한다. `ln(100)/ln(1.2)` 가 약 25 라 25칸은
 * 이론 한계에 정확히 걸쳐 여유가 없고, 배치가 조금만 불균등해도 직전 단계 빌드가 넘어온다.
 * 실제로 25칸에서는 폭주형 여섯 단계가 직전 빌드에 96% 까지 뚫렸다. 20칸이면 칸당 +27% 라
 * 검증이 여유를 갖고, 치장 세트를 켜거나 스킬 수치를 만져도 견딘다.
 */
internal const val DUNGEON_CEILING_STAGE = 20

/** 20단계(상한) 도달 목표. 메인 완주가 약 25일이므로 그 3.6배인 장기 목표다 (2026-09-17 사용자 결정). */
internal const val DUNGEON_CEILING_DAYS = 90.0

/** P50 계정의 하루 전투 시간. `EconomyCriteria` 의 7일 24시간 기준을 분으로 환산한 값이다. */
internal const val COMBAT_MINUTES_PER_DAY = 24.0 * 60.0 / 7.0

/** 입장권은 시간당 1장, 최대 3장. 매시간 챙기는 P50 계정을 하루 24장으로 본다. */
internal const val DUNGEON_TICKETS_PER_DAY = 24

/** 일일 물개 레이드가 주는 보석함. 개인 보상과 순위 보상의 중앙값이다. */
internal const val RAID_GEM_BOXES_PER_DAY = 5

/** 보석함 하나의 1레벨 환산 기대값. `0.85*1 + 0.10*3 + 0.05*9`. */
internal const val GEM_BOX_EXPECTED_CONVERSION = 1.6

/**
 * 던전 기준빌드의 천장 등급. 장비 enum 의 마지막 등급이 **아니라** 밸런스 결정이다.
 *
 * 예전에는 아래 사다리가 EquipmentGrade.entries 를 그대로 순회해, 등급을 하나 추가하는
 * 것만으로 천장 앵커가 올라가고 20단계 전 구간의 보스 수치가 따라 움직였다. 신화 천장으로
 * 보스를 재산출하는 것은 별도 작업이므로 천장을 여기서 명시적으로 고정한다.
 */
internal val DUNGEON_CEILING_GRADE: EquipmentGrade = EquipmentGrade.LEGENDARY

/** 실제로 도달 가능한 장비 상태 120칸. 등급 사이의 Q 공백(31~39 등)은 존재하지 않는다. */
internal val EQUIPMENT_Q_LADDER: List<Pair<EquipmentGrade, Int>> =
    EquipmentGrade.entries.filter { it.index <= DUNGEON_CEILING_GRADE.index }.flatMap { grade ->
        (1..EquipmentRules.MAX_ENHANCEMENT_LEVEL).map { level -> grade to level }
    }

internal data class DungeonReferenceState(
    val stage: Int,
    val days: Double,
    val level: Int,
    val grade: EquipmentGrade,
    val enhancement: Int,
    val gemLevel: Int,
    val cosmeticStar: Int,
    val skillGrade: EquipmentGrade,
    val skillLevel: Int,
) {
    val q: Int get() = grade.index * EquipmentRules.GRADE_Q_STRIDE + enhancement
}

/**
 * 7레벨 보석 6칸을 원하는 옵션으로 채우려면 몇 개를 만들어야 하는지. 30만 회 몬테카를로 결과다.
 *
 * 합성은 결과 옵션을 다시 뽑고 7레벨은 더 합성할 수 없으므로, 원하지 않는 옵션이 나오면 사장된다.
 * 보석은 거래 가능하니 시장이 완전히 돌면 착용 수량 6개까지 내려가지만, 기준 빌드는 시장 운을
 * 전제하지 않는다 — 메인 생성기가 기준 빌드에 시장을 넣지 않는 것과 같은 이유다.
 */
internal fun craftedGemsForPreset(boss: GemPreset): Double = when (boss) {
    GemPreset.SURVIVAL -> 17.1
    GemPreset.BERSERK -> 19.3
    GemPreset.ARMORED -> 22.1
    GemPreset.MAIN -> 18.0
}

/**
 * 6칸을 `level` 로 채우는 데 드는 1레벨 환산.
 *
 * 5레벨까지는 옵션이 고정 공격력과 고정 최대 HP 반반이라 낭비가 작고, 6레벨부터 특수 옵션이
 * 끼어들며 커진다. 7레벨은 몬테카를로 결과를 그대로 쓴다.
 */
internal fun gemConversionRequired(level: Int, boss: GemPreset): Double {
    require(level in 1..7) { "INVALID_GEM_LEVEL" }
    val unit = 3.0.pow(level - 1)
    return when {
        level == 7 -> craftedGemsForPreset(boss) * unit
        level == 6 -> 6.0 * unit * 1.6
        else -> 6.0 * unit * 1.15
    }
}

internal fun gemLevelFor(conversion: Double, boss: GemPreset): Int {
    var level = 0
    for (candidate in 1..7) {
        if (conversion >= gemConversionRequired(candidate, boss)) level = candidate else break
    }
    return level
}

/**
 * 도달 시간 등비 배치.
 *
 * 전력 기하 균등은 쓰지 않는다. 초반에는 스탯이 빨리 올라 같은 퍼센트 격차가 몇 분이고, 후반에는
 * 기어가서 같은 격차가 몇 주다. 시간으로 등비를 잡아야 단계마다 체감 벽이 고르게 커진다.
 */
internal fun ladderRho(firstDays: Double, ceilingDays: Double): Double =
    (ceilingDays / firstDays).pow(1.0 / (DUNGEON_CEILING_STAGE - 1))

internal fun ladderDays(stage: Int, firstDays: Double, ceilingDays: Double): Double {
    require(stage in 1..GemDungeonRewards.MAX_STAGE) { "INVALID_GEM_DUNGEON_STAGE" }
    return firstDays * ladderRho(firstDays, ceilingDays).pow(stage - 1)
}

/** 등비 배치의 역함수. 시각 `days` 에 플레이어가 도전 중인 단계다. */
internal fun stageAtDay(days: Double, firstDays: Double, ceilingDays: Double): Int {
    if (days <= firstDays) return 1
    val stage = 1 + ln(days / firstDays) / ln(ladderRho(firstDays, ceilingDays))
    return stage.toInt().coerceIn(1, DUNGEON_CEILING_STAGE)
}

/**
 * 해금부터 `days` 까지 쌓인 보석함.
 *
 * 소탕은 그 시점에 클리어해 둔 단계 단가로 하루 24장 들어오고, 레이드가 매일 조금 더한다. 최초
 * 클리어는 세 보스에서 한 번씩만 들어온다.
 */
internal fun cumulativeGemBoxes(days: Double, firstDays: Double, ceilingDays: Double, steps: Int = 20_000): Double {
    if (days <= firstDays) return 0.0
    val step = (days - firstDays) / steps
    var boxes = 0.0
    for (i in 0 until steps) {
        val stage = stageAtDay(firstDays + i * step, firstDays, ceilingDays)
        boxes += (GemDungeonRewards.sweepPerTicket(stage) * DUNGEON_TICKETS_PER_DAY + RAID_GEM_BOXES_PER_DAY) * step
    }
    /*
     * 도전하려는 단계의 최초 클리어 보상은 아직 없다. 직전 단계까지만 센다 — 자기 보상을 미리
     * 세면 그 단계를 깨는 데 그 단계의 보상이 필요한 모양이 된다.
     */
    val cleared = stageAtDay(days, firstDays, ceilingDays) - 1
    for (stage in 1..cleared) boxes += GemRules.DUNGEON_BOSSES.size * GemDungeonRewards.firstClear(stage)
    return boxes
}

/**
 * 장비·치장·스킬은 로그 시간에 선형으로 둔다.
 *
 * 단계가 시간 등비로 놓이므로 `u` 는 단계에 정비례한다. 세 축 모두 비용이 기하로 늘어나는 성장
 * (강화 비용, 뽑기 누적 임계, 스킬 승급 책 수량)이라 로그 시간 선형이 합리적인 근사다. 보석만
 * 실제 수급으로 따로 계산한다 — 던전 보상이 직접 정하는 축이라 가정으로 두면 안 된다.
 */
internal fun axisProgress(stage: Int): Double = (stage - 1).toDouble() / (DUNGEON_CEILING_STAGE - 1)

/**
 * 메인 진행 타임라인 위에 얹은 던전 사다리.
 *
 * `levelAtDay` 는 메인 진행에서 오고, 나머지 축은 로그 시간 위에 놓인다. 보석만 실제 수급으로
 * 따로 계산한다 — 던전 보상이 직접 정하는 축이라 가정으로 두면 순환을 숨기게 된다.
 */
internal class DungeonLadder(
    private val firstDays: Double,
    private val levelAtDay: (Double) -> Int,
    private val ceilingDays: Double = DUNGEON_CEILING_DAYS,
    /** 화력 곡선을 평탄화할 때 쓰는 측정자. 기본은 실제 전투 스탯 계산이다. */
    private val attackOf: (DungeonReferenceState, GemPreset) -> Int,
) {
    val rho: Double get() = ladderRho(firstDays, ceilingDays)

    fun daysFor(stage: Int): Double = ladderDays(stage.coerceAtMost(DUNGEON_CEILING_STAGE), firstDays, ceilingDays)

    fun gemBoxesAt(stage: Int): Double = cumulativeGemBoxes(daysFor(stage), firstDays, ceilingDays)

    /** 수급이 허락하는 보석 등급. 사다리는 이 값을 **상한**으로만 쓴다. */
    fun affordableGemLevel(stage: Int, boss: GemPreset): Int =
        gemLevelFor(gemBoxesAt(stage.coerceAtMost(DUNGEON_CEILING_STAGE)) * GEM_BOX_EXPECTED_CONVERSION, boss)

    fun stateFor(stage: Int, boss: GemPreset): DungeonReferenceState {
        val capped = stage.coerceAtMost(DUNGEON_CEILING_STAGE)
        val (equipmentIndex, plannedGem) = plan[capped - 1]
        return baseState(capped, equipmentIndex, minOf(plannedGem, affordableGemLevel(capped, boss)), stage)
    }

    private fun baseState(capped: Int, equipmentIndex: Int, gemLevel: Int, reportedStage: Int): DungeonReferenceState {
        val days = daysFor(capped)
        val u = axisProgress(capped)
        val (grade, enhancement) = EQUIPMENT_Q_LADDER[equipmentIndex]
        val skillSlot = (u * (SKILL_SLOTS - 1)).roundToInt().coerceIn(0, SKILL_SLOTS - 1)
        return DungeonReferenceState(
            stage = reportedStage,
            days = days,
            level = levelAtDay(days),
            grade = grade,
            enhancement = enhancement,
            gemLevel = gemLevel,
            cosmeticStar = (u * MAX_COSMETIC_STAR).roundToInt().coerceIn(0, MAX_COSMETIC_STAR),
            skillGrade = EquipmentGrade.entries[skillSlot / 10],
            skillLevel = skillSlot % 10 + 1,
        )
    }

    /**
     * 단계별 장비 강화 배분.
     *
     * 로그 시간 선형으로 두면 곡선이 들쭉날쭉해진다. 보석 레벨이나 스킬 등급이 오르는 칸은 화력이
     * 한 번에 +50~68% 뛰고, 강화만 오르는 칸은 +10~14% 에 그친다. 치명타가 판마다 ±18% 를
     * 흔들기 때문에 뒤쪽 칸은 직전 단계 빌드도 넘어온다 — 22일치 재화를 부어야 할 구간이
     * 공짜가 된다.
     *
     * 그래서 장비를 **메우는 축**으로 쓴다. 보석·치장·스킬은 수급과 시간이 정하고, 장비는 그
     * 결과가 균등한 등비 곡선이 되도록 칸마다 다르게 배분한다. 강화는 언제든 이어서 할 수 있는
     * 연속 축이라 이 역할에 맞는다. 총 비용은 달라지지 않는다 — 같은 +1~+30 을 몇 칸에 나눠
     * 담느냐만 바뀐다.
     */
    private val plan: List<Pair<Int, Int>> by lazy {
        val gauge = GemPreset.BERSERK
        val first = attackOf(baseState(1, EQUIPMENT_START_INDEX, 0, 1), gauge).toDouble()
        val last = attackOf(baseState(DUNGEON_CEILING_STAGE, EQUIPMENT_Q_LADDER.lastIndex, MAX_GEM_LEVEL, DUNGEON_CEILING_STAGE), gauge).toDouble()
        val ratio = (last / first).pow(1.0 / (DUNGEON_CEILING_STAGE - 1))
        /*
         * 천장에서 거꾸로 내려온다. 앞에서부터 목표에 가장 가까운 칸을 고르면 뒤로 갈수록 쓸 수
         * 있는 조합이 말라, 마지막 한두 칸이 붙어 버린다 (19단계가 +12% 에 그쳐 직전 빌드가 71%
         * 로 뚫렸다). 거꾸로 채우면 각 칸이 윗칸의 1/ratio 를 넘지 않도록 자리를 남겨 둔다.
         */
        val chosen = arrayOfNulls<Pair<Int, Int>>(DUNGEON_CEILING_STAGE)
        chosen[DUNGEON_CEILING_STAGE - 1] = EQUIPMENT_Q_LADDER.lastIndex to MAX_GEM_LEVEL
        chosen[0] = EQUIPMENT_START_INDEX to 0
        for (stage in DUNGEON_CEILING_STAGE - 1 downTo 2) {
            val above = chosen[stage]!!
            val target = attackOf(baseState(stage + 1, above.first, above.second, stage + 1), gauge) / ratio
            val cap = affordableGemLevel(stage, gauge)
            var best: Pair<Int, Int>? = null
            var bestAttack = Int.MIN_VALUE
            /*
             * 보석을 수급 곡선에 묶지 않는다. 초반 수급은 최초 클리어 보상이 앞으로 쏠려 있어
             * 화력 곡선보다 빨리 달리는데, 장비는 1단계 시작점 아래로 못 내려가므로 보석을 강제로
             * 올리면 그 구간이 들쭉날쭉해지고 직전 단계 빌드가 넘어온다. 기준 빌드는 "최소 스펙"
             * 이지 "그 시점의 평균 계정"이 아니며, 보석 SSOT 도 초반 클리어에 보석을 전제하지
             * 않는다. 수급은 상한으로만 쓴다.
             */
            for (gem in 0..minOf(cap, above.second)) {
                for (index in EQUIPMENT_START_INDEX..above.first) {
                    val attack = attackOf(baseState(stage, index, gem, stage), gauge)
                    if (attack <= target && attack > bestAttack) {
                        bestAttack = attack
                        best = index to gem
                    }
                }
            }
            chosen[stage - 1] = best ?: (EQUIPMENT_START_INDEX to 0)
        }
        chosen.map { it!! }
    }
}

/** 1단계 기준 빌드의 장비. 해금 시점의 노말 +13 이다. */
internal const val EQUIPMENT_START_INDEX = 12

/**
 * 노말 1 부터 영웅 10 까지. 전설이 해제된 뒤에도 30 을 유지한다.
 *
 * 이 값은 던전 진행도를 스킬 성장에 배분하는 분모라서, 40 으로 올리면 같은 진행도의 기준 빌드가
 * 강해지고 `generateDungeonStages` 가 만드는 30단계 수치가 전부 따라 올라간다. 그러면 전설로 얻은
 * 힘만큼 던전도 어려워져 상쇄된다. 전설은 던전을 기준보다 쉽게 뚫는 수단으로 둔다.
 */
internal const val SKILL_SLOTS = 30

internal const val MAX_COSMETIC_STAR = 5

/**
 * 활성 세트를 모두 같은 성급까지 올렸을 때 세 축에 붙는 값.
 *
 * 하드코딩하지 않는다. `docs/60-content/cosmetics/mvp-v1.md` 의 표(노말 5성 +1.00%)는 낡았고
 * 실제 콘텐츠는 그 열 배다(노말 1성 +2%, 5성 +10%). 문서를 믿고 상한을 +9.75% 로 잡았다가
 * 실제 +110% 와 열한 배 어긋난 적이 있다. 서버가 읽는 파일을 그대로 읽는다.
 */
internal fun cosmeticSetBasisPoints(star: Int): Int {
    require(star in 0..MAX_COSMETIC_STAR) { "INVALID_COSMETIC_STAR" }
    if (star == 0) return 0
    return cosmeticStarTotals[star - 1]
}

/** 서버가 읽는 치장 콘텐츠. `CosmeticsConfiguration` 이 `/cosmetics/cosmetics.json` 을 쓴다. */
private val cosmeticStarTotals: IntArray by lazy {
    val root = ObjectMapper().readTree(File("packages/game-content/versions/v1/cosmetics/cosmetics.json"))
    IntArray(MAX_COSMETIC_STAR) { index ->
        val star = index + 1
        root.path("sets").filter { it.path("active").asBoolean(true) }.sumOf { set ->
            set.path("effects").firstOrNull { it.path("star").asInt() == star }
                ?.path("effects")?.firstOrNull { it.path("statId").asText() == "attackPercent" }
                ?.path("value")?.asInt() ?: 0
        }
    }
}

internal data class GemContribution(
    val flatAttack: Int = 0,
    val flatHp: Int = 0,
    val attackPercentBasisPoints: Int = 0,
    val flatPenetration: Int = 0,
)

/** 보석 구성을 전투 스탯으로 합산한다. 같은 종류의 특수 옵션도 장착한 수만큼 누적된다. */
internal fun gemBonus(options: List<GemOption>, level: Int): GemContribution {
    if (options.isEmpty() || level <= 0) return GemContribution()
    return GemContribution(
        flatAttack = options.count { it == GemOption.FLAT_ATTACK } * GemRules.fixedValue(level, GemOption.FLAT_ATTACK),
        flatHp = options.count { it == GemOption.FLAT_HP } * GemRules.fixedValue(level, GemOption.FLAT_HP),
        attackPercentBasisPoints = options.count { it == GemOption.ATTACK_PERCENT } * GemRules.fixedValue(level, GemOption.ATTACK_PERCENT),
        flatPenetration = options.count { it == GemOption.FLAT_PENETRATION } * GemRules.fixedValue(level, GemOption.FLAT_PENETRATION),
    )
}

/** 보스별 기준 보석 구성. 검사축에 맞는 옵션만 쓴다. 특수 옵션은 6레벨부터 존재한다. */
internal fun referenceGemOptions(boss: GemPreset, level: Int): List<GemOption> = when {
    level <= 0 -> emptyList()
    boss == GemPreset.SURVIVAL -> List(6) { GemOption.FLAT_HP }
    level < 6 -> List(6) { GemOption.FLAT_ATTACK }
    boss == GemPreset.BERSERK -> List(5) { GemOption.FLAT_ATTACK } + GemOption.ATTACK_PERCENT
    else -> List(4) { GemOption.FLAT_ATTACK } + GemOption.ATTACK_PERCENT + GemOption.FLAT_PENETRATION
}

/** 메인 진행 타임라인에서 던전 사다리를 만든다. 전투분을 실시간 일로 환산해 축을 맞춘다. */
internal fun buildDungeonLadder(arrivals: Map<Int, Double>): DungeonLadder {
    val unlockDays = arrivals.getValue(DUNGEON_UNLOCK_STAGE_INDEX) / COMBAT_MINUTES_PER_DAY
    val byDay = arrivals.entries.sortedBy { it.value }
        .map { (index, minutes) -> minutes / COMBAT_MINUTES_PER_DAY to referenceLevel(index) }
    val mainCompleteDays = byDay.last().first
    return DungeonLadder(
        firstDays = unlockDays,
        attackOf = ::dungeonFighterAttack,
        levelAtDay = { days ->
            /*
             * 메인을 끝내면 기준 레벨이 199 에서 멈춘다. 상한 200 은 완주 뒤 반복 파밍으로
             * 채운다. 한 레벨 차이라 완주 시점의 두 배를 지나면 도달한 것으로 둔다.
             */
            val fromMain = byDay.lastOrNull { it.first <= days }?.second ?: byDay.first().second
            if (days >= mainCompleteDays * 2) MAX_PLAYER_LEVEL else fromMain.coerceAtMost(MAX_PLAYER_LEVEL)
        },
    )
}

/**
 * 원래는 `progression.json` 의 `levelRange.max` 를 그대로 옮긴 값이었다. 11-15장
 * 확장(2026-09-27)으로 콘텐츠 상한은 300으로 올랐지만, 이 상수는 보석 던전 사다리의
 * 기준선이라 값을 그대로 200에 둔다 — 던전 상한 재산출은 별도 작업이다.
 */
internal const val MAX_PLAYER_LEVEL = 200

fun main() {
    val content = loadProgressionSimulationContent()
    val ladder = buildDungeonLadder(referenceArrivalMinutes(1L, content))
    val rows = (1..GemDungeonRewards.MAX_STAGE).map { stage ->
        val state = ladder.stateFor(stage, GemPreset.BERSERK)
        listOf(
            stage.toString(),
            "%.2f".format(state.days),
            state.level.toString(),
            "${state.grade.name}+${state.enhancement}",
            state.q.toString(),
            "%.0f".format(ladder.gemBoxesAt(stage)),
        ) + GemRules.DUNGEON_BOSSES.map { ladder.stateFor(stage, it).gemLevel.toString() } + listOf(
            state.cosmeticStar.toString(),
            "${state.skillGrade.name}${state.skillLevel}",
            if (stage > DUNGEON_CEILING_STAGE) "UNREACHABLE" else "REACHABLE",
        )
    }
    val header = "stage,days,level,equipment,q,gemBoxes,survivalGem,berserkGem,armoredGem,cosmeticStar,skill,reachable"
    val output = File("build/reports/balance/gem-dungeon-ladder.csv")
    output.parentFile.mkdirs()
    output.writeText(header + "\n" + rows.joinToString("\n") { it.joinToString(",") } + "\n")
    println("ceilingStage=$DUNGEON_CEILING_STAGE ceilingDays=${DUNGEON_CEILING_DAYS.toInt()} rho=%.4f report=${output.path}".format(ladder.rho))
}

/** 장비 배분을 풀 때 쓰는 화력 측정자. 실제 전투 스탯 계산을 그대로 쓴다. */
internal fun dungeonFighterAttack(state: DungeonReferenceState, boss: GemPreset): Int =
    dungeonFighter(state, boss).attack

/** 보석 최고 등급. */
internal const val MAX_GEM_LEVEL = 7
