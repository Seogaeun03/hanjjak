package com.hanjjak.inventory.domain

import kotlin.random.Random

enum class DropMode { GUARANTEED, CHANCE }

data class ChapterDropPolicy(
    val mode: DropMode,
    val normalQuantity: Long,
    val bossQuantity: Long,
    val generationWeights: List<Int>,
) {
    init {
        require(normalQuantity > 0 && bossQuantity > 0)
        require(generationWeights.isNotEmpty() && generationWeights.all { it >= 0 } && generationWeights.any { it > 0 })
    }
}

data class MaterialDropContent(
    val contentVersion: String,
    val dropChanceBasisPoints: Int,
    val quantityPerSuccess: Long,
    val normalEnemyRolls: Int,
    val bossRolls: Int,
    val chapterGenerationWeights: Map<Int, List<Int>>,
    val chapterPolicies: Map<Int, ChapterDropPolicy> = emptyMap(),
) {
    init {
        require(contentVersion.isNotBlank())
        require(dropChanceBasisPoints in 0..10_000)
        require(quantityPerSuccess > 0)
        require(normalEnemyRolls >= 0 && bossRolls >= 0)
        /* 세대 수는 콘텐츠가 정한다. 챕터와 세대를 1:1로 묶어 두면 "챕터 4부터 3세대" 같은
           배치를 표현할 수 없어서, 여기서는 배치의 모양만 지킨다. */
        require(chapterGenerationWeights.isNotEmpty()) { "NO_CHAPTER_DECLARED" }
        val declaredChapters = chapterGenerationWeights.keys.sorted()
        require(declaredChapters == (1..declaredChapters.size).toList()) { "CHAPTERS_MUST_START_AT_ONE_WITHOUT_GAPS" }
        val generationCount = chapterGenerationWeights.getValue(1).size
        require(generationCount > 0) { "NO_GENERATION_DECLARED" }
        var openedBefore = 0
        for (chapter in declaredChapters) {
            val weights = chapterGenerationWeights.getValue(chapter)
            require(weights.size == generationCount) { "GENERATION_WIDTH_MISMATCH" }
            require(weights.all { it >= 0 }) { "NEGATIVE_GENERATION_WEIGHT" }
            val opened = weights.indexOfLast { it > 0 } + 1
            require(opened > 0) { "CHAPTER_OPENS_NO_GENERATION" }
            require(weights.take(opened).all { it > 0 }) { "GENERATION_GAP" }
            require(opened >= openedBefore) { "GENERATIONS_MUST_NOT_CLOSE" }
            openedBefore = opened
        }
        require(chapterPolicies.isEmpty() || chapterPolicies.all { (chapter, policy) -> policy.generationWeights == chapterGenerationWeights[chapter] }) { "POLICY_WEIGHT_MISMATCH" }
    }

    companion object {
        fun working() = MaterialDropContent(
            contentVersion = "material-drops-v1-draft",
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
        )
    }
}

class DropTable(val content: MaterialDropContent = MaterialDropContent.working()) {
    val contentVersion: String get() = content.contentVersion

    fun rollStage(
        stageId: String,
        primaryMaterial: MaterialType,
        seed: Long,
        defeatedNormals: Int,
        bossDefeated: Boolean,
    ): List<ItemReward> {
        require(defeatedNormals in 0..20) { "INVALID_DEFEATED_NORMALS" }
        val rewards = (1..defeatedNormals).flatMap { enemyIndex ->
            rollEnemy(stageId, primaryMaterial, seed, enemyIndex, false)
        } + if (bossDefeated) rollEnemy(stageId, primaryMaterial, seed, 21, true) else emptyList()
        return aggregate(rewards)
    }

    fun rollEnemy(
        stageId: String,
        primaryMaterial: MaterialType,
        seed: Long,
        enemyIndex: Int,
        boss: Boolean,
    ): List<ItemReward> {
        require((boss && enemyIndex in 1..21) || (!boss && enemyIndex in 1..20)) { "INVALID_ENEMY_INDEX" }
        val (chapter, stageNumber) = parseStage(stageId)
        if (stageNumber == 10) return emptyList()
        val random = Random(enemySeed(seed, enemyIndex, boss))
        val rewards = mutableListOf<ItemReward>()
        val policy = content.chapterPolicies[chapter]
        if (policy?.mode == DropMode.GUARANTEED) {
            val generation = weighted(random, policy.generationWeights.mapIndexed { index, weight -> index to weight }) + 1
            val material = weighted(random, materialWeights(primaryMaterial))
            rewards += ItemReward("${material.name}_M$generation", if (boss) policy.bossQuantity else policy.normalQuantity)
        } else {
            val materialRolls = if (boss) content.bossRolls else content.normalEnemyRolls
            repeat(materialRolls) {
                if (random.nextInt(10_000) < content.dropChanceBasisPoints) {
                    val weights = policy?.generationWeights ?: content.chapterGenerationWeights.getValue(chapter)
                    val generation = weighted(random, weights.mapIndexed { index, weight -> index to weight }) + 1
                    val material = weighted(random, materialWeights(primaryMaterial))
                    val quantity = policy?.let { if (boss) it.bossQuantity else it.normalQuantity } ?: content.quantityPerSuccess
                    rewards += ItemReward("${material.name}_M$generation", quantity)
                }
            }
        }
        SKILL_BOOK_DROPS.forEach { drop ->
            if (drop.enabled && chapter >= drop.unlockChapter && random.nextInt(10_000) < drop.basisPoints) {
                rewards += ItemReward(skillBookId(drop.grade, random), 1)
            }
        }
        return aggregate(rewards)
    }

    private fun aggregate(rewards: List<ItemReward>): List<ItemReward> = rewards
        .groupingBy { it.itemId }
        .fold(0L) { quantity, reward -> quantity + reward.quantity }
        .toSortedMap()
        .map { (itemId, quantity) -> ItemReward(itemId, quantity) }

    private fun enemySeed(seed: Long, enemyIndex: Int, boss: Boolean): Long =
        seed xor (enemyIndex.toLong() * -7046029254386353131L) xor if (boss) -4658895280553007687L else 0L

    private fun skillBookId(grade: String, random: Random): String {
        val skill = SKILLS[random.nextInt(SKILLS.size)]
        return "skillbook:$skill:$grade"
    }

    private fun materialWeights(primary: MaterialType): List<Pair<MaterialType, Int>> = MaterialType.entries.map {
        it to if (it == primary) 80 else 10
    }

    private fun <T> weighted(random: Random, values: List<Pair<T, Int>>): T {
        val total = values.sumOf { it.second }
        var roll = random.nextInt(total)
        for ((value, weight) in values) {
            if (roll < weight) return value
            roll -= weight
        }
        error("invalid weight table")
    }

    private fun parseStage(stageId: String): Pair<Int, Int> {
        val parts = stageId.removePrefix("stage.").split("-")
        require(parts.size == 2) { "INVALID_STAGE_ID" }
        val chapter = parts[0].toIntOrNull() ?: throw IllegalArgumentException("INVALID_STAGE_ID")
        val stage = parts[1].toIntOrNull() ?: throw IllegalArgumentException("INVALID_STAGE_ID")
        require(chapter in 1..15 && stage in 1..10) { "INVALID_STAGE_ID" }
        return chapter to stage
    }

    private data class SkillBookDrop(val grade: String, val unlockChapter: Int, val basisPoints: Int, val enabled: Boolean = true)

    companion object {
        private val SKILLS = listOf("active_heavy", "active_dot", "active_haste", "active_basic_amp", "passive_critical", "passive_all_damage")
        // Every grade rolls independently and keeps its own rate for the rest of the run. Unlocking a
        // higher grade adds a roll instead of taking share away from the grades below it.
        // `enabled` pairs with skills.json's mvpMaxGrade: it is the drop-side half of the rollback
        // lever. If promotion is ever re-locked (mvpMaxGrade lowered back to EPIC), set legendary's
        // `enabled` back to false too, or unusable legendary books keep accumulating.
        private val SKILL_BOOK_DROPS = listOf(
            SkillBookDrop("normal", 1, 75),
            SkillBookDrop("rare", 2, 50),
            SkillBookDrop("epic", 4, 25),
            SkillBookDrop("legendary", 6, 10),
        )
    }
}
