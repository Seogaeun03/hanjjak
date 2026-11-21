/**
 * 채팅 입력 허용 문자 집합.
 *
 * 한글(음절 + 호환 자모) · 영문 · 숫자 · 공백에 더해, 한글 키보드에서 자음 + 한자키로
 * 입력하는 기호 행 가운데 다음 세 행을 허용한다.
 *   ㅁ + 한자 → 도형 · 기호 · 이모티콘
 *   ㄱ + 한자 → 문장부호
 *   ㄴ + 한자 → 괄호
 *
 * 나머지 한자키 행(ㅎ 가나, ㅍ 키릴, ㅋ 그리스, ㅌ 괘선, ㄷ 수학기호, ㄹ 단위)과
 * 유니코드 이모지는 허용하지 않는다.
 *
 * 이 집합은 서버의 ChatModeration.kt ALLOWED_SYMBOLS 와 반드시 일치해야 한다.
 * 한쪽만 고치면 프론트에서 입력되는 글자가 서버에서 거부된다.
 */

/** ㅁ + 한자: 도형 · 기호 · 이모티콘 */
const SYMBOL_ROW = "#&*@§※☆★○●◎◇◆□■△▲▽▼→←↑↓↔〓◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞¶†‡↕↗↙↖↘♭♩♪♬㉿㈜№㏇™㏂㏘℡®";

/** ㄱ + 한자: 문장부호 */
const PUNCTUATION_ROW = "!',./:;?^_`|￣、。·‥…¨〃―∥＼∼´～ˇ˘˝˚˙¸˛¡¿ː";

/** ㄴ + 한자: 괄호 */
const BRACKET_ROW = "\"()[]{}‘’“”〔〕〈〉《》「」『』【】";

/**
 * 한자키 행에는 없지만 키보드로 직접 치는 기본 기호.
 * ㄷ + 한자는 전각(＋－＜＝＞)이라 거래 대화에서 쓰는 ASCII 쪽을 따로 허용한다.
 * `<`, `>` 는 본문이 React 텍스트 노드(`<p>{item.body}</p>`)로만 렌더되어 그대로 이스케이프된다.
 */
const KEYBOARD_ROW = "~-+=<>%$";

const ALLOWED_SYMBOLS = new Set([...SYMBOL_ROW, ...PUNCTUATION_ROW, ...BRACKET_ROW, ...KEYBOARD_ROW]);

export function isAllowedChatChar(char: string): boolean {
  if (char === " ") return true;
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  if (code >= 0x30 && code <= 0x39) return true; // 0-9
  if (code >= 0x41 && code <= 0x5a) return true; // A-Z
  if (code >= 0x61 && code <= 0x7a) return true; // a-z
  if (code >= 0xac00 && code <= 0xd7a3) return true; // 가-힣
  if (code >= 0x3131 && code <= 0x3163) return true; // ㄱ-ㅣ 호환 자모 (ㅋㅋㅋ, ㅠㅠ)
  return ALLOWED_SYMBOLS.has(char);
}

/** 허용하지 않는 문자를 제거한다. 이모지는 코드 포인트 단위로 걸러 대리 쌍이 쪼개지지 않는다. */
export function sanitizeChatInput(value: string): string {
  return Array.from(value).filter(isAllowedChatChar).join("");
}
