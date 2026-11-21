package com.hanjjak.balancelab

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ProgressionRebalanceTest {
    @Test
    fun `reference progression meets chapter arrival and boss gates`() {
        val report = simulateProgressionRebalance(1L..300L)

        val p50 = (1..LAST_CHAPTER).map { report.chapter(it).p50Minutes }
        assertTrue(p50.zipWithNext().all { (earlier, later) -> later > earlier }, report.toCsv())
        assertTrue((1..LAST_CHAPTER).all { report.chapter(it).p90Minutes >= report.chapter(it).p50Minutes }, report.toCsv())
        assertTrue(report.bosses.all { it.referenceSuccessRate >= 0.90 }, report.toCsv())
        assertTrue(report.bosses.all { it.deficientSuccessRate < it.referenceSuccessRate }, report.toCsv())
        assertTrue(report.promotion("NORMAL_TO_RARE").p50StageIndex <= 15)
        assertTrue(report.promotion("RARE_TO_EPIC").p50StageIndex <= 35)
    }

    @Test
    fun `chapter one normal hp is cut while boss pools and later chapters keep generated values`() {
        val rows = generatedStageRows()
        fun row(id: String) = rows.first { it.id == id }

        assertEquals(0.7, CHAPTER_ONE_NORMAL_HP_SCALE)
        assertEquals(441, row("stage.01-01").normalHp)
        assertEquals(1547, row("stage.01-09").normalHp)
        assertEquals(1694, row("stage.01-10").normalHp)
        assertEquals(2630, row("stage.02-01").normalHp)

        // Growth walls keep the pools the boss search accepted.
        assertEquals(3210, row("stage.01-01").bossHp)
        assertEquals(4162, row("stage.01-04").bossHp)
        assertEquals(7422, row("stage.01-07").bossHp)
        assertEquals(4841, row("stage.01-10").bossHp)
        assertEquals(8208, row("stage.02-01").bossHp)
    }

    @Test
    fun `generator covers one hundred fifty stages with rotating growth walls`() {
        val rows = generatedStageRows()

        assertEquals(150, rows.size)
        assertEquals("stage.15-10", rows.last().id)
        assertEquals(299, rows.last().level)
        assertEquals("PENETRATION_CHECK", bossTypeFor(5, 4))
        assertEquals("ATTACK_CHECK", bossTypeFor(5, 7))
        assertEquals("HP_CHECK", bossTypeFor(5, 10))
        assertEquals("PENETRATION_CHECK", bossTypeFor(10, 10))
        assertEquals("STANDARD", bossTypeFor(10, 9))
        assertEquals("PENETRATION_CHECK", bossTypeFor(11, 4))
        assertEquals("HP_CHECK", bossTypeFor(11, 10))
        assertEquals("PENETRATION_CHECK", bossTypeFor(13, 10))
        assertEquals("ATTACK_CHECK", bossTypeFor(15, 10))
    }

    @Test
    fun `extending to chapter fifteen keeps chapter ten values`() {
        val rows = generatedStageRows()
        fun row(id: String) = rows.first { it.id == id }

        // 2026-09-27 content values before the extension. The generator is seeded and deterministic.
        assertEquals(342_637, row("stage.10-10").bossHp)
        assertEquals(14_369, row("stage.10-10").bossAttack)
        assertEquals(1_696, row("stage.10-10").defense)
        assertEquals(1_008_318, row("stage.10-09").bossHp)
        assertEquals(164_396, row("stage.10-09").normalHp)
    }

    @Test
    fun `normal attack tracks reference max hp instead of a flat ramp`() {
        val rows = generatedStageRows()
        val early = rows.first { it.id == "stage.01-01" }
        val late = rows.first { it.id == "stage.10-09" }

        assertTrue(early.normalAttack >= 4, "early attack should not be the old 2-point ramp: ${early.normalAttack}")
        assertTrue(late.normalAttack > early.normalAttack * 10, "late attack should scale with reference HP: ${late.normalAttack}")
    }

    @Test
    fun `reference q keeps climbing through chapter fifteen`() {
        assertEquals(93, referenceQ(40))
        assertEquals(231, referenceQ(100))
        assertEquals(254, referenceQ(110))
        assertEquals(346, referenceQ(150))
        assertTrue((1..LAST_STAGE_INDEX).map(::referenceQ).zipWithNext().all { (left, right) -> right >= left })
    }

    @Test
    fun `q endpoints and interpolation are monotone and cycle drops are exact`() {
        assertEquals(25, referenceQ(10))
        assertEquals(54, referenceQ(20))
        assertEquals(64, referenceQ(30))
        assertEquals(93, referenceQ(40))
        assertEquals(2 * 17 - 1, referenceLevel(17))
        assertTrue((1..39).map(::referenceQ).zipWithNext().all { it.first <= it.second })

        val report = simulateProgressionRebalance(1L..1L)
        assertEquals(50L, report.chapterOneM1PerFullCycle)
        assertEquals(0L, report.stageTenRepeatItems)
    }

    @Test
    fun `boss checks rotate by chapter and late bosses use fixed gem presets`() {
        assertEquals("ATTACK_CHECK", bossTypeFor(1, 4))
        assertEquals("PENETRATION_CHECK", bossTypeFor(2, 4))
        assertEquals("HP_CHECK", bossTypeFor(3, 4))
        assertEquals("ATTACK_CHECK", bossTypeFor(3, 10))
        assertEquals(listOf(2, 2, 2, 3, 3, 3), referenceGemLevels(30))
        assertEquals(List(6) { 4 }, referenceGemLevels(40))
    }

    @Test
    fun `cohort economy reports peer matched market and separate cohorts`() {
        val report = simulateProgressionRebalance(1L..300L)
        assertEquals(300, report.cohortCount)
        assertEquals(3, report.cohorts.size)
        assertTrue(report.cohorts.first { it.kind == CohortKind.MARKET_USE }.accountCount > 0)
        assertTrue(report.cohorts.first { it.kind == CohortKind.MARKET_USE }.filledOrders > 0)
        assertTrue(report.cohorts.first { it.kind == CohortKind.NO_MARKET }.accountCount > 0)
        assertEquals(0L, report.cohorts.first { it.kind == CohortKind.NO_MARKET }.requestedOrders)
        assertTrue(report.cohorts.first { it.kind == CohortKind.MARKET_LIQUIDITY_SHORTAGE }.accountCount > 0)
        assertTrue(report.cohorts.first { it.kind == CohortKind.MARKET_LIQUIDITY_SHORTAGE }.requestedOrders > 0)
        assertTrue(report.marketVolume > 0, report.toEconomyJson())
        assertTrue(report.marketSellerFee in 0..report.marketGrossAmount / 10, report.toEconomyJson())
        assertEquals(0L, report.marketSystemSellerQuantity)
        assertTrue(report.marketUnmatchedQuantity > 0, report.toEconomyJson())
    }

    @Test
    fun `applied progression experience changes arrival time`() {
        val content = loadProgressionSimulationContent()
        val slower = content.copy(
            progression = content.progression.map { reward ->
                reward.copy(normalExperience = (reward.normalExperience / 2).coerceAtLeast(1))
            },
        )

        val reference = simulateProgressionRebalance(1L..30L, content)
        val changed = simulateProgressionRebalance(1L..30L, slower)

        assertTrue(changed.chapter(1).p50Minutes > reference.chapter(1).p50Minutes)
    }

    @Test
    fun `first clear and material inputs affect economy transitions`() {
        val content = loadProgressionSimulationContent()
        val withoutFirstClear = content.copy(
            progression = content.progression.map { reward ->
                reward.copy(firstClearRice = 0, firstClearItems = emptyMap())
            },
        )
        val withoutDrops = content.copy(
            dropTable = com.hanjjak.inventory.domain.DropTable(
                com.hanjjak.inventory.domain.MaterialDropContent(
                    contentVersion = "sensitivity",
                    dropChanceBasisPoints = 0,
                    quantityPerSuccess = 10,
                    normalEnemyRolls = 1,
                    bossRolls = 0,
                    chapterGenerationWeights = mapOf(
                        1 to listOf(1, 0, 0, 0),
                        2 to listOf(5, 1, 0, 0),
                        3 to listOf(25, 5, 1, 0),
                        4 to listOf(125, 25, 5, 1),
                    ),
                ),
            ),
        )

        val reference = simulateProgressionRebalance(1L..30L, content)
        val firstClearChanged = simulateProgressionRebalance(1L..30L, withoutFirstClear)
        val withoutDropsReport = simulateProgressionRebalance(1L..30L, withoutDrops)

        assertNotEquals(firstClearChanged.riceSupply, reference.riceSupply, "reference=${reference.toEconomyJson()} changed=${firstClearChanged.toEconomyJson()}")
        assertTrue(withoutDropsReport.cohorts.all { it.p50ChapterFourMinutes >= reference.cohorts.first { cohort -> cohort.kind == it.kind }.p50ChapterFourMinutes })
    }

    @Test
    fun `loaded impossible stage cannot advance through arithmetic rewards`() {
        val content = loadProgressionSimulationContent()
        val impossible = content.copy(
            stages = content.stages.mapIndexed { index, stage ->
                if (index == 0) stage.copy(normalHp = Int.MAX_VALUE, normalAttack = Int.MAX_VALUE) else stage
            },
        )

        val failure = assertFailsWith<IllegalStateException> {
            simulateProgressionRebalance(1L..1L, impossible)
        }

        assertTrue(failure.message.orEmpty().contains("stage.01-01"))
    }

    private fun assertInRange(actual: Double, min: Double, max: Double) {
        assertTrue(actual in min..max, "expected $actual in [$min, $max]")
    }
}
