import { describe, expect, it } from "vitest";
import type { BattleHudRoute } from "./features/battle/BattleHud";
import {
  keepsBattleStageMounted,
  MANAGEMENT_SCREENS,
  openCharacterGachaFrom,
  openCosmeticsFrom,
  PRIMARY_NAV_ITEMS,
  isRaidRouteAvailable,
  isGlobalOverlayScreen,
  resolveScreenForRaidAvailability,
  usesLegacyAppHeader,
  usesCozySharedNavigation,
  usesTopBarOnlyNavigation,
  resolveHudNavigation,
} from "./navigationState";

describe("management screen navigation", () => {
  it("exposes cosmetics as a direct entry without persisting it as a management screen", () => {
    expect(PRIMARY_NAV_ITEMS).toContainEqual({ screen: "cosmetics", label: "치장 뽑기" });
    expect(MANAGEMENT_SCREENS).not.toContain("cosmetics");
  });


  it("classifies mail and marketplace as global overlays", () => {
    expect(isGlobalOverlayScreen("market")).toBe(true);
    expect(isGlobalOverlayScreen("mail")).toBe(true);
    expect(isGlobalOverlayScreen("ranking")).toBe(false);
    expect(isGlobalOverlayScreen("cosmetics")).toBe(false);
  });

  it("returns an unavailable raid route to battle until authoritative raid state permits it", () => {
    const storedRaid = "raid";
    expect(resolveScreenForRaidAvailability(storedRaid, undefined)).toBe("battle");
    expect(resolveScreenForRaidAvailability(storedRaid, { featureAvailable: false, unlocked: true })).toBe("battle");
    expect(resolveScreenForRaidAvailability(storedRaid, { featureAvailable: true, unlocked: false })).toBe("battle");
    expect(resolveScreenForRaidAvailability(storedRaid, { featureAvailable: true, unlocked: true })).toBe("raid");
    expect(isRaidRouteAvailable({ featureAvailable: true, unlocked: true })).toBe(true);
  });

  it("keeps the shared HUD on full-page connected management pages", () => {
    expect(MANAGEMENT_SCREENS.filter(usesCozySharedNavigation)).toEqual(["battleHistory", "dungeon", "raid", "ranking", "arena"]);
    expect(usesCozySharedNavigation("cosmetics")).toBe(true);
  });

  it("shows only the upper utility buttons on full-screen art pages", () => {
    for (const screen of ["ranking", "cosmetics", "dungeon"] as const) {
      expect(usesTopBarOnlyNavigation(screen)).toBe(true);
    }
  });

  it("never shows the legacy header on the screens served by the shared HUD", () => {
    for (const screen of ["battleHistory", "dungeon", "ranking", "arena", "cosmetics"] as const) {
      expect(usesLegacyAppHeader(screen)).toBe(false);
    }
  });

  it("never shows the legacy header on standalone management windows, including liveops", () => {
    // liveops renders its own <header>. Falling through to the legacy header (as it did before
    // it was added here) doubled up the chrome: the legacy app header and the "성장 메뉴"
    // launcher both rendered alongside the screen's own header.
    for (const screen of ["inventory", "equipment", "skills", "market", "mail", "gems", "liveops"] as const) {
      expect(usesLegacyAppHeader(screen)).toBe(false);
    }
  });

  it("keeps the battle stage mounted behind a growth or marketplace overlay", () => {
    expect(keepsBattleStageMounted("battle")).toBe(true);
    expect(keepsBattleStageMounted("equipment")).toBe(true);
    expect(keepsBattleStageMounted("skills")).toBe(true);
    expect(keepsBattleStageMounted("market")).toBe(true);
    expect(keepsBattleStageMounted("inventory")).toBe(true);
    expect(keepsBattleStageMounted("gems")).toBe(true);
    // 이벤트 뽑기는 전투 화면 위에 뜨는 창이다. 무대를 내리면 창 뒤가 빈 배경이 된다.
    expect(keepsBattleStageMounted("liveops")).toBe(true);
  });
});

describe("cosmetic gacha navigation", () => {
  it("preserves every management origin for the return action", () => {
    const origins = ["battle", "battleHistory", "gems", "dungeon", "inventory", "skills", "market", "ranking"] as const;
    expect(origins.map((origin) => openCosmeticsFrom(origin))).toEqual(
      origins.map((origin) => ({ screen: "cosmetics", gachaReturn: origin })),
    );
  });

  it("preserves the existing origin when cosmetics is already active", () => {
    expect(openCosmeticsFrom("cosmetics", "inventory")).toEqual({
      screen: "cosmetics",
      gachaReturn: "inventory",
    });
  });

  it("preserves the character gacha origin on active re-entry and captures normal entry", () => {
    expect(openCharacterGachaFrom("cosmetics", "inventory")).toEqual({
      screen: "cosmetics",
      gachaReturn: "inventory",
    });
    expect(openCharacterGachaFrom("battle", "inventory")).toEqual({
      screen: "cosmetics",
      gachaReturn: "battle",
    });
  });
});

/* 레이드가 두 번 새어 나간 자리다. main.tsx 의 if 사슬이 route === "raid" 일 때 맨손으로
   return 해서, 콘텐츠 피커의 레이드 카드를 눌러도 아무 일이 없었다. main.tsx 는 export 가
   없고 모듈 스코프에서 createRoot 를 불러 어떤 검사도 닿지 못했다. 라우트마다 무엇을 할지
   여기서 정하고 전부 망라해 확인한다. */
describe("전투 HUD 라우트 처리", () => {
  const HUD_ROUTES = [
    "battle", "battleHistory", "character", "equipment", "inventory", "skills",
    "gems", "dungeon", "raid", "market", "mail", "ranking", "arena", "settings", "cosmetics", "liveops",
  ] as const;

  /* 이 목록은 BattleHudRoute 를 손으로 베낀 것이라 조용히 어긋난다. 실제로 이벤트 화면을
     MANAGEMENT_SCREENS 와 main.tsx 에만 붙였을 때, HUD 에는 들어갈 단추가 없는데도 아래
     검사들이 전부 통과했다 — 목록에 없는 라우트는 검사되지 않기 때문이다. 누락을 타입
     검사에서 막는다: 덮이지 않은 라우트가 하나라도 있으면 아래 타입이 never 가 되어 깨진다. */
  it("BattleHudRoute 를 하나도 빠뜨리지 않는다", () => {
    const allCovered: Exclude<BattleHudRoute, typeof HUD_ROUTES[number]> extends never ? true : never = true;
    expect(allCovered).toBe(true);
  });

  it("어떤 라우트도 삼키지 않는다", () => {
    for (const route of HUD_ROUTES) {
      const action = resolveHudNavigation(route);
      expect(action, `${route} 라우트가 처리되지 않는다`).toBeDefined();
      expect(["screen", "character", "settings", "cosmetics"]).toContain(action.kind);
    }
  });

  it("레이드 카드를 누르면 레이드 화면으로 간다", () => {
    expect(resolveHudNavigation("raid")).toEqual({ kind: "screen", screen: "raid" });
  });

  it("화면 전환 라우트는 모두 관리 화면이다", () => {
    for (const route of HUD_ROUTES) {
      const action = resolveHudNavigation(route);
      if (action.kind === "screen") expect(MANAGEMENT_SCREENS).toContain(action.screen);
    }
  });

  it("모달로 여는 세 라우트는 화면 전환이 아니다", () => {
    expect(resolveHudNavigation("character")).toEqual({ kind: "character" });
    expect(resolveHudNavigation("settings")).toEqual({ kind: "settings" });
    expect(resolveHudNavigation("cosmetics")).toEqual({ kind: "cosmetics" });
  });
});
