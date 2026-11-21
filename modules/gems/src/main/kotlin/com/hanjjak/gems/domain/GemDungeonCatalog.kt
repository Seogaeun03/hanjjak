package com.hanjjak.gems.domain

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.InputStream

data class GemDungeonBossDefinition(
    val boss: GemPreset,
    val stage: Int,
    val bossHp: Int,
    val bossAttack: Int,
    val defense: Int,
    val strikeDamage: Int,
    val strikeIntervalTicks: Int,
    val damageFloorBasisPoints: Int,
)

class GemDungeonCatalog private constructor(
    val contentVersion: String,
    val durationTicks: Int,
    val completionWindowSeconds: Long,
    /** 이 콘텐츠가 제공하는 마지막 단계. 단계 상한은 코드 상수가 아니라 여기서 온다. */
    val maxStage: Int,
    private val definitions: Map<Pair<GemPreset, Int>, GemDungeonBossDefinition>,
) {
    fun require(boss: GemPreset, stage: Int): GemDungeonBossDefinition =
        definitions[boss to stage] ?: throw IllegalArgumentException("GEM_DUNGEON_STAGE_NOT_FOUND")

    companion object {
        /** 콘텐츠가 생략했을 때 쓰는 값. `DungeonBossStats` 의 기본값과 같아야 한다. */
        private const val DEFAULT_STRIKE_INTERVAL_TICKS = 20
        private const val DEFAULT_DAMAGE_FLOOR_BASIS_POINTS = 5_000

        fun load(mapper: ObjectMapper, input: InputStream, expectedAuthority: String = "applied"): GemDungeonCatalog {
            val root = mapper.readTree(input)
            require(root.path("authority").asText() == expectedAuthority) { "GEM_DUNGEON_CONTENT_NOT_APPLIED" }
            val values = root.path("bosses").flatMap { bossNode ->
                val boss = GemPreset.valueOf(bossNode.path("bossType").asText())
                bossNode.path("stages").map { stageNode ->
                    GemDungeonBossDefinition(
                        boss,
                        stageNode.path("stage").asInt(),
                        stageNode.path("bossHp").asInt(),
                        stageNode.path("bossAttack").asInt(),
                        stageNode.path("defense").asInt(),
                        stageNode.path("strikeDamage").asInt(),
                        stageNode.path("strikeIntervalTicks").asInt(DEFAULT_STRIKE_INTERVAL_TICKS),
                        stageNode.path("damageFloorBasisPoints").asInt(DEFAULT_DAMAGE_FLOOR_BASIS_POINTS),
                    )
                }
            }
            /*
             * 단계 수를 상수로 못 박지 않는다. 승격 전 콘텐츠는 재현·롤백 경로로 남기 때문에,
             * 30단계를 요구하면 10단계짜리 구 버전이 로드되지 않는다. 대신 세 보스가 모두 있고
             * 각자 1..N 연속인지만 보고 N 을 상한으로 쓴다.
             */
            val byBoss = values.groupBy { it.boss }
            require(byBoss.keys == GemRules.DUNGEON_BOSSES.toSet()) { "INVALID_GEM_DUNGEON_CONTENT" }
            val maxStage = byBoss.values.first().size
            require(
                byBoss.values.all { stages ->
                    stages.size == maxStage && stages.map { it.stage }.sorted() == (1..maxStage).toList()
                },
            ) { "INVALID_GEM_DUNGEON_CONTENT" }
            return GemDungeonCatalog(
                root.path("contentVersion").asText(),
                root.path("durationTicks").asInt(),
                root.path("completionWindowSeconds").asLong(),
                maxStage,
                values.associateBy { it.boss to it.stage },
            )
        }
    }
}
