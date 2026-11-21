import type { BattleHudRoute } from "./features/battle/BattleHud";


export const MANAGEMENT_SCREENS = ["battle", "battleHistory", "inventory", "equipment", "skills", "gems", "market", "mail", "dungeon", "raid", "ranking", "arena", "liveops"] as const;

export type ManagementScreen = typeof MANAGEMENT_SCREENS[number];
export type AppScreen = ManagementScreen | "cosmetics";

export const GLOBAL_OVERLAY_SCREENS = ["market", "mail"] as const;
export type GlobalOverlayScreen = typeof GLOBAL_OVERLAY_SCREENS[number];

export function isGlobalOverlayScreen(screen: AppScreen): screen is GlobalOverlayScreen {
  return (GLOBAL_OVERLAY_SCREENS as readonly AppScreen[]).includes(screen);
}

export function openCosmeticsFrom(currentScreen: AppScreen, existingGachaReturn: AppScreen | null = null): { screen: "cosmetics"; gachaReturn: AppScreen | null } {
  return {
    screen: "cosmetics",
    gachaReturn: currentScreen === "cosmetics" ? existingGachaReturn : currentScreen,
  };
}

export function openCharacterGachaFrom(currentScreen: AppScreen, existingGachaReturn: AppScreen | null = null): { screen: "cosmetics"; gachaReturn: AppScreen | null } {
  return openCosmeticsFrom(currentScreen, existingGachaReturn);
}
export const PRIMARY_NAV_ITEMS: Array<{ screen: AppScreen; label: string }> = [
  { screen: "battle", label: "전투" },
  { screen: "battleHistory", label: "전투 기록" },
  { screen: "inventory", label: "아이템" },
  { screen: "equipment", label: "장비" },
  { screen: "skills", label: "스킬" },
  { screen: "gems", label: "보석" },
  { screen: "market", label: "거래소" },
  { screen: "mail", label: "메시지함" },
  { screen: "arena", label: "아레나" },
  { screen: "ranking", label: "랭킹" },
  { screen: "cosmetics", label: "치장 뽑기" },
  { screen: "liveops", label: "이벤트" },
];

const COZY_SHARED_SCREENS = ["battleHistory", "dungeon", "raid", "ranking", "arena", "cosmetics"] as const;
export type CozySharedScreen = typeof COZY_SHARED_SCREENS[number];

export function usesCozySharedNavigation(screen: AppScreen): screen is CozySharedScreen {
  return (COZY_SHARED_SCREENS as readonly AppScreen[]).includes(screen);
}

/* 이 화면들은 화면 전체를 그림으로 쓴다. 아래 성장 메뉴와 프로필 카드까지 얹으면
   그림이 가려져, 위쪽 관리 메뉴만 남긴다. */
const TOP_BAR_ONLY_SCREENS = ["ranking", "cosmetics", "dungeon"] as const;

export function usesTopBarOnlyNavigation(screen: AppScreen): boolean {
  return (TOP_BAR_ONLY_SCREENS as readonly AppScreen[]).includes(screen);
}

const STANDALONE_MANAGEMENT_SCREENS = ["inventory", "equipment", "skills", "market", "mail", "gems", "liveops"] as const;

export function usesLegacyAppHeader(screen: AppScreen): boolean {
  return screen !== "battle"
    && !usesCozySharedNavigation(screen)
    && !(STANDALONE_MANAGEMENT_SCREENS as readonly AppScreen[]).includes(screen);
}

export function keepsBattleStageMounted(screen: AppScreen): boolean {
  return screen === "battle" || screen === "inventory" || screen === "equipment" || screen === "skills" || screen === "gems" || screen === "market" || screen === "mail" || screen === "liveops";
}

export function isRaidRouteAvailable(raid: { featureAvailable: boolean; unlocked: boolean } | undefined): boolean {
  return raid?.featureAvailable === true && raid.unlocked === true;
}

export function resolveScreenForRaidAvailability(screen: AppScreen, raid: { featureAvailable: boolean; unlocked: boolean } | undefined): AppScreen {
  return screen === "raid" && !isRaidRouteAvailable(raid) ? "battle" : screen;
}

/* 전투 HUD 라우트를 어떻게 처리할지 정하는 자리. main.tsx 안에 if 사슬로 두었더니
   레이드가 두 번 새어 나갔다 — a84a9700 이 `if (route === "raid") return;` 을 넣었고
   63b0c565 이 가드와 렌더링만 되살려서, 카드를 눌러도 아무 일이 없었다. main.tsx 는
   export 가 없고 모듈 스코프에서 createRoot 를 부르므로 어떤 검사도 닿지 못했다.
   결정을 여기로 옮겨 아래 망라 검사가 라우트를 삼키는 일을 잡는다. */
export type HudNavigation =
  | { kind: "screen"; screen: ManagementScreen }
  | { kind: "character" }
  | { kind: "settings" }
  | { kind: "cosmetics" };

export function resolveHudNavigation(route: BattleHudRoute): HudNavigation {
  if (route === "character") return { kind: "character" };
  if (route === "settings") return { kind: "settings" };
  if (route === "cosmetics") return { kind: "cosmetics" };
  return { kind: "screen", screen: route };
}
