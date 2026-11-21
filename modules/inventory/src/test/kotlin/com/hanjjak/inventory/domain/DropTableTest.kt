package com.hanjjak.inventory.domain

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DropTableTest {
    // MaterialDropContent.working() only carries chapter 1-4 material weights; chapters 5-15 run on the
    // applied content version, so mirror its chapter-4 mix here to exercise the later chapters.
    private val drops = DropTable(
        MaterialDropContent.working().let { base ->
            base.copy(chapterGenerationWeights = base.chapterGenerationWeights + (5..15).associateWith { listOf(125, 25, 5, 1) })
        },
    )

    @Test
    fun `grade unlock stages can drop books for every skill`() {
        val rareSkills = booksEndingWith("stage.02-01", ":rare")
        val epicSkills = booksEndingWith("stage.04-01", ":epic")

        assertEquals(SKILL_BOOK_IDS.map { "skillbook:$it:rare" }.toSet(), rareSkills)
        assertEquals(SKILL_BOOK_IDS.map { "skillbook:$it:epic" }.toSet(), epicSkills)
    }

    @Test
    fun `legendary books enter the pool at chapter six`() {
        assertTrue(booksEndingWith("stage.05-09", ":legendary").isEmpty())
        assertEquals(SKILL_BOOK_IDS.map { "skillbook:$it:legendary" }.toSet(), booksEndingWith("stage.06-01", ":legendary"))
        assertEquals(SKILL_BOOK_IDS.map { "skillbook:$it:legendary" }.toSet(), booksEndingWith("stage.10-09", ":legendary"))
    }

    @Test
    fun `each grade keeps its own rate and a higher grade only adds to it`() {
        mapOf(
            "stage.01-09" to listOf("normal"),
            "stage.03-09" to listOf("normal", "rare"),
            "stage.05-09" to listOf("normal", "rare", "epic"),
            "stage.10-09" to listOf("normal", "rare", "epic", "legendary"),
        ).forEach { (stageId, unlocked) ->
            val counts = gradeCounts(stageId)
            assertEquals(unlocked.toSet(), counts.keys, "$stageId unlocked grades")
            unlocked.forEach { grade ->
                val expected = GRADE_BASIS_POINTS.getValue(grade)
                val observed = counts.getValue(grade) * 10_000.0 / SAMPLES
                assertTrue(
                    abs(observed - expected) <= expected * 0.15,
                    "$stageId $grade dropped at $observed bp, expected $expected bp",
                )
            }
        }
    }

    @Test
    fun `same stage preference and seed produce the same drops`() {
        val first = drops.rollStage("stage.04-09", MaterialType.POTATO, 42, 20, true)
        val second = drops.rollStage("stage.04-09", MaterialType.POTATO, 42, 20, true)
        assertEquals(first, second)
    }

    @Test
    fun `chapters eleven to fifteen roll drops and chapter sixteen is rejected`() {
        assertEquals(SKILL_BOOK_IDS.map { "skillbook:$it:legendary" }.toSet(), booksEndingWith("stage.15-09", ":legendary"))
        assertFailsWith<IllegalArgumentException> { drops.rollEnemy("stage.16-01", MaterialType.POTATO, 1L, 1, false) }
    }

    @Test
    fun `stage rewards are the sum of deterministic enemy rewards`() {
        val expected = ((1..7).flatMap { drops.rollEnemy("stage.03-04", MaterialType.CORN, 99, it, false) } +
            drops.rollEnemy("stage.03-04", MaterialType.CORN, 99, 21, true))
            .groupingBy { it.itemId }
            .fold(0L) { quantity, reward -> quantity + reward.quantity }
            .toSortedMap()
            .map { (itemId, quantity) -> ItemReward(itemId, quantity) }

        assertEquals(expected, drops.rollStage("stage.03-04", MaterialType.CORN, 99, 7, true))
    }


    @Test
    fun `breakthrough stages never drop items`() {
        assertTrue(drops.rollStage("stage.04-10", MaterialType.CORN, 42, 20, true).isEmpty())
    }

    @Test
    fun `material identifiers remain inside the chapter generation pool`() {
        repeat(1_000) { seed ->
            val results = drops.rollStage("stage.02-09", MaterialType.SWEET_POTATO, seed.toLong(), 20, true)
            assertTrue(results.filter { !it.itemId.startsWith("skillbook:") }.all { it.itemId.endsWith("M1") || it.itemId.endsWith("M2") })
        }
    }
    @Test
    fun `rebalance chapter one guarantees two normal and ten boss material units`() {
        val content = MaterialDropContent(
            contentVersion = "progression-rebalance-v1",
            dropChanceBasisPoints = 1_500,
            quantityPerSuccess = 10,
            normalEnemyRolls = 1,
            bossRolls = 5,
            chapterGenerationWeights = mapOf(
                1 to listOf(1, 0, 0, 0),
                2 to listOf(5, 1, 0, 0),
                3 to listOf(25, 5, 1, 0),
                4 to listOf(125, 25, 5, 1),
            ),
            chapterPolicies = mapOf(
                1 to ChapterDropPolicy(DropMode.GUARANTEED, 2, 10, listOf(1, 0, 0, 0)),
                2 to ChapterDropPolicy(DropMode.CHANCE, 10, 10, listOf(5, 1, 0, 0)),
                3 to ChapterDropPolicy(DropMode.CHANCE, 10, 10, listOf(25, 5, 1, 0)),
                4 to ChapterDropPolicy(DropMode.CHANCE, 10, 10, listOf(125, 25, 5, 1)),
            ),
        )
        val materials = DropTable(content).rollStage("stage.01-09", MaterialType.CORN, 99, 20, true)
            .filterNot { it.itemId.startsWith("skillbook:") }

        assertEquals(50, materials.sumOf { it.quantity })
        assertTrue(materials.all { it.itemId.endsWith("M1") })
    }

    private fun booksEndingWith(stageId: String, suffix: String): Set<String> = (0L until SAMPLES)
        .flatMap { seed -> drops.rollEnemy(stageId, MaterialType.POTATO, seed, 1, false) }
        .mapNotNull { reward -> reward.itemId.takeIf { it.endsWith(suffix) } }
        .toSet()

    private fun gradeCounts(stageId: String): Map<String, Int> = (0L until SAMPLES)
        .flatMap { seed -> drops.rollEnemy(stageId, MaterialType.POTATO, seed, 1, false) }
        .filter { it.itemId.startsWith("skillbook:") }
        .groupingBy { it.itemId.substringAfterLast(":") }
        .eachCount()

    @Test
    fun `a fifth generation drops once the content declares it`() {
        val table = DropTable(generationContent(FIVE_GENERATION_WEIGHTS))
        val generations = (0L until 200_000L)
            .flatMap { seed -> table.rollEnemy("stage.05-01", MaterialType.POTATO, seed, 1, false) }
            .mapNotNull { reward -> reward.itemId.takeIf { it.startsWith("POTATO_M") } }
            .toSet()

        assertEquals((1..5).map { "POTATO_M$it" }.toSet(), generations)
    }

    @Test
    fun `generation layouts that cannot happen are rejected`() {
        // 세대 사이에 빈틈
        assertFailsWith<IllegalArgumentException> { generationContent(mapOf(1 to listOf(1, 0, 1, 0))) }
        // 앞 챕터가 연 세대를 뒤 챕터가 닫음
        assertFailsWith<IllegalArgumentException> { generationContent(mapOf(1 to listOf(5, 1), 2 to listOf(1, 0))) }
        // 챕터마다 폭이 다름
        assertFailsWith<IllegalArgumentException> { generationContent(mapOf(1 to listOf(1, 0), 2 to listOf(5, 1, 0))) }
        // 챕터 번호에 구멍
        assertFailsWith<IllegalArgumentException> { generationContent(mapOf(1 to listOf(1, 0), 3 to listOf(5, 1))) }
        // 아무 세대도 열지 않음
        assertFailsWith<IllegalArgumentException> { generationContent(mapOf(1 to listOf(0, 0))) }
    }

    private fun generationContent(weights: Map<Int, List<Int>>) = MaterialDropContent(
        contentVersion = "generation-layout-test",
        dropChanceBasisPoints = 10_000,
        quantityPerSuccess = 1,
        normalEnemyRolls = 1,
        bossRolls = 1,
        chapterGenerationWeights = weights,
    )

    companion object {
        private const val SAMPLES = 300_000L
        private val FIVE_GENERATION_WEIGHTS = mapOf(
            1 to listOf(1, 0, 0, 0, 0),
            2 to listOf(5, 1, 0, 0, 0),
            3 to listOf(25, 5, 1, 0, 0),
            4 to listOf(125, 25, 5, 1, 0),
            5 to listOf(625, 125, 25, 5, 1),
        )
        private val GRADE_BASIS_POINTS = mapOf("normal" to 75, "rare" to 50, "epic" to 25, "legendary" to 10)
        private val SKILL_BOOK_IDS = listOf(
            "active_heavy",
            "active_dot",
            "active_haste",
            "active_basic_amp",
            "passive_critical",
            "passive_all_damage",
        )
    }
}
