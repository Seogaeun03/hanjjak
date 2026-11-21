import { describe, expect, it } from "vitest";
import { equipmentActionText, promotionRequirement } from "./EquipmentScreen";
import type { EquipmentPromotionSummary } from "./api";

function promote(overrides: Partial<EquipmentPromotionSummary>): EquipmentPromotionSummary {
  return {
    requiredStageId: "stage.01-10",
    chapterCleared: true,
    maxEnhancementReached: true,
    cost: { riceCost: 1_000, materials: [] },
    result: { grade: "RARE", gradeName: "희귀", enhancementLevel: 1, q: 40, stats: { attack: 0, maxHp: 0, penetration: 0 } },
    executable: true,
    disabledReason: null,
    ...overrides,
  };
}

/* 서버가 조건을 순서대로 검사하므로, 화면도 같은 순서로 말해야 둘이 어긋나지 않는다. */
it("강화가 덜 됐으면 그것부터 말한다", () => {
  expect(promotionRequirement(promote({ maxEnhancementReached: false, chapterCleared: false }))).toBe("+30강 필요");
});

it("강화가 찼으면 필요한 스테이지를 읽기 좋게 말한다", () => {
  expect(promotionRequirement(promote({ chapterCleared: false }))).toBe("1-10 클리어 필요");
  expect(promotionRequirement(promote({ chapterCleared: false, requiredStageId: "stage.03-10" }))).toBe("3-10 클리어 필요");
});

/* 재료 개수는 위 목록이 이미 세고 있어서, 여기서는 모자란다는 사실만 짚는다. */
it("쌀과 재료가 모자라면 무엇이 모자란지만 짚는다", () => {
  expect(promotionRequirement(promote({ executable: false, disabledReason: "INSUFFICIENT_RICE" }))).toBe("쌀 부족");
  expect(promotionRequirement(promote({ executable: false, disabledReason: "INSUFFICIENT_MATERIALS" }))).toBe("재료 부족");
});

it("다 갖추면 승급할 수 있다고 말한다", () => {
  expect(promotionRequirement(promote({}))).toBe("승급 가능");
});

/* 잠긴 단추가 "승급"이라고만 적혀 있으면 왜 못 누르는지 알 수 없다. 동사 자리에
   남은 조건을 대신 적어, 단추 하나가 무엇을 기다리는지까지 말하게 한다. */
describe("단추에 적히는 말", () => {
  const enhance = (executable: boolean, disabledReason: string | null = null) => ({ executable, disabledReason });

  it("할 수 있으면 무엇을 하는 단추인지 적는다", () => {
    expect(equipmentActionText({ growthComplete: false, promote: null }, enhance(true), false, "강화")).toBe("강화");
    expect(equipmentActionText({ growthComplete: false, promote: promote({}) }, enhance(true), true, "승급")).toBe("승급");
  });

  it("승급이 막혀 있으면 남은 조건을 적는다", () => {
    const blocked = promote({ chapterCleared: false, executable: false, disabledReason: "EQUIPMENT_CHAPTER_NOT_CLEARED" });
    expect(equipmentActionText({ growthComplete: false, promote: blocked }, enhance(false, "EQUIPMENT_CHAPTER_NOT_CLEARED"), true, "승급")).toBe("1-10 클리어 필요");
  });

  it("강화가 막혀 있으면 모자란 것을 짧게 적는다", () => {
    expect(equipmentActionText({ growthComplete: false, promote: null }, enhance(false, "INSUFFICIENT_MATERIALS"), false, "강화")).toBe("재료 부족");
    expect(equipmentActionText({ growthComplete: false, promote: null }, enhance(false, "INSUFFICIENT_RICE"), false, "강화")).toBe("쌀 부족");
  });

  it("끝까지 키운 장비는 최대라고만 적는다", () => {
    expect(equipmentActionText({ growthComplete: true, promote: null }, enhance(false, "EQUIPMENT_MAX_GRADE"), false, "승급")).toBe("최대");
  });

  it("까닭을 모르면 조건 미충족으로 둔다", () => {
    expect(equipmentActionText({ growthComplete: false, promote: null }, enhance(false, "SOMETHING_NEW"), false, "강화")).toBe("조건 미충족");
  });
});
