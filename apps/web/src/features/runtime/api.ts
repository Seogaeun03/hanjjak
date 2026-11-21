export type ServerRuntimeSnapshot = {
  accountId: string;
  stateVersion: number;
  contentVersion: string;
  currentStageId: string;
  idleMode: "AUTO_PROGRESS" | "REPEAT_STAGE";
  repeatStageId: string | null;
  maxHp: number;
};

type Envelope<T> = { data: T };
type ErrorEnvelope = { code?: string };

const PREFETCH_TTL_MS = 10_000;

let prefetched: { promise: Promise<ServerRuntimeSnapshot>; startedAt: number } | null = null;

async function requestRuntimeState(): Promise<ServerRuntimeSnapshot> {
  const response = await fetch("/api/v1/runtime-state", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({})) as Envelope<ServerRuntimeSnapshot> & ErrorEnvelope;
  if (!response.ok) throw new Error(body.code || `HTTP ${response.status}`);
  return body.data;
}

/** 세션 확인 직후 RuntimeLifecycle 보다 먼저 요청을 보내 둔다. 결과는 fetchRuntimeState 가 한 번만 받아 간다. */
export function prefetchRuntimeState(now = Date.now()): void {
  const promise = requestRuntimeState();
  promise.catch(() => undefined);
  prefetched = { promise, startedAt: now };
}

/** 로그아웃·계정 전환 때 이전 계정의 응답을 다음 연결이 받아 가지 않게 버린다. */
export function discardPrefetchedRuntimeState(): void {
  prefetched = null;
}

export function fetchRuntimeState(now = Date.now()): Promise<ServerRuntimeSnapshot> {
  const pending = prefetched;
  prefetched = null;
  if (!pending || now - pending.startedAt > PREFETCH_TTL_MS) return requestRuntimeState();
  // 미리 보낸 요청이 실패했으면(예: 나라 선택 전) 기다리지 않고 새로 묻는다.
  return pending.promise.catch(() => requestRuntimeState());
}
