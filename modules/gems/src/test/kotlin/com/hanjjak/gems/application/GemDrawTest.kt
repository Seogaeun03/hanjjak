package com.hanjjak.gems.application

import com.hanjjak.gems.domain.GemOption
import com.hanjjak.gems.domain.GemRules
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** 대본대로 굴려 주는 추첨원. 첫 값이 등급, 그 다음이 옵션이다. */
private class ScriptedRollSource(vararg rolls: Int) : GemRollSource {
    private val queue = ArrayDeque(rolls.toList())
    var drawn = 0
        private set

    override fun nextBasisPoint(): Int {
        drawn++
        return queue.removeFirstOrNull() ?: error("추첨원이 대본보다 많이 불렸다")
    }
}

class GemDrawTest {
    /**
     * 등급과 옵션을 한 시드로 같이 뽑던 시절에는 이 조합이 나올 수 없었다. 높은 등급은 큰 시드,
     * 고정 공격력은 작은 시드를 요구해 두 구간이 겹치지 않았기 때문이다.
     */
    @Test
    fun `등급과 옵션을 따로 뽑는다`() {
        val source = ScriptedRollSource(9_999, 100)
        val (level, option) = drawGem(source)

        assertEquals(3, level)
        assertEquals(GemOption.FLAT_ATTACK, option)
        assertEquals(2, source.drawn, "등급 한 번, 옵션 한 번 — 두 번 굴려야 독립이다")
    }

    /**
     * 커플링 버그의 핵심 증상은 보석함에서 레벨 2·3 공격 보석이 한 개도 안 나온 것이었다.
     * weightedOption 만 직접 부르면 가중치표만 보게 되어 커플링이 살아 있어도 통과한다.
     * 그래서 drawGem 을 통해, 등급 굴림과 옵션 굴림을 따로 먹여 확인한다.
     */
    @Test
    fun `보석함 모든 등급에서 공격과 HP 가 둘 다 나온다`() {
        val levelRolls = mapOf(1 to 0, 2 to 8_500, 3 to 9_500)
        val produced = mutableSetOf<Pair<Int, GemOption>>()
        for ((level, levelRoll) in levelRolls) {
            for (optionRoll in listOf(0, 5_000)) {
                val (drawnLevel, option) = drawGem(ScriptedRollSource(levelRoll, optionRoll))
                assertEquals(level, drawnLevel, "시드 $levelRoll 은 Lv$level 이어야 한다")
                produced += drawnLevel to option
            }
        }
        for (level in 1..3) {
            assertContains(produced, level to GemOption.FLAT_ATTACK, "Lv$level 공격 보석이 안 나온다")
            assertContains(produced, level to GemOption.FLAT_HP, "Lv$level HP 보석이 안 나온다")
        }
    }

    /** 등급 안에서 공격 비중이 의도대로 절반이어야 한다. 예전에는 Lv2·3 이 0% 였다. */
    @Test
    fun `등급별 공격 비중이 절반이다`() {
        val counts = HashMap<Pair<Int, GemOption>, Int>()
        val trials = 50_000
        val source = SecureGemRollSource()
        repeat(trials) {
            val (level, option) = drawGem(source)
            counts.merge(level to option, 1, Int::plus)
        }
        for (level in 1..3) {
            val attack = counts[level to GemOption.FLAT_ATTACK] ?: 0
            val hp = counts[level to GemOption.FLAT_HP] ?: 0
            val share = attack.toDouble() / (attack + hp)
            assertTrue(share in 0.45..0.55, "Lv$level 공격 비중 ${"%.3f".format(share)} — 0.5 근처여야 한다")
        }
    }

    /** 합성은 등급이 정해져 있다. 옵션만 뽑으므로 굴림은 한 번이다. */
    @Test
    fun `합성은 등급을 고정하고 옵션만 뽑는다`() {
        val source = ScriptedRollSource(8_500)
        val (level, option) = drawGem(source, forcedLevel = 7)

        assertEquals(7, level)
        assertEquals(GemOption.CRITICAL_CHANCE, option)
        assertEquals(1, source.drawn, "등급이 정해졌으면 등급 굴림은 없어야 한다")
    }

    /**
     * weightedOption 의 마지막 항목 반환은 가중치 합이 굴림 공간과 같을 때만 닿지 않는 가지다.
     * 합이 어긋난 표가 들어오면 남은 확률이 조용히 마지막 옵션으로 쏠린다 — 이번에 고친 것과
     * 같은 종류의 말 없는 편향이다. 표 자체를 잠근다.
     */
    @Test
    fun `모든 등급의 옵션 가중치 합이 굴림 공간과 같다`() {
        for (level in 1..7) {
            assertEquals(10_000, GemRules.optionsFor(level).sumOf { it.second }, "Lv$level 가중치 합")
        }
    }

    @Test
    fun `추첨원이 범위를 벗어나면 막는다`() {
        assertEquals(
            "GEM_ROLL_OUT_OF_RANGE",
            assertFailsWith<IllegalArgumentException> { validatedGemRoll(ScriptedRollSource(10_000)) }.message,
        )
        assertFailsWith<IllegalArgumentException> { validatedGemRoll(ScriptedRollSource(-1)) }
        assertEquals(9_999, validatedGemRoll(ScriptedRollSource(9_999)))
        assertEquals(0, validatedGemRoll(ScriptedRollSource(0)))
    }

    @Test
    fun `서버 추첨원은 0부터 9999 까지만 준다`() {
        val source = SecureGemRollSource()
        var min = Int.MAX_VALUE
        var max = Int.MIN_VALUE
        repeat(20_000) {
            val roll = validatedGemRoll(source)
            if (roll < min) min = roll
            if (roll > max) max = roll
        }
        assertTrue(min < 50, "낮은 쪽 끝이 안 나온다")
        assertTrue(max > 9_950, "높은 쪽 끝이 안 나온다")
    }

    /**
     * 보안 회귀 가드. 멱등키는 클라이언트가 만드는 값이라 추첨 시드로 쓰면 플레이어가 결과를
     * 고른다. 텍스트 검사라 우회는 가능하지만(hashCode 등) 되돌아오는 가장 흔한 형태는 막는다.
     * 실제 무작위성은 GemConfiguration 이 주입하는 빈이 책임지고, 통합 테스트가 그 자리를
     * 갈아끼워 검증한다.
     */
    @Test
    fun `gems 응용 계층이 멱등키에서 무작위성을 끌어오지 않는다`() {
        // GemDungeonService 는 아직 이 패턴이 남아 있다. 고치면 이 예외 항목을 지워야 한다.
        val knownUnfixed = setOf("GemDungeonService.kt")
        val offenders = Path.of("src/main/kotlin/com/hanjjak/gems/application").toFile()
            .listFiles { file -> file.name.endsWith(".kt") }
            .orEmpty()
            .filter { it.name !in knownUnfixed }
            .filter { file ->
                val text = file.readText()
                "mostSignificantBits" in text || "leastSignificantBits" in text
            }
            .map { it.name }

        assertEquals(emptyList(), offenders, "UUID 비트를 시드로 읽는 파일이 있다 — 멱등키 시드가 되살아났는지 확인하라")
    }
}
