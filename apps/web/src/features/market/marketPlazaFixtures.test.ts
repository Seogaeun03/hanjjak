import { expect, it } from "vitest";
import { marketPlazaFixtures } from "./marketPlazaFixtures";

it("keeps only producible gems with their real item ids and values", () => {
  const gems = marketPlazaFixtures.instruments.filter(item => item.category === "GEM");
  const expected = new Map<string, [option: string, value: string]>([
    ...[[1, 3], [2, 7], [3, 15], [4, 32], [5, 70], [6, 150], [7, 320]].map(([level, value]) => [`gem:${level}:flat_attack`, ["flat_attack", String(value)] as [string, string]] as const),
    ...[[1, 30], [2, 70], [3, 150], [4, 320], [5, 700], [6, 1500], [7, 3200]].map(([level, value]) => [`gem:${level}:flat_hp`, ["flat_hp", String(value)] as [string, string]] as const),
    ["gem:6:attack_percent", ["attack_percent", "800"]],
    ["gem:7:attack_percent", ["attack_percent", "1500"]],
    ["gem:6:flat_penetration", ["flat_penetration", "60"]],
    ["gem:7:flat_penetration", ["flat_penetration", "120"]],
    ["gem:7:critical_chance", ["critical_chance", "1200"]],
    ["gem:7:haste", ["attack_speed", "1200"]],
  ]);

  expect(gems).toHaveLength(20);
  expect(new Set(gems.map(item => item.itemId))).toEqual(new Set(expected.keys()));
  for (const gem of gems) {
    const [option, value] = expected.get(gem.itemId) ?? [];
    expect(gem.attributes).toMatchObject({ option, value });
  }
});
