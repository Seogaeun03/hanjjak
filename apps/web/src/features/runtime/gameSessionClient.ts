export type GameSessionState = {
  gameSessionId: string;
  status: "ACTIVE" | "REPLACED" | "CLOSED" | "EXPIRED";
  heartbeatIntervalSeconds: number;
  expiresAfterSeconds: number;
};

type SessionEnvelope = { data: GameSessionState };
type ErrorEnvelope = { code?: string };
type SessionLostHandler = () => void;
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SESSION_STORAGE_KEY = "hanjjak.game-session";

/* 30초 박동에 60초 만료다. 한 번 놓쳐도 30초가 남으므로 그 안에서만 다시 걸어본다.
   서버 만료 정책은 그대로 두고, 일시적 실패를 확정 만료로 오해하지 않을 여유만 만든다. */
const HEARTBEAT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000];

class GameSessionRequestError extends Error {
  constructor(readonly status: number, code: string) {
    super(code);
  }
}

/**
 * 서버가 세션을 닫았다고 답한 것인지, 요청이 서버까지 닿지 못한 것인지를 가른다.
 * 응답이 없거나 서버가 스스로 실패한 경우는 세션 상태에 대한 판정이 아니다.
 */
function isTransientSessionFailure(error: unknown): boolean {
  if (!(error instanceof GameSessionRequestError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { globalThis.setTimeout(resolve, milliseconds); });
}

export class GameSessionClient {
  private session: GameSessionState | null = null;
  private heartbeat: number | undefined;
  private opening: { accountId: string; generation: number; promise: Promise<GameSessionState> } | null = null;
  private onSessionLost: SessionLostHandler | null = null;
  private generation = 0;
  private beating = false;

  constructor(private readonly storage: SessionStorage | null = browserSessionStorage()) {}

  setSessionLostHandler(handler: SessionLostHandler | null): void {
    this.onSessionLost = handler;
  }

  async open(accountId: string): Promise<GameSessionState> {
    if (this.session) return this.session;
    const generation = this.generation;
    if (this.opening?.accountId === accountId && this.opening.generation === generation) return this.opening.promise;
    const stored = this.load(accountId);
    const promise = this.resumeOrOpen(stored, generation)
      .then((session) => {
        if (generation !== this.generation) throw new Error("GAME_SESSION_OPEN_CANCELLED");
        this.session = session;
        this.store(accountId, session);
        this.startHeartbeat(session.heartbeatIntervalSeconds);
        return session;
      })
      .finally(() => {
        if (this.opening?.promise === promise) this.opening = null;
      });
    this.opening = { accountId, generation, promise };
    return promise;
  }

  suspend(): void {
    this.generation += 1;
    this.stopHeartbeat();
    this.session = null;
  }

  invalidate(): void {
    this.suspend();
    this.clearStored();
    this.onSessionLost?.();
  }
  reportConnectionLost(): void {
    this.suspend();
    this.onSessionLost?.();
  }

  async close(): Promise<void> {
    const current = this.session;
    this.invalidate();
    if (current) await this.post(`/api/v1/game-sessions/${current.gameSessionId}/close`, { keepalive: true });
  }

  async heartbeatNow(): Promise<boolean> {
    const current = this.session;
    if (!current) return false;
    await this.sendHeartbeat();
    return this.session?.gameSessionId === current.gameSessionId;
  }

  private startHeartbeat(intervalSeconds: number): void {
    this.stopHeartbeat();
    this.heartbeat = globalThis.setInterval(() => void this.heartbeatNow(), intervalSeconds * 1000) as unknown as number;
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
  /**
   * 한 박동은 재시도까지 합쳐 한 번만 나간다. 이미 돌고 있으면 다음 주기 신호를 버려 같은
   * 세션에 명령이 겹치지 않게 하고, 재시도는 같은 Idempotency-Key로 보내 서버가 이미
   * 처리한 박동이면 저장한 결과를 그대로 돌려주게 한다.
   */
  private async sendHeartbeat(): Promise<void> {
    const current = this.session;
    const generation = this.generation;
    if (!current || this.beating) return;
    this.beating = true;
    const idempotencyKey = crypto.randomUUID();
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (this.stale(current, generation)) return;
        try {
          const session = await this.post(`/api/v1/game-sessions/${current.gameSessionId}/heartbeat`, { idempotencyKey });
          if (!this.stale(current, generation)) this.session = session;
          return;
        } catch (error) {
          if (this.stale(current, generation)) return;
          if (!isTransientSessionFailure(error)) {
            if (error instanceof GameSessionRequestError && error.status === 409 && error.message === "GAME_SESSION_NOT_ACTIVE") this.invalidate();
            else {
              this.suspend();
              this.onSessionLost?.();
            }
            return;
          }
          const wait = HEARTBEAT_RETRY_DELAYS_MS[attempt];
          if (wait === undefined) {
            // 남은 여유를 다 쓰고도 닿지 못했다. 저장값은 남겨 두고 복구 흐름에 넘긴다.
            this.suspend();
            this.onSessionLost?.();
            return;
          }
          await delay(wait);
        }
      }
    } finally {
      this.beating = false;
    }
  }

  private stale(session: GameSessionState, generation: number): boolean {
    return generation !== this.generation || this.session?.gameSessionId !== session.gameSessionId;
  }

  private async resumeOrOpen(stored: GameSessionState | null, generation: number): Promise<GameSessionState> {
    if (!stored) return this.post("/api/v1/game-sessions");
    try {
      return await this.post(`/api/v1/game-sessions/${stored.gameSessionId}/heartbeat`);
    } catch (error) {
      if (!(error instanceof GameSessionRequestError) || error.status !== 409 || error.message !== "GAME_SESSION_NOT_ACTIVE") throw error;
      if (generation !== this.generation) throw new Error("GAME_SESSION_OPEN_CANCELLED");
      this.clearStored();
      return this.post("/api/v1/game-sessions");
    }
  }

  private load(accountId: string): GameSessionState | null {
    try {
      const parsed = JSON.parse(this.storage?.getItem(SESSION_STORAGE_KEY) ?? "null") as { accountId?: string; session?: GameSessionState } | null;
      if (parsed?.accountId === accountId && parsed.session?.status === "ACTIVE") return parsed.session;
      this.storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Corrupt or unavailable browser state is disposable. The server remains authoritative.
    }
    return null;
  }

  private store(accountId: string, session: GameSessionState): void {
    try {
      this.storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accountId, session }));
    } catch {
      // Session persistence is best effort; the in-memory heartbeat remains authoritative.
    }
  }

  private clearStored(): void {
    try {
      this.storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // The server still rejects stale sessions even if browser storage is unavailable.
    }
  }

  private async post(path: string, options: { keepalive?: boolean; idempotencyKey?: string } = {}): Promise<GameSessionState> {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "Idempotency-Key": options.idempotencyKey ?? crypto.randomUUID() },
      body: "{}",
      keepalive: options.keepalive ?? false,
    });
    const body = await response.json().catch(() => ({})) as SessionEnvelope & ErrorEnvelope;
    if (!response.ok) throw new GameSessionRequestError(response.status, body.code || `HTTP ${response.status}`);
    return body.data;
  }
}

function browserSessionStorage(): SessionStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const gameSessionClient = new GameSessionClient();
export type OfflineRewardPending = {
  jobId: string;
  status: "CLAIMABLE";
  stageId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  accrualEndedAt: string | null;
  eligibleSeconds: number;
  offlineSeconds: number;
  experienceGained: number;
  riceGained: number;
  rewards: { itemId: string; quantity: number }[];
};

export async function fetchOfflineReward(): Promise<OfflineRewardPending | null> {
  const response = await fetch("/api/v1/offline-rewards/pending", { credentials: "include", headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({})) as { data?: (Omit<OfflineRewardPending, "offlineSeconds"> & { offlineSeconds?: number }) | null; code?: string };
  if (!response.ok) throw new Error(body.code || `HTTP ${response.status}`);
  if (!body.data) return null;
  return { ...body.data, offlineSeconds: body.data.offlineSeconds ?? body.data.eligibleSeconds };
}

export async function claimOfflineReward(): Promise<unknown> {
  const response = await fetch("/api/v1/offline-rewards/claim", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: "{}",
  });
  const body = await response.json().catch(() => ({})) as { data?: unknown; code?: string };
  if (!response.ok) throw new Error(body.code || `HTTP ${response.status}`);
  return body.data;
}
