import { describe, expect, it } from "vitest";
import { SCREEN_CHUNKS, screenChunkForRoute } from "./screenChunks";
import { MANAGEMENT_SCREENS } from "./navigationState";
import type { BattleHudRoute } from "./features/battle/BattleHud";

/* 첫 화면과 같은 청크에 있는 두 화면. 미리 받을 것이 없다. */
const BUNDLED_WITH_FIRST_SCREEN = ["battle", "battleHistory"];

const HUD_ROUTES: BattleHudRoute[] = [
  "battle", "battleHistory", "character", "equipment", "inventory", "skills", "gems",
  "dungeon", "raid", "market", "mail", "ranking", "arena", "settings", "cosmetics",
];

describe("화면 청크", () => {
  it("전투 HUD 가 부르는 모든 라우트는 미리 받을 청크를 안다", () => {
    const missing = HUD_ROUTES
      .filter((route) => !BUNDLED_WITH_FIRST_SCREEN.includes(route))
      .filter((route) => screenChunkForRoute(route) === undefined);
    expect(missing).toEqual([]);
  });

  it("관리 화면과 치장 화면도 마찬가지다", () => {
    const screens = [...MANAGEMENT_SCREENS, "cosmetics"];
    const missing = screens
      .filter((screen) => !BUNDLED_WITH_FIRST_SCREEN.includes(screen))
      .filter((screen) => screenChunkForRoute(screen) === undefined);
    expect(missing).toEqual([]);
  });

  it("던전은 보석 화면이, 설정은 마이페이지가 그린다", () => {
    expect(screenChunkForRoute("dungeon")).toBe("gems");
    expect(screenChunkForRoute("settings")).toBe("profile");
  });

  it("첫 화면과 같은 청크인 라우트는 미리 받지 않는다", () => {
    expect(screenChunkForRoute("battle")).toBeUndefined();
    expect(screenChunkForRoute("battleHistory")).toBeUndefined();
  });

  it("가리키는 청크 이름은 모두 실재한다", () => {
    for (const route of HUD_ROUTES) {
      const chunk = screenChunkForRoute(route);
      if (chunk) expect(typeof SCREEN_CHUNKS[chunk]).toBe("function");
    }
  });
});
