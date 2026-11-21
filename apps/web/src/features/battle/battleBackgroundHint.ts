/*
 * 전투 배경은 LCP 요소다. 실제 배경은 세션 → 나라 선택 → runtime-state 응답을 거쳐야 정해져서
 * 발견이 늦다. 마지막으로 본 배경 주소를 기억해 두고, 다음 진입 때 index.html 이 JS 보다 먼저
 * preload 를 걸고 runtime 복원 전 화면도 그 배경으로 그린다.
 *
 * index.html 의 인라인 스크립트가 같은 키와 패턴을 쓴다. 바꿀 때는 둘을 함께 고친다.
 */
import { backgroundAsset } from "./battleVisuals";

export const BATTLE_BACKGROUND_HINT_KEY = "hanjjak.battle-background";

const HINT_PATTERN = /^\/assets\/[A-Za-z0-9/_.-]+\.(?:webp|png|jpe?g)$/;

type HintStorage = Pick<Storage, "getItem" | "setItem">;

export function isBattleBackgroundHint(value: string | null | undefined): value is string {
  return typeof value === "string" && HINT_PATTERN.test(value) && !value.includes("..");
}

export function readBattleBackgroundHint(storage: HintStorage | null | undefined): string | null {
  try {
    const value = storage?.getItem(BATTLE_BACKGROUND_HINT_KEY);
    return isBattleBackgroundHint(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberBattleBackground(storage: HintStorage | null | undefined, url: string): void {
  if (!isBattleBackgroundHint(url)) return;
  try {
    if (storage?.getItem(BATTLE_BACKGROUND_HINT_KEY) !== url) storage?.setItem(BATTLE_BACKGROUND_HINT_KEY, url);
  } catch {
    // 저장소를 못 쓰면 다음 진입에서 preload 만 빠진다.
  }
}

export function browserLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * runtime-state 로 복원되기 전 selectedStageId 는 초기값(1-1)이라 그대로 쓰면 엉뚱한 챕터 배경을 받는다.
 * 복원 전에는 기억해 둔 배경만 쓰고, 없으면 배경 없이 그린다.
 */
export function resolveBattleBackground(
  runtimeRestored: boolean,
  hint: string | null,
  backgroundId: string | null | undefined,
  stageId: string,
): string | null {
  return runtimeRestored ? backgroundAsset(backgroundId, stageId) : hint;
}
