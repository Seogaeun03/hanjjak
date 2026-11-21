import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* P3 에서 첫 화면 밖으로 내보낸 화면들. 여기로 정적 import 가 하나라도 되살아나면
   그 화면의 JS 와 CSS 가 통째로 첫 번들에 다시 들어온다 — 빌드는 통과하고 용량만
   조용히 두 배가 되므로, 의존 그래프를 직접 걸어 막는다. */
const LAZY_SCREENS = [
  "src/features/market/MarketPlaza.tsx",
  "src/features/gems/GemsScreen.tsx",
  "src/features/raid/RaidScreen.tsx",
  "src/features/arena/ArenaScreen.tsx",
  "src/features/ranking/RankingScreen.tsx",
  "src/features/mail/MailScreen.tsx",
  "src/features/inventory/InventoryScreen.tsx",
  "src/features/equipment/EquipmentScreen.tsx",
  "src/features/skills/SkillsScreen.tsx",
  "src/features/profile/ProfileScreen.tsx",
  "src/features/character/CharacterWindow.tsx",
  "src/features/cosmetics/CosmeticsScreen.tsx",
];

const root = process.cwd().replace(/\\/g, "/");

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = posix.join(posix.dirname(from), spec);
  for (const suffix of [".tsx", ".ts", "/index.tsx", "/index.ts", ""]) {
    const candidate = base + suffix;
    if (existsSync(resolve(root, candidate)) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** main.tsx 에서 정적 import 만 따라간 모듈 목록. `import()` 는 따라가지 않는다. */
function staticGraph(entry: string): Map<string, string[]> {
  const parents = new Map<string, string[]>([[entry, []]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const text = readFileSync(resolve(root, file), "utf8");
    for (const match of text.matchAll(/(?:^|\n)\s*((?:import|export)\s[^;]*?)from\s+["']([^"']+)["']/g)) {
      /* `import type` 은 빌드에서 지워진다. 번들에 모듈을 끌어오지 않으므로 세지 않는다. */
      if (/^(?:import|export)\s+type\s/.test(match[1])) continue;
      const next = resolveImport(file, match[2]);
      if (!next || parents.has(next)) continue;
      parents.set(next, [...(parents.get(file) ?? []), file]);
      queue.push(next);
    }
  }
  return parents;
}

describe("첫 번들", () => {
  const graph = staticGraph("src/main.tsx");

  it.each(LAZY_SCREENS)("%s 는 첫 번들에 정적으로 딸려 오지 않는다", (screen) => {
    const path = graph.get(screen);
    expect(path ? [...path, screen].join(" → ") : null).toBeNull();
  });

  it("전투 HUD 는 메시지함 화면 대신 걸러 내는 규칙만 가져온다", () => {
    const hud = readFileSync(resolve(root, "src/features/battle/BattleHud.tsx"), "utf8");
    expect(hud).toContain('from "../mail/mailFilters"');
  });

  it("전투 쿨타임 줄은 스킬 화면 대신 스킬 그림만 가져온다", () => {
    const cooldowns = readFileSync(resolve(root, "src/features/battle/BattleSkillCooldowns.tsx"), "utf8");
    expect(cooldowns).toContain('from "../skills/SkillArtwork"');
  });
});
