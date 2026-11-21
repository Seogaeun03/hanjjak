package com.hanjjak.chat.application

import java.text.Normalizer

/**
 * 채팅 금칙어 사전과 판정기.
 *
 * 사전 본문은 `moderation/blocked-terms-<version>.txt` 가 소유하고 이 클래스는 판정 규칙만
 * 소유한다. 설계 문서가 "필터 사전의 버전과 변경 이력은 서버 관리 데이터가 소유한다"고
 * 규정하므로 목록을 코드에 두지 않는다.
 *
 * 우회 표기를 흡수하려고 입력을 정규화한다. NFKC 정규화·소문자화·기호 제거·연속 문자
 * 축약을 거치고, 숫자를 글자로 읽은 형태와 지운 형태를 모두 시도한다. 한글은 자모로 풀어
 * `ㅅㅣ발` 같은 분리 우회까지 같은 문자열로 모은다.
 *
 * 다만 자모로 풀면 정상 단어가 금칙어를 부분 문자열로 품는다. `김치`는 `ㄱㅣㅁㅊㅣ` 라
 * 초성체 `ㅁㅊ` 를 품고, `값`은 `ㄱㅏㅄ` 라 `ㅄ` 를 품고, `조준`은 `ㅈㅗㅈㅜㄴ` 이라 `좆` 을
 * 품고, `감자지만`은 `자지` 를 품는다. 그래서 구획마다 일치 규칙을 다르게 둔다.
 *
 *   korean           자모 부분 일치. 단 음절 경계에 맞아떨어질 때만 인정해 `조준`을 살린다.
 *   korean-word      띄어쓰기 토큰의 앞에서 시작할 때만 인정한다. `감자지만`을 살리려는 구획이다.
 *   korean-initials  입력에 직접 찍힌 호환 자모만 모아 비교한다. `김치`를 `ㅁㅊ` 로 막지 않는다.
 *   latin            기호를 뺀 문자열에 부분 일치.
 *   latin-word       단어가 같을 때만 인정한다. `sex` 로 `sussex` 를 막지 않는다.
 *   allow            금칙어를 품지만 정상인 표현. 이 표현으로만 일치가 설명되면 통과시킨다.
 *
 * 완전한 차단은 불가능하다. 신조어와 새 우회 표기는 계속 생기고, 부분 일치는 정상 표현을
 * 함께 막는 비용이 있다. allow 구획은 알려진 오탐만 되돌린다.
 */
class BlockedTermDictionary(
    val version: String,
    koreanTerms: Collection<String> = emptyList(),
    koreanWordTerms: Collection<String> = emptyList(),
    koreanInitialTerms: Collection<String> = emptyList(),
    latinTerms: Collection<String> = emptyList(),
    latinWordTerms: Collection<String> = emptyList(),
    allowPhrases: Collection<String> = emptyList(),
) {
    private val korean = koreanTerms.map { jamo(it).text }.clean()
    private val koreanWords = koreanWordTerms.map { jamo(it).text }.clean()
    private val koreanInitials = koreanInitialTerms.map { initialsOnly(it) }.clean()
    private val latin = latinTerms.map { squash(it, readDigitsAsLetters = true) }.clean()
    private val latinWords = latinWordTerms.map { squash(it, readDigitsAsLetters = true) }.clean()
    private val allowedJamo = allowPhrases.map { jamo(it).text }.clean()
    private val allowedLatin = allowPhrases.map { squash(it, readDigitsAsLetters = true) }.clean()

    val termCount: Int get() = korean.size + koreanWords.size + koreanInitials.size + latin.size + latinWords.size

    fun blocks(value: String): Boolean = blockedTerm(value) != null

    /** 어떤 금칙어에 걸렸는지 돌려준다. 운영 검토와 테스트가 판정 근거를 볼 수 있어야 한다. */
    fun blockedTerm(value: String): String? {
        val initials = initialsOnly(value)
        koreanInitials.firstOrNull { initials.contains(it) }?.let { return it }
        for (readDigitsAsLetters in listOf(false, true)) {
            val decomposed = jamo(value, readDigitsAsLetters)
            korean.firstOrNull { alignedMatch(decomposed, it) }?.let { return it }
            val hangulTokens = tokens(value, readDigitsAsLetters)
            koreanWords.firstOrNull { term -> hangulTokens.any { it.startsWith(term) } }?.let { return it }
            val text = squash(value, readDigitsAsLetters)
            latin.firstOrNull { unexcused(text, it, allowedLatin).isNotEmpty() }?.let { return it }
            val latinTokens = words(value, readDigitsAsLetters)
            latinWords.firstOrNull { term -> latinTokens.any { it == term || it == term + "s" } }?.let { return it }
        }
        return null
    }

    /** 자모 일치가 음절 경계에서 시작하고 끝날 때만 인정한다. `조준`이 `좆` 에 걸리지 않게 한다. */
    private fun alignedMatch(decomposed: Decomposed, term: String): Boolean =
        unexcused(decomposed.text, term, allowedJamo).any { range ->
            decomposed.startsUnit(range.first) && decomposed.startsUnit(range.last + 1)
        }

    /** 일치 구간이 전부 허용 표현 안에 들어 있으면 오탐으로 보고 제외한다. */
    private fun unexcused(text: String, term: String, allowed: List<String>): List<IntRange> {
        if (term.isEmpty()) return emptyList()
        val excused = allowed.filter { it != term && it.contains(term) }.flatMap { ranges(text, it) }
        return ranges(text, term).filter { match -> excused.none { match.first >= it.first && match.last <= it.last } }
    }

    private fun ranges(text: String, needle: String): List<IntRange> {
        val found = mutableListOf<IntRange>()
        var from = text.indexOf(needle)
        while (from >= 0) {
            found += from..(from + needle.length - 1)
            from = text.indexOf(needle, from + 1)
        }
        return found
    }

    private fun List<String>.clean(): List<String> = filter(String::isNotEmpty).distinct()

    /** 자모 문자열과, 각 위치가 원본 글자의 첫 자모인지 여부. */
    class Decomposed(val text: String, private val unitStarts: Set<Int>) {
        fun startsUnit(index: Int): Boolean = index == text.length || index in unitStarts
    }

    companion object {
        private const val DEFAULT_VERSION = "v1"
        private val LEET = mapOf(
            '4' to 'a', '3' to 'e', '1' to 'i', '0' to 'o', '5' to 's', '7' to 't', '8' to 'b',
            '@' to 'a', '$' to 's', '!' to 'i', '+' to 't',
        )
        private const val CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
        private const val JUNGSEONG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
        private const val JONGSEONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"

        fun load(version: String = DEFAULT_VERSION): BlockedTermDictionary {
            val path = "moderation/blocked-terms-$version.txt"
            val text = BlockedTermDictionary::class.java.classLoader.getResourceAsStream(path)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: error("금칙어 사전을 찾지 못했다: $path")
            val sections = mutableMapOf<String, MutableList<String>>()
            var current = ""
            for (raw in text.lineSequence()) {
                val line = raw.trim()
                if (line.isEmpty() || line.startsWith("#")) continue
                if (line.startsWith("[") && line.endsWith("]")) {
                    current = line.substring(1, line.length - 1)
                    sections.getOrPut(current) { mutableListOf() }
                    continue
                }
                sections.getOrPut(current) { mutableListOf() }.add(line)
            }
            return BlockedTermDictionary(
                version = version,
                koreanTerms = sections["korean"].orEmpty(),
                koreanWordTerms = sections["korean-word"].orEmpty(),
                koreanInitialTerms = sections["korean-initials"].orEmpty(),
                latinTerms = sections["latin"].orEmpty(),
                latinWordTerms = sections["latin-word"].orEmpty(),
                allowPhrases = sections["allow"].orEmpty(),
            )
        }

        /** 한글 음절을 호환 자모로 풀어 `시발` 과 `ㅅㅣ발` 을 같은 문자열로 만든다. */
        fun jamo(value: String, readDigitsAsLetters: Boolean = false): Decomposed {
            val builder = StringBuilder()
            val starts = mutableSetOf<Int>()
            for (character in squash(value, readDigitsAsLetters)) {
                starts += builder.length
                val offset = character.code - 0xAC00
                if (offset in 0 until 11172) {
                    builder.append(CHOSEONG[offset / (21 * 28)])
                    builder.append(JUNGSEONG[offset / 28 % 21])
                    JONGSEONG[offset % 28].takeIf { it != ' ' }?.let(builder::append)
                } else {
                    builder.append(character)
                }
            }
            return Decomposed(builder.toString(), starts)
        }

        /** 입력에 직접 찍힌 호환 자모만 모은다. 음절은 풀지 않으므로 `김치` 는 빈 문자열이 된다. */
        fun initialsOnly(value: String): String =
            squash(value, readDigitsAsLetters = false).filter { it.code in 0x3131..0x3163 }

        /** 띄어쓰기·기호로 끊은 한글 토큰을 자모로 푼다. */
        fun tokens(value: String, readDigitsAsLetters: Boolean = false): List<String> =
            normalize(value)
                .split(Regex("[^가-힣ㄱ-ㅣ]+"))
                .filter(String::isNotEmpty)
                .map { jamo(it, readDigitsAsLetters).text }

        /** 라틴 문자 단어 목록. 단어 경계를 살려야 `sussex` 를 `sex` 로 막지 않는다. */
        fun words(value: String, readDigitsAsLetters: Boolean = false): List<String> {
            val mapped = normalize(value).lowercase()
                .map { if (readDigitsAsLetters) LEET[it] ?: it else it }
                .joinToString("")
            return mapped.split(Regex("[^a-z]+")).filter(String::isNotEmpty).map(::collapseRuns)
        }

        /**
         * 비교용 문자열로 줄인다. 기호·공백·한글 외 문자를 버리고 연속 문자를 하나로 줄여
         * `시 발`, `시-발`, `시발발발` 을 같은 문자열로 만든다.
         */
        fun squash(value: String, readDigitsAsLetters: Boolean): String {
            val normalized = normalize(value).lowercase()
            val mapped = buildString {
                for (character in normalized) {
                    val candidate = if (readDigitsAsLetters) LEET[character] ?: character else character
                    val keep = candidate in 'a'..'z' ||
                        candidate.code in 0xAC00..0xD7A3 ||
                        candidate.code in 0x3131..0x3163
                    if (keep) append(candidate)
                }
            }
            return collapseRuns(mapped)
        }

        /**
         * NFKC 는 전각 문자를 접어 주지만 호환 자모 `ㅅ`(U+3145) 을 조합용 자모(U+1109) 로도
         * 바꾼다. 조합용 자모는 한글 음절도 호환 자모도 아니라 그대로 두면 `ㅅㅂ` 같은 초성체가
         * 통째로 버려진다. 정규화 뒤 조합용 자모를 호환 자모로 되돌린다.
         */
        internal fun normalize(value: String): String =
            Normalizer.normalize(value, Normalizer.Form.NFKC).map { character ->
                when (character.code) {
                    in 0x1100..0x1112 -> CHOSEONG[character.code - 0x1100]
                    in 0x1161..0x1175 -> JUNGSEONG[character.code - 0x1161]
                    in 0x11A8..0x11C2 -> JONGSEONG[character.code - 0x11A8 + 1]
                    else -> character
                }
            }.joinToString("")

        private fun collapseRuns(value: String): String =
            buildString { for (character in value) if (lastOrNull() != character) append(character) }
    }
}
