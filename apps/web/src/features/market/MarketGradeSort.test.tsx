// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { instrumentGradeRank } from "./marketBrowse";
import type { MarketInstrument } from "./api";

function item(overrides: Partial<MarketInstrument>): MarketInstrument {
  return {
    instrumentId: "x", canonicalKey: "x", itemId: "X", displayName: "x",
    category: "MATERIAL", attributes: {}, status: "ACTIVE",
    bestBidUnitPrice: null, bestAskUnitPrice: 10, lastTradeUnitPrice: null, marketRevision: 1,
    ...overrides,
  };
}

/* 재료는 F부터 A까지 다섯 단계이고, 세대 번호가 그대로 등급이다. */
it("재료는 세대 번호를 등급으로 읽는다", () => {
  expect(instrumentGradeRank(item({ itemId: "POTATO_M1" }))).toBe(1);
  expect(instrumentGradeRank(item({ itemId: "CORN_M5" }))).toBe(5);
  expect(instrumentGradeRank(item({ itemId: "SWEET_POTATO_M3" }))).toBeGreaterThan(
    instrumentGradeRank(item({ itemId: "SWEET_POTATO_M2" })),
  );
});

/* 비법서는 이름으로 등급이 불린다. 노말이 가장 낮고 전설이 가장 높다. */
it("비법서는 등급 이름을 차례로 읽는다", () => {
  const book = (grade: string) => item({ category: "SKILL_BOOK", attributes: { grade } });
  expect(instrumentGradeRank(book("normal"))).toBe(1);
  expect(instrumentGradeRank(book("legendary"))).toBe(4);
  expect(instrumentGradeRank(book("epic"))).toBeGreaterThan(instrumentGradeRank(book("rare")));
});

/* 보석은 등급 대신 레벨이 그 자리를 대신한다. */
it("보석은 레벨을 등급으로 읽는다", () => {
  const gem = (level: number) => item({ category: "GEM", attributes: { level: String(level) } });
  expect(instrumentGradeRank(gem(7))).toBe(7);
  expect(instrumentGradeRank(gem(7))).toBeGreaterThan(instrumentGradeRank(gem(1)));
});

it("등급을 알 수 없는 물건은 맨 아래로 내려간다", () => {
  expect(instrumentGradeRank(item({ itemId: "GEM_BOX", category: "MATERIAL" }))).toBe(0);
});
