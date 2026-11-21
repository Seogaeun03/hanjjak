// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillCard, skillCardTone } from "./SkillsScreen";
import type { SkillSummary } from "./api";

function skill(action: Partial<SkillSummary["action"]>): SkillSummary {
  return {
    skillId: "active_heavy", name: "한짝의 일격", active: true, unlocked: true,
    grade: "NORMAL", gradeName: "노말", level: 3, equippedSlot: null, effectText: "",
    action: {
      kind: "ENHANCE", targetGrade: "NORMAL", targetLevel: 4, books: [], riceCost: 100,
      successBasisPoints: 10_000, executable: false, disabledReason: null, ...action,
    },
  };
}

/* 카드 여섯 장 중 지금 손댈 수 있는 것을 눌러 보지 않고 알아야 한다. */
describe("skillCardTone", () => {
  it("colours the card by what can be done to it right now", () => {
    expect(skillCardTone(skill({ executable: true }))).toBe("enhance");
    expect(skillCardTone(skill({ kind: "UNLOCK", executable: true }))).toBe("enhance");
    expect(skillCardTone(skill({ kind: "PROMOTE", executable: true }))).toBe("promote");
  });

  it("leaves a card plain when nothing can be done to it", () => {
    expect(skillCardTone(skill({ executable: false }))).toBeNull();
    expect(skillCardTone(skill({ disabledReason: "INSUFFICIENT_RICE" }))).toBeNull();
    expect(skillCardTone(skill({ kind: "COMPLETE", executable: false }))).toBeNull();
  });
});

describe("SkillCard", () => {
  const card = (summary: SkillSummary) => renderToStaticMarkup(
    <SkillCard skill={summary} equippedSlot={null} busy={false} selecting={false} picked={false} onPick={() => undefined} onSelect={() => undefined} />,
  );

  it("marks the card rather than hanging a tag on it", () => {
    const html = card(skill({ executable: true }));
    expect(html).toContain("is-ready-enhance");
    expect(html).not.toContain("skill-readiness");
    expect(card(skill({ kind: "PROMOTE", executable: true }))).toContain("is-ready-promote");
  });

  /* 색은 눈으로 못 보는 사람에게 아무 말도 하지 않는다. 단추가 대신 말해야 한다. */
  it("still says out loud what the colour means", () => {
    expect(card(skill({ executable: true }))).toContain("한짝의 일격 강화 가능 강화 대상으로 고르기");
    expect(card(skill({ kind: "PROMOTE", executable: true }))).toContain("한짝의 일격 승급 가능 강화 대상으로 고르기");
    expect(card(skill({ executable: false }))).toContain("한짝의 일격 강화 대상으로 고르기");
  });
});
