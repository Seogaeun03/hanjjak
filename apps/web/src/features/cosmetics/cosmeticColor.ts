import { useSyncExternalStore } from "react";

/**
 * 내가 고른 색.
 *
 * 색은 서버가 들고 있다. 남이 보는 내 모습(랭킹)에도 같은 색이 나와야 하기 때문이다.
 * 여기 있는 것은 그 값을 화면이 빨리 꺼내 쓰라고 두는 자리다. 치장 목록을 받을 때마다
 * 갱신한다.
 *
 * 조합기가 색을 안 받으면 이 값을 쓴다. 전투·던전·장비·랭킹 자리마다 색을 들려 보내면
 * 한 자리만 빠뜨려도 캐릭터가 화면마다 다른 색으로 선다.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function cosmeticColor(): string | null {
  return current;
}

/** 서버가 내려준 색을 기억한다. 치장 목록을 받는 곳이면 어디서든 부른다. */
export function rememberCosmeticColor(next: string | null | undefined): void {
  const value = next ?? null;
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 고른 색을 읽고, 바뀌면 다시 그린다. */
export function useCosmeticColor(): string | null {
  return useSyncExternalStore(subscribe, cosmeticColor, () => null);
}
