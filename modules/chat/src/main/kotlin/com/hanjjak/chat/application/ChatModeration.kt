package com.hanjjak.chat.application

class ChatModeration(
    private val dictionary: BlockedTermDictionary = BlockedTermDictionary.load(),
) {
    data class Decision(val allowed: Boolean, val code: String = "ALLOW")

    /** 판정에 쓴 사전 버전. 운영 검토와 사전 버전 고정 게이트가 참조한다. */
    val dictionaryVersion: String get() = dictionary.version

    fun check(value: String): Decision {
        require(value.trim().isNotEmpty()) { "CHAT_EMPTY_BODY" }
        require(value.length <= 240) { "CHAT_BODY_TOO_LONG" }
        return if (dictionary.blocks(value)) Decision(false, "BLOCKED_POLICY") else Decision(true)
    }

    /**
     * 채팅 메시지 본문의 문자 집합을 검증한다.
     *
     * 프론트(ChatPanel)에서 이미 걸러내므로 정상 경로에서는 걸리지 않고, API를 직접 호출하는
     * 우회를 막는 용도다. 거래 게시판 본문에는 적용하지 않는다.
     */
    fun requireAllowedCharset(value: String) {
        require(value.codePoints().allMatch { isAllowedCodePoint(it) }) { "CHAT_INVALID_CHARSET" }
    }

    companion object {
        /**
         * 허용 기호. 한글 키보드에서 자음 + 한자키로 입력하는 행 가운데 세 행만 허용한다.
         *   ㅁ + 한자 → 도형 · 기호 · 이모티콘
         *   ㄱ + 한자 → 문장부호
         *   ㄴ + 한자 → 괄호
         *
         * 나머지 행(ㅎ 가나, ㅍ 키릴, ㅋ 그리스, ㅌ 괘선, ㄷ 수학기호, ㄹ 단위)과
         * 유니코드 이모지는 제외한다.
         *
         * apps/web/src/features/chat/inputCharset.ts 와 반드시 일치해야 한다.
         */
        private const val SYMBOL_ROW = "#&*@§※☆★○●◎◇◆□■△▲▽▼→←↑↓↔〓◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞¶†‡↕↗↙↖↘♭♩♪♬㉿㈜№㏇™㏂㏘℡®"
        private const val PUNCTUATION_ROW = "!',./:;?^_`|￣、。·‥…¨〃―∥＼∼´～ˇ˘˝˚˙¸˛¡¿ː"
        private const val BRACKET_ROW = "\"()[]{}‘’“”〔〕〈〉《》「」『』【】"

        /**
         * 한자키 행에는 없지만 키보드로 직접 치는 기본 기호.
         * ㄷ + 한자는 전각(＋－＜＝＞)이라 거래 대화에서 쓰는 ASCII 쪽을 따로 허용한다.
         */
        private const val KEYBOARD_ROW = "~-+=<>%\$"

        private val ALLOWED_SYMBOLS: Set<Int> =
            (SYMBOL_ROW + PUNCTUATION_ROW + BRACKET_ROW + KEYBOARD_ROW).codePoints().toArray().toSet()

        internal fun isAllowedCodePoint(code: Int): Boolean = when {
            code == ' '.code -> true
            code in 0x30..0x39 -> true // 0-9
            code in 0x41..0x5A -> true // A-Z
            code in 0x61..0x7A -> true // a-z
            code in 0xAC00..0xD7A3 -> true // 가-힣
            code in 0x3131..0x3163 -> true // ㄱ-ㅣ 호환 자모 (ㅋㅋㅋ, ㅠㅠ)
            else -> code in ALLOWED_SYMBOLS
        }
    }
}
