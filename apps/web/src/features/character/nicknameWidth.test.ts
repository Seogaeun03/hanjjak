import { describe, expect, it } from "vitest";
import { nicknameWidth } from "./CharacterAbilityTab";

/* 이름 칸은 한 줄이어야 한다. 두 줄이 되면 아래 그림을 밀어내 칸이 흐트러진다.
   실제 글자 폭을 화면에서 재어 정한 값이라, 수치를 바꾸면 여기가 먼저 알려 준다. */
describe("nicknameWidth", () => {
  it("counts a wide glyph as most of a square and a narrow one as less", () => {
    expect(nicknameWidth("한짝")).toBe(1.8);
    expect(nicknameWidth("ab")).toBe(1.2);
    expect(nicknameWidth("AB")).toBe(1.9);
  });

  it("adds up a name that mixes scripts", () => {
    expect(nicknameWidth("한짝AB12")).toBe(.9 * 2 + .95 * 2 + .6 * 2);
  });

  /* 스무 자가 상한이다. 그 폭이면 99cqw 예산을 넘지 않아 한 줄로 남는다. */
  it("keeps the longest allowed name inside the width budget", () => {
    const longestWide = nicknameWidth("가".repeat(20));
    const longestUpper = nicknameWidth("W".repeat(20));
    expect(longestWide).toBe(18);
    expect(longestUpper).toBe(19);
    expect(99 / longestUpper).toBeGreaterThan(5);
  });

  it("never reports less than one square, so a single letter stays large", () => {
    expect(nicknameWidth("a")).toBe(1);
    expect(nicknameWidth("")).toBe(1);
  });
});
