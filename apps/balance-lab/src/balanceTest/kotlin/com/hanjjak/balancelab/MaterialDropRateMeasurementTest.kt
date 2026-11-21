package com.hanjjak.balancelab

import com.fasterxml.jackson.databind.ObjectMapper
import com.hanjjak.inventory.domain.DropTable
import com.hanjjak.inventory.domain.MaterialType
import com.hanjjak.inventory.infrastructure.JsonMaterialDropContent
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * `ProgressionRebalanceTest`가 도는 콘텐츠는 100스테이지(1~10장)뿐이라 신화(8~10장) 재화
 * 도달 시간(수만~10만 스테이지 규모)을 잴 수 없다 — 왜인지는
 * docs/60-content/items/material-drops-mvp-v1.md의 "신화(8~10장) 재화 도달 시간" 절을 보라.
 *
 * 이 테스트는 전투·경험치·레벨·시장을 전혀 거치지 않고, 적용 콘텐츠의 드롭 엔진
 * (`DropTable`/`JsonMaterialDropContent`, modules/inventory)만 그대로 불러와 대량 표본으로
 * "스테이지당 세대별 재료 획득량"을 직접 잰다. 병목이 재료 드롭률 하나뿐이라는 전제(쌀·레벨은
 * 훨씬 여유롭게 게이트를 통과한다는 것을 별도로 확인했다) 위에서, 드롭률 산술 추정이 맞는지
 * 검증하는 것이 목적이다. 새 시뮬레이터가 아니라 기존 엔진 호출이다.
 */
class MaterialDropRateMeasurementTest {

    private data class ChapterSample(
        val chapter: Int,
        val trials: Int,
        val combinedTotals: LongArray,
        val primaryTotals: LongArray,
    ) {
        /** 3패밀리 합산, 세대별 스테이지당 평균 개수. index 1..5 = M1..M5. */
        fun combinedPerStage(generation: Int): Double = combinedTotals[generation].toDouble() / trials

        /** 주 패밀리(POTATO) 단독, 세대별 스테이지당 평균 개수. */
        fun primaryPerStage(generation: Int): Double = primaryTotals[generation].toDouble() / trials

        fun totalPerStage(): Double = combinedTotals.sum().toDouble() / trials
    }

    private fun loadDropTable(): DropTable {
        val content = JsonMaterialDropContent(
            File("packages/game-content/versions/progression-rebalance-v1/drops/material-drops.json").inputStream(),
            ObjectMapper(),
        ).content
        return DropTable(content)
    }

    /**
     * 챕터 안의 일반 스테이지(1~9) 한 번 클리어 = 일반 20마리 + 보스 1마리. stage.N-10은 드롭이 없다.
     *
     * `seedOffset`은 챕터마다 서로 다른 RNG 스트림을 쓰게 한다 — `enemySeed`가 챕터/스테이지를
     * 섞지 않고 `seed`·`enemyIndex`·`boss`만 쓰므로, 여러 챕터를 같은 `1..trials` 시드로 돌리면
     * (가중치가 같은 챕터끼리) 완전히 같은 추첨 결과가 나온다. 통계적으로는 문제 없지만(분포가
     * 실제로 동일하므로), 서로 독립된 표본처럼 보이게 하고 8·9·10장을 풀링해도 표본 수가 실제로
     * 늘어나게 하려고 챕터별로 시드 구간을 분리한다.
     */
    private fun sampleChapter(dropTable: DropTable, chapter: Int, trials: Int, seedOffset: Long = 0L): ChapterSample {
        val stageId = "stage.%02d-01".format(chapter)
        val combinedTotals = LongArray(6)
        val primaryTotals = LongArray(6)
        val generationRegex = Regex("_M(\\d+)$")
        for (i in 1..trials) {
            val rewards = dropTable.rollStage(
                stageId = stageId,
                primaryMaterial = MaterialType.POTATO,
                seed = seedOffset + i.toLong(),
                defeatedNormals = 20,
                bossDefeated = true,
            )
            rewards.forEach { reward ->
                val generation = generationRegex.find(reward.itemId)?.groupValues?.get(1)?.toIntOrNull() ?: return@forEach
                combinedTotals[generation] += reward.quantity
                if (reward.itemId.startsWith("POTATO_")) primaryTotals[generation] += reward.quantity
            }
        }
        return ChapterSample(chapter, trials, combinedTotals, primaryTotals)
    }

    /** 여러 챕터 표본을 하나로 합친다(8~10장처럼 가중치가 같은 챕터를 풀링해 정밀도를 올릴 때 씀). */
    private fun pool(label: Int, samples: List<ChapterSample>): ChapterSample {
        val combinedTotals = LongArray(6)
        val primaryTotals = LongArray(6)
        var trials = 0
        samples.forEach { sample ->
            trials += sample.trials
            for (g in 0..5) {
                combinedTotals[g] += sample.combinedTotals[g]
                primaryTotals[g] += sample.primaryTotals[g]
            }
        }
        return ChapterSample(label, trials, combinedTotals, primaryTotals)
    }

    private fun reportExhaustion(label: String, sample: ChapterSample, requirementPerFamily: Map<Int, Long>) {
        println(
            "$label chapter=${sample.chapter} trials=${sample.trials} totalPerStage=${"%.4f".format(sample.totalPerStage())}",
        )
        requirementPerFamily.toSortedMap().forEach { (generation, needPerFamily) ->
            val combined = sample.combinedPerStage(generation)
            val primary = sample.primaryPerStage(generation)
            // "시장이 3패밀리를 완전히 융통한다"는 가정: 전체 필요량(3패밀리, needPerFamily*3)을
            // 전체 드롭(3패밀리 합산)으로 나눈다.
            val stagesMarketPerfect = if (combined > 0) (needPerFamily * 3.0) / combined else Double.POSITIVE_INFINITY
            // "거래 없음" 가정: 주 패밀리 하나만으로 그 패밀리의 필요량을 채우는 스테이지 수.
            val stagesPrimaryOnly = if (primary > 0) needPerFamily / primary else Double.POSITIVE_INFINITY
            println(
                "  M$generation need(perFamily)=$needPerFamily combined/stage=${"%.5f".format(combined)} " +
                    "primary/stage=${"%.5f".format(primary)} stagesMarketPerfect=${"%.0f".format(stagesMarketPerfect)} " +
                    "stagesPrimaryOnly=${"%.0f".format(stagesPrimaryOnly)}",
            )
        }
    }

    @Test
    fun `mythic chapters 8 to 10 measured generation yield`() {
        val dropTable = loadDropTable()
        val trials = 1_000_000
        // 챕터별로 시드 구간을 분리해 세 챕터가 진짜 독립 표본이 되게 한다(sampleChapter 문서 참고).
        val samples = listOf(8, 9, 10).mapIndexed { index, chapter ->
            sampleChapter(dropTable, chapter, trials, seedOffset = index * 10_000_000L)
        }

        // 신화 6부위 필요량(패밀리당, 부위당 총량 x 6): M1 75,000x6 / M2 15,000x6 / M3 4,500x6 /
        // M4 1,200x6 / M5 360x6.
        val requirementPerFamily = mapOf(1 to 450_000L, 2 to 90_000L, 3 to 27_000L, 4 to 7_200L, 5 to 2_160L)

        samples.forEach { sample ->
            // 25롤 x 15% x 10개 = 37.5개/스테이지(전 세대 합). 1,000,000표본에서 표준편차가
            // 0.018 안팎이라 37.0~38.0은 27표준편차 이상 여유가 있다 — 흔들릴 걱정 없는 폭이다.
            assertTrue(
                sample.totalPerStage() in 37.0..38.0,
                "chapter ${sample.chapter}: total items/stage out of band: ${sample.totalPerStage()}",
            )
            // 가중치가 625>125>25>5>1로 엄격히 감소하므로 측정값도 엄격히 감소해야 한다.
            val combined = (1..5).map { sample.combinedPerStage(it) }
            assertTrue(
                combined.zipWithNext().all { (earlier, later) -> earlier > later },
                "chapter ${sample.chapter}: generation yields not strictly decreasing: $combined",
            )
            reportExhaustion("MYTHIC", sample, requirementPerFamily)
        }

        // 8~10장은 가중치가 완전히 같은 하나의 확률 모형이다(생성 로직도 챕터/스테이지 id를 RNG에
        // 섞지 않는다) — 세 챕터를 풀링해 M4·M5처럼 희귀한 세대의 표본 오차를 줄인다.
        val pooled = pool(0, samples)
        reportExhaustion("MYTHIC_POOLED_8_9_10", pooled, requirementPerFamily)
    }

    @Test
    fun `legendary chapter four measured generation yield`() {
        val dropTable = loadDropTable()
        val trials = 1_000_000
        // 4~7장이 전부 같은 가중치([125,25,5,1,0])를 쓴다. 4장을 대표로 잰다.
        val sample = sampleChapter(dropTable, 4, trials)

        assertTrue(
            sample.totalPerStage() in 37.0..38.0,
            "chapter 4: total items/stage out of band: ${sample.totalPerStage()}",
        )
        val combined = (1..4).map { sample.combinedPerStage(it) }
        assertTrue(
            combined.zipWithNext().all { (earlier, later) -> earlier > later },
            "chapter 4: generation yields not strictly decreasing: $combined",
        )
        assertTrue(sample.combinedPerStage(5) == 0.0, "chapter 4 must not drop M5 yet (weight 0)")

        // 전설 6부위 필요량(패밀리당): M1 238,500 / M2 47,700 / M3 9,540 / M4 1,908.
        val requirementPerFamily = mapOf(1 to 238_500L, 2 to 47_700L, 3 to 9_540L, 4 to 1_908L)
        reportExhaustion("LEGENDARY", sample, requirementPerFamily)
    }
}
