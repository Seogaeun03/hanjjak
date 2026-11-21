package com.hanjjak.chat.application

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatModerationTest {
    private val moderation = ChatModeration()

    private fun assertBlocked(value: String) =
        assertEquals("BLOCKED_POLICY", moderation.check(value).code, "막혔어야 한다: $value")

    private fun assertAllowed(value: String) =
        assertEquals("ALLOW", moderation.check(value).code, "통과했어야 한다: $value")

    @Test
    fun `blocks normalized profanity before persistence`() {
        assertEquals("BLOCKED_POLICY", moderation.check("씨 발").code)
        assertEquals(false, moderation.check("씨 발").allowed)
    }

    @Test
    fun `allows ordinary marketplace text`() {
        assertEquals("ALLOW", moderation.check("감자 재료 10개 판매합니다").code)
    }

    @Test
    fun `rejects empty and oversized messages`() {
        assertFailsWith<IllegalArgumentException> { moderation.check(" ") }
        assertFailsWith<IllegalArgumentException> { moderation.check("a".repeat(241)) }
    }

    @Test
    fun `accepts 한글 영문 숫자 공백 and allowed 한자키 symbols`() {
        moderation.requireAllowedCharset("감자 10개 potato 3")
        moderation.requireAllowedCharset("ㅋㅋㅋ ㅠㅠ")
        moderation.requireAllowedCharset("★☆♡♥♠♣♪♬※→☎")
        moderation.requireAllowedCharset("안녕! 뭐해? 음... 그래·좋아~")
        moderation.requireAllowedCharset("(급구)[삽니다]「중요」【공지】")
    }

    @Test
    fun `rejects 가나 키릴 그리스 괘선 and unicode emoji`() {
        for (value in listOf("あいう", "アイウ", "АБВ", "αβγ", "┌┐└┘", "안녕😀", "❤️", "漢字")) {
            val error = assertFailsWith<IllegalArgumentException> { moderation.requireAllowedCharset(value) }
            assertEquals("CHAT_INVALID_CHARSET", error.message)
        }
    }

    @Test
    fun `accepts basic keyboard math and currency symbols`() {
        moderation.requireAllowedCharset("감자-고구마 교환")
        moderation.requireAllowedCharset("3+5=8")
        moderation.requireAllowedCharset("50% 할인")
        moderation.requireAllowedCharset("<공지> 감자 10개 -> 고구마 5개")
        moderation.requireAllowedCharset("\$100")
    }

    @Test
    fun `rejects 전각 수학기호 and 단위 rows`() {
        assertFailsWith<IllegalArgumentException> { moderation.requireAllowedCharset("±×÷≠∞") }
        assertFailsWith<IllegalArgumentException> { moderation.requireAllowedCharset("㎜㎝㎞") }
        assertFailsWith<IllegalArgumentException> { moderation.requireAllowedCharset("＋－＜＝＞") }
    }

    /** 2026-09-17 라이브 제보. 이 표현들이 사전 v1 이전에는 그대로 저장됐다. */
    @Test
    fun `blocks the profanity that reached production chat`() {
        for (value in listOf("차오니마", "fuck", "bitch", "ssibal", "gaesaekkiya!")) assertBlocked(value)
    }

    @Test
    fun `blocks romanized korean profanity`() {
        for (value in listOf("sibal", "shibal", "byungsin", "jiral", "jonna", "gaesekki")) assertBlocked(value)
    }

    @Test
    fun `blocks profanity from other languages written in latin script`() {
        for (value in listOf(
            "puta", "mierda", "cabron", "caralho", "blyat", "suka", "putain", "merde",
            "scheisse", "cazzo", "kurwa", "malaka", "orospu", "chutiya", "anjing", "putangina",
        )) assertBlocked(value)
    }

    @Test
    fun `blocks separator and repetition evasion`() {
        for (value in listOf("시 발", "시-발", "시.발", "시발발발", "ㅅㅣ발", "f u c k", "fuuuck", "f*u*c*k")) {
            assertBlocked(value)
        }
    }

    /** 2026-09-17 라이브 제보. 글자 사이에 숫자·기호를 끼워 넣는 우회. */
    @Test
    fun `blocks digit and symbol insertion evasion`() {
        for (value in listOf("시1발", "씨1발", "씨123발", "새1끼", "새@끼", "새-끼", "개1새1끼")) {
            assertBlocked(value)
        }
    }

    @Test
    fun `blocks leetspeak evasion`() {
        for (value in listOf("b1tch", "sh1t", "@sshole", "fu(k".replace("(", "c"))) assertBlocked(value)
    }

    @Test
    fun `blocks 초성체 typed directly`() {
        for (value in listOf("ㅅㅂ", "야 ㅆㅂ", "ㅈㄹ 하지마", "ㅁㅊ")) assertBlocked(value)
    }

    /** 자모로 풀면 정상 단어가 초성체를 품는다. 입력에 직접 찍힌 자모만 봐야 한다. */
    @Test
    fun `does not read 초성체 out of ordinary syllables`() {
        for (value in listOf("김치 팔아요", "값 알려주세요", "옷 보다 갑니다", "밥 사주세요")) assertAllowed(value)
    }

    /** 음절 경계가 맞을 때만 막아야 `조준`, `조종` 이 `좆` 에 걸리지 않는다. */
    @Test
    fun `does not block syllable overlaps`() {
        for (value in listOf("조준 잘하네요", "조종 어렵다", "좋지 않아요")) assertAllowed(value)
    }

    /** 이 게임의 재료가 감자라 `감자지만` 류가 `자지` 에 걸리면 안 된다. */
    @Test
    fun `does not block ordinary words that contain body part terms`() {
        for (value in listOf(
            "감자지만 싸게 드려요", "혼자지만 괜찮아요", "해보지 마세요", "먹어보지 못했어요",
            "시발점이 어디인가요", "새끼손가락 걸고 약속", "고추 팔아요",
        )) assertAllowed(value)
    }

    /** 짧은 라틴 금칙어는 단어 경계가 맞을 때만 막아야 한다. */
    @Test
    fun `does not block innocent words that contain short latin terms`() {
        for (value in listOf("sussex", "class", "assassin", "analysis", "cockpit", "pass the item")) {
            assertAllowed(value)
        }
    }

    @Test
    fun `blocks short latin terms standing alone`() {
        for (value in listOf("sex", "ass", "you are a dick")) assertBlocked(value)
    }

    @Test
    fun `keeps ordinary trade chat allowed`() {
        for (value in listOf(
            "감자 10개 1000원에 팝니다", "고구마 사실 분", "옥수수 값이 올랐네요",
            "4-10 클리어 하신 분 계신가요", "ㅋㅋㅋ ㅠㅠ 아쉽다", "김치찌개 먹고 올게요",
        )) assertAllowed(value)
    }

    @Test
    fun `reports the dictionary version and term count`() {
        assertEquals("v1", moderation.dictionaryVersion)
        assertTrue(BlockedTermDictionary.load().termCount > 200, "사전이 비어 있으면 안 된다")
    }

    @Test
    fun `reports which term matched`() {
        assertEquals("ALLOW", moderation.check("감자 팝니다").code)
        assertNull(BlockedTermDictionary.load().blockedTerm("감자 팝니다"))
    }
}
