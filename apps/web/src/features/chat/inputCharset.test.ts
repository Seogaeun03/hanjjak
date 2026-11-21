import { describe, expect, it } from "vitest";
import { sanitizeChatInput } from "./inputCharset";

describe("chat input charset", () => {
  it("keeps 한글 · 영문 · 숫자 · 공백", () => {
    expect(sanitizeChatInput("감자 10개 potato 3")).toBe("감자 10개 potato 3");
  });

  it("keeps 호환 자모 so ㅋㅋㅋ and ㅠㅠ survive", () => {
    expect(sanitizeChatInput("ㅋㅋㅋ ㅠㅠ ㅇㅇ")).toBe("ㅋㅋㅋ ㅠㅠ ㅇㅇ");
  });

  it("keeps 한자키 기호 · 문장부호 · 괄호 rows", () => {
    expect(sanitizeChatInput("★☆♡♥♠♣♪♬※→☎")).toBe("★☆♡♥♠♣♪♬※→☎");
    expect(sanitizeChatInput("안녕! 뭐해? 음... 그래·좋아~")).toBe("안녕! 뭐해? 음... 그래·좋아~");
    expect(sanitizeChatInput("(급구)[삽니다]「중요」【공지】")).toBe("(급구)[삽니다]「중요」【공지】");
  });

  it("drops 가나 · 키릴 · 그리스 · 괘선", () => {
    expect(sanitizeChatInput("あいうアイウ")).toBe("");
    expect(sanitizeChatInput("АБВ")).toBe("");
    expect(sanitizeChatInput("αβγ")).toBe("");
    expect(sanitizeChatInput("┌┐└┘")).toBe("");
  });

  it("keeps the basic keyboard math and currency symbols", () => {
    expect(sanitizeChatInput("감자-고구마 교환")).toBe("감자-고구마 교환");
    expect(sanitizeChatInput("3+5=8")).toBe("3+5=8");
    expect(sanitizeChatInput("50% 할인")).toBe("50% 할인");
    expect(sanitizeChatInput("<공지> 감자 10개 -> 고구마 5개")).toBe("<공지> 감자 10개 -> 고구마 5개");
    expect(sanitizeChatInput("$100")).toBe("$100");
  });

  it("still drops the 전각 수학기호 · 단위 rows", () => {
    expect(sanitizeChatInput("±×÷≠∞")).toBe("");
    expect(sanitizeChatInput("㎜㎝㎞")).toBe("");
    expect(sanitizeChatInput("＋－＜＝＞")).toBe("");
  });

  it("drops unicode emoji without splitting surrogate pairs", () => {
    expect(sanitizeChatInput("안녕😀🎉하세요")).toBe("안녕하세요");
    expect(sanitizeChatInput("👨‍👩‍👧‍👦")).toBe("");
    expect(sanitizeChatInput("❤️")).toBe("");
  });

  it("drops hanja and CJK ideographs", () => {
    expect(sanitizeChatInput("漢字 테스트")).toBe(" 테스트");
  });

  it("returns an empty string when nothing is allowed", () => {
    expect(sanitizeChatInput("🎉🎉")).toBe("");
  });
});
