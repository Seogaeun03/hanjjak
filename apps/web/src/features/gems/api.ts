import { observeServerTime } from "../../shared/serverClock";

export type GemOption = "FLAT_ATTACK" | "FLAT_HP" | "ATTACK_PERCENT" | "FLAT_PENETRATION" | "CRITICAL_CHANCE" | "HASTE";
export type GemPreset = "MAIN" | "SURVIVAL" | "BERSERK" | "ARMORED";
/** slotId는 가방 칸 번호다. 잠금은 이 칸에 걸리므로, 서버가 내려줄 때만 잠금 단추를 쓸 수 있다. */
export type GemSummary = { gemId: string; level: number; option: GemOption; optionName: string; value: number; locked: boolean; reservedForSale: boolean; equippedPresets: GemPreset[]; slotId?: string };
export type GemState = { unlocked: boolean; tickets: number; secondsUntilNextTicket: number; todayBoss: GemPreset; gemBoxQuantity: number; gems: GemSummary[]; presets: Partial<Record<GemPreset, GemSummary[]>>; lockedPresets: GemPreset[]; contentVersion: string };
export type GemOpenResult = { granted: GemSummary[]; state: GemState };
export type GemPresetUpdateResult = { preset: GemPreset; mainBattleRestarted: boolean; state: GemState };
export type GemFusionMode = "MANUAL" | "SAFE_BATCH";
export type GemFusionSelection = { option: GemOption; quantity: number };
export type GemFusionPreview = { consumedGemIds: string[]; consumption: Array<{ option: GemOption; optionName: string; quantity: number }>; fusionCount: number; inputLevel: number; resultLevel: number };
export type GemFusionResult = { consumedGemIds: string[]; granted: GemSummary[]; state: GemState };
export type GemDungeonChallengeStatus = "ACTIVE" | "SUCCEEDED" | "FAILED" | "ABORTED" | "EXPIRED";
export type GemDungeonEventType = "BATTLE_START" | "SKILL_CAST" | "PLAYER_HIT" | "DOT_HIT" | "BOSS_HIT" | "SURVIVAL_STRIKE" | "VICTORY" | "DEFEAT";
export type GemDungeonCombatEvent = { sequence: number; tick: number; type: GemDungeonEventType; skillId: string | null; amount: number; playerHp: number; bossHp: number; critical: boolean };
export type GemDungeonCombatResult = { success: boolean; failureCode: string | null; elapsedTicks: number; remainingPlayerHp: number; remainingBossHp: number; events: GemDungeonCombatEvent[] };
export type GemDungeonChallenge = { challengeId: string; boss: GemPreset; stage: number; status: GemDungeonChallengeStatus; minimumCompleteAt: string; expiresAt: string; rewardGemBoxes: number; contentVersion: string; battle: GemDungeonCombatResult };
export type GemDungeonRankingEntry = { rank: number; nickname: string; stage: number; clearedAt: string };
export type GemDungeonRanking = { topEntries: GemDungeonRankingEntry[]; myEntry: GemDungeonRankingEntry | null };
export type GemDungeonToday = { boss: GemPreset; tickets: number; secondsUntilNextTicket: number; progress: { boss: GemPreset; highestClearedStage: number }[]; nextChallengeStage: number | null; sweepStage: number | null; nextChallengeRewardGemBoxes: number | null; sweepRewardGemBoxesPerTicket: number | null; activeChallenge: GemDungeonChallenge | null; testBossSelectionEnabled: boolean; rankings: Partial<Record<Exclude<GemPreset, "MAIN">, GemDungeonRanking>> };
export type GemDungeonCompletion = { challenge: GemDungeonChallenge; state: GemState };
export type GemDungeonSweepResult = { boss: GemPreset; stage: number; count: number; rewardGemBoxes: number; state: GemState };
type Envelope<T> = { serverTime?: string; data: T };
type ErrorEnvelope = { code?: string; messageKey?: string };
async function json<T>(response: Response, requestStartedAt: number): Promise<T> { const body = await response.json().catch(() => ({})) as Envelope<T> & ErrorEnvelope; observeServerTime(body.serverTime, requestStartedAt, Date.now()); if (!response.ok) throw Object.assign(new Error(body.code || body.messageKey || `HTTP ${response.status}`), body); return body.data; }
/** 보낸 시각을 들고 응답을 받는다. 봉투의 serverTime 과 견줘야 서버 시계 오차가 나온다. */
function request<T>(url: string, init?: RequestInit): Promise<T> { const startedAt = Date.now(); return fetch(url, init).then((response) => json<T>(response, startedAt)); }
function commandHeaders(): HeadersInit { return { Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }; }
export const gemsApi = {
  lockSlot: (slotId: string, locked: boolean) => request<GemState>(`/api/v1/gems/slots/${encodeURIComponent(slotId)}/lock`, { method: "PUT", credentials: "include", headers: commandHeaders(), body: JSON.stringify({ locked }) }),
  state: () => request<GemState>("/api/v1/gems", { credentials: "include", headers: { Accept: "application/json" } }),
  openBoxes: (quantity: number) => request<GemOpenResult>("/api/v1/gems/boxes/open", { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify({ quantity }) }),
  updatePreset: (preset: GemPreset, gemIds: string[]) => request<GemPresetUpdateResult>(`/api/v1/gems/presets/${preset}`, { method: "PUT", credentials: "include", headers: commandHeaders(), body: JSON.stringify({ gemIds }) }),
  previewFusion: (preview: { mode: GemFusionMode; level?: number; gemIds?: string[]; selections?: GemFusionSelection[] }) => request<GemFusionPreview>("/api/v1/gem-fusions/preview", { method: "POST", credentials: "include", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(preview) }),
  fuse: (mode: GemFusionMode, gemIds: string[], options?: { targetLevel: number; allowedOptions: GemOption[] }) => request<GemFusionResult>("/api/v1/gem-fusions", { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify({ mode, gemIds, ...options }) }),
};

export const gemDungeonsApi = {
  today: (boss?: GemPreset) => request<GemDungeonToday>(`/api/v1/gem-dungeons/today${boss ? `?boss=${boss}` : ""}`, { credentials: "include", headers: { Accept: "application/json" } }),
  start: (boss?: GemPreset) => request<GemDungeonChallenge>("/api/v1/gem-dungeons/challenges", { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify(boss ? { boss } : {}) }),
  complete: (challengeId: string) => request<GemDungeonCompletion>(`/api/v1/gem-dungeons/challenges/${challengeId}/complete`, { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify({}) }),
  abort: (challengeId: string) => request<GemDungeonCompletion>(`/api/v1/gem-dungeons/challenges/${challengeId}/abort`, { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify({}) }),
  sweep: (count: number) => request<GemDungeonSweepResult>("/api/v1/gem-dungeons/sweeps", { method: "POST", credentials: "include", headers: commandHeaders(), body: JSON.stringify({ count }) }),
};
