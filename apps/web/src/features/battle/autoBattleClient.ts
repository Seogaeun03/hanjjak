import type { BattleEnemySettlement, BattleRenderingCheckpoint, BattleSessionResult, BattleSessionStarted, CombatRenderingEvent } from "./sessionApi";
import { battleSessionApi, BattleSessionRequestError } from "./sessionApi";
import type { BattleSkillCastSchedule } from "./skillCooldown";

export type AutoBattleHandlers = {
  gameSessionId: () => string | null;
  stageId: () => string;
  onStarted: (session: BattleSessionStarted) => void;
  onProgress: (checkpoint: BattleRenderingCheckpoint) => void;
  onEvents?: (events: CombatRenderingEvent[]) => void;
  onScheduled?: (schedule: BattleSkillCastSchedule) => void;
  onSettled?: (settlements: BattleEnemySettlement[]) => void;
  onCompleted: (result: BattleSessionResult, retryAt: number | null) => void;
  onStopped: () => void;
  onError: (error: Error) => void;
  onConnectionLost?: (error: Error) => void;
};

const BATTLE_HEARTBEAT_INTERVAL_MS = 30_000;
/* 전투 토큰은 90초 무신호까지 버틴다. 30초 주기에서 한 번 놓쳐도 그 안에서 다시 걸어본다. */
const BATTLE_TRANSIENT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000];
const MIN_RENDER_INTERVAL_MS = 50;
/* 스테이지를 열자마자 달리는 모습만 한참 보인다는 말을 들었다. 붙는 데 드는 시간을 줄인다. */
export const ENCOUNTER_APPROACH_DURATION_MS = 300;
export const REGULAR_BOSS_INTRO_DURATION_MS = 2_800;
export const FINAL_BOSS_INTRO_DURATION_MS = 4_200;
export const DIRECT_ATTACK_IMPACT_DELAY_MS = 320;
const BATTLE_COMPLETION_RETRY_MS = 250;
const MAX_BATTLE_COMPLETION_RETRIES = 20;
const MAX_BATTLE_SETTLEMENT_RETRIES = 20;
const BATTLE_FAILURE_RETRY_DELAY_MS = 1_000;

/** 응답이 없거나 서버가 스스로 실패한 경우는 전투 세션에 대한 판정이 아니다. */
function isTransientBattleFailure(error: unknown): boolean {
  if (!(error instanceof BattleSessionRequestError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;
}

export function bossIntroDurationMs(stageId: string): number {
  return stageId.endsWith("-10") ? FINAL_BOSS_INTRO_DURATION_MS : REGULAR_BOSS_INTRO_DURATION_MS;
}

export class AutoBattleClient {
  private session: BattleSessionStarted | null = null;
  private heartbeatTimer: number | undefined;
  private eventTimers: number[] = [];
  private transitionTimer: number | undefined;
  private retryStageId: string | null = null;
  private settlementQueue: Promise<void> = Promise.resolve();
  private lastCheckpoint: BattleRenderingCheckpoint | null = null;
  private settlementKeys = new Map<number, `${string}-${string}-${string}-${string}-${string}`>();
  private deliveredSettlementIds = new Set<string>();
  private stopped = true;
  private beating = false;

  constructor(private readonly handlers: AutoBattleHandlers) {}

  get active(): BattleSessionStarted | null {
    return this.session;
  }
  get currentStageId(): string | null {
    return this.session?.stageId ?? this.retryStageId;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.startNext();
  }

  async stop(keepalive = false): Promise<void> {
    if (this.stopped && !this.session && !this.retryStageId) return;
    this.stopped = true;
    this.clearTimers();
    const session = this.session;
    const checkpoint = this.lastCheckpoint;
    const gameSessionId = this.handlers.gameSessionId();
    this.session = null;
    this.retryStageId = null;
    this.handlers.onStopped();
    if (session && gameSessionId) {
      await this.settlementQueue.catch(() => undefined);
      await battleSessionApi.abort(session, gameSessionId, checkpoint, keepalive).catch(() => undefined);
    }
  }

  async heartbeatNow(): Promise<void> {
    const session = this.session;
    if (session) await this.heartbeat(session);
  }

  private async startNext(stageId = this.handlers.stageId()): Promise<void> {
    if (this.stopped) return;
    const gameSessionId = this.handlers.gameSessionId();
    if (!gameSessionId) {
      this.fail(new Error("GAME_SESSION_NOT_ACTIVE"));
      return;
    }
    try {
      const session = await battleSessionApi.start(stageId, gameSessionId);
      if (this.stopped) {
        await battleSessionApi.abort(session, gameSessionId).catch(() => undefined);
        return;
      }
      this.session = session;
      this.retryStageId = null;
      this.lastCheckpoint = { logicalTick: session.logicalTickBasis, defeatedNormals: 0, playerHp: session.input.player.maxHp };
      this.settlementQueue = Promise.resolve();
      this.settlementKeys.clear();
      this.deliveredSettlementIds.clear();
      this.handlers.onStarted(session);
      const renderingDuration = this.scheduleProgress(session);
      this.heartbeatTimer = globalThis.setInterval(() => void this.heartbeat(session), BATTLE_HEARTBEAT_INTERVAL_MS) as unknown as number;
      this.transitionTimer = globalThis.setTimeout(
        () => void this.complete(session),
        Math.max(MIN_RENDER_INTERVAL_MS, session.durationMilliseconds, renderingDuration + MIN_RENDER_INTERVAL_MS),
      ) as unknown as number;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("BATTLE_SESSION_START_FAILED");
      if (isTransientBattleFailure(error)) this.connectionLost(failure);
      else this.fail(failure);
    }
  }

  private scheduleProgress(session: BattleSessionStarted): number {
    let defeatedNormals = 0;
    let playerHp = session.input.player.maxHp;
    let renderingOffset = 0;
    let renderingDuration = 0;
    let normalSpawnCount = 0;
    let lastNormalDefeatAt = 0;
    let encounterReadyAt = 0;
    const groups = new Map<number, CombatRenderingEvent[]>();
    const skillCastOffsets = new Map<string, number[]>();
    const pauseOffsets: { from: number; to: number }[] = [];
    for (const event of session.renderingTimeline ?? []) {
      const isNormalSpawn = event.type === "ENEMY_SPAWNED";
      const isBossSpawn = event.type === "BOSS_SPAWNED";
      /*
       * 서버가 정한 틱 속도 그대로 튼다.  한동안 1.5배로 늘려 틀었는데, 던전과
       * 레이드는 1:1로 트는 탓에 같은 스킬의 지속·재사용 시간이 화면마다 달랐다.
       */
      const baseAt = event.logicalTick * session.tickDurationMilliseconds + renderingOffset + eventRenderingDelay(event);
      const replacementReadyAt = (isNormalSpawn && normalSpawnCount > 0) || isBossSpawn ? lastNormalDefeatAt : 0;
      const at = Math.max(0, encounterReadyAt, baseAt, replacementReadyAt);
      groups.set(at, [...(groups.get(at) ?? []), event]);
      if (event.type === "PLAYER_SKILL_CAST_STARTED" && event.skillId) {
        skillCastOffsets.set(event.skillId, [...(skillCastOffsets.get(event.skillId) ?? []), at]);
      }
      renderingDuration = Math.max(renderingDuration, at);
      if (event.type === "ENEMY_DEFEATED" && !event.boss) lastNormalDefeatAt = at;
      if (isNormalSpawn) encounterReadyAt = at;
      /* 연출이 끼는 동안은 남은 타임라인이 통째로 밀린다 — 전투가 멈춰 서는 구간이다. */
      if (isNormalSpawn && normalSpawnCount++ === 0) {
        pauseOffsets.push({ from: at, to: at + ENCOUNTER_APPROACH_DURATION_MS });
        renderingOffset += ENCOUNTER_APPROACH_DURATION_MS;
      }
      if (isBossSpawn) {
        pauseOffsets.push({ from: at, to: at + bossIntroDurationMs(session.stageId) });
        renderingOffset += bossIntroDurationMs(session.stageId);
      }
    }
    const renderingStartedAt = Date.now();
    for (const [at, events] of groups) {
      const timer = globalThis.setTimeout(() => {
        if (this.session?.battleSessionId !== session.battleSessionId) return;
        for (const event of events) {
          if (event.type === "ENEMY_DEFEATED" && !event.boss) defeatedNormals++;
          if ((event.type === "PLAYER_HIT" || event.type === "PLAYER_DEFEATED") && event.hpAfter !== null) playerHp = event.hpAfter;
        }
        const checkpoint = { logicalTick: events.at(-1)?.logicalTick ?? 0, defeatedNormals, playerHp };
        this.lastCheckpoint = checkpoint;
        this.handlers.onEvents?.(events);
        this.handlers.onProgress(checkpoint);
        if (events.some((event) => event.type === "ENEMY_DEFEATED" && !event.boss)) {
          this.queueSettlement(session, checkpoint);
        }
      }, at) as unknown as number;
      this.eventTimers.push(timer);
    }
    /*
     * 재사용 칸은 이 일정으로 센다.  틱을 초로 환산하면 조우와 보스 등장 연출로
     * 멈춰 선 시간만큼 어긋나서, 쿨타임이 돌았다고 밝아진 스킬이 뒤늦게 나갔다.
     */
    this.handlers.onScheduled?.({
      castsAt: new Map([...skillCastOffsets].map(([skillId, offsets]) => [
        skillId,
        [...offsets].sort((left, right) => left - right).map((offset) => renderingStartedAt + offset),
      ])),
      pauses: pauseOffsets.map(({ from, to }) => ({ from: renderingStartedAt + from, to: renderingStartedAt + to })),
      renderedTickMilliseconds: session.tickDurationMilliseconds,
    });
    return renderingDuration;
  }

  private queueSettlement(session: BattleSessionStarted, checkpoint: BattleRenderingCheckpoint): void {
    const key = this.settlementKeys.get(checkpoint.defeatedNormals) ?? crypto.randomUUID();
    this.settlementKeys.set(checkpoint.defeatedNormals, key);
    this.settlementQueue = this.settlementQueue.then(() => this.settle(session, checkpoint, key));
    void this.settlementQueue.catch((error) => this.fail(error instanceof Error ? error : new Error("BATTLE_SETTLEMENT_FAILED")));
  }

  private async settle(session: BattleSessionStarted, checkpoint: BattleRenderingCheckpoint, key: `${string}-${string}-${string}-${string}-${string}`, retries = 0): Promise<void> {
    const gameSessionId = this.handlers.gameSessionId();
    if (!gameSessionId || this.session?.battleSessionId !== session.battleSessionId) return;
    try {
      const result = await battleSessionApi.settle(session, gameSessionId, checkpoint.defeatedNormals, checkpoint, key);
      if (this.session?.battleSessionId !== session.battleSessionId) return;
      this.deliverSettlements(result.settlements);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("BATTLE_SETTLEMENT_FAILED");
      if (failure.message === "BATTLE_SETTLEMENT_NOT_READY" && retries < MAX_BATTLE_SETTLEMENT_RETRIES) {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, BATTLE_COMPLETION_RETRY_MS));
        return this.settle(session, checkpoint, key, retries + 1);
      }
      const wait = isTransientBattleFailure(error) ? BATTLE_TRANSIENT_RETRY_DELAYS_MS[retries] : undefined;
      if (wait !== undefined) {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, wait));
        return this.settle(session, checkpoint, key, retries + 1);
      }
      if (isTransientBattleFailure(error)) {
        this.connectionLost(failure);
        return;
      }
      throw failure;
    }
  }

  private deliverSettlements(settlements: BattleEnemySettlement[]): void {
    const unseen = settlements.filter((settlement) => !this.deliveredSettlementIds.has(settlement.settlementId));
    if (unseen.length === 0) return;
    unseen.forEach((settlement) => this.deliveredSettlementIds.add(settlement.settlementId));
    this.handlers.onSettled?.(unseen);
  }

  /**
   * 일시적 실패 한 번으로 전투를 끊지 않는다. 서버가 세션을 닫았다고 답한 경우만 즉시
   * 실패로 올리고, 닿지 못한 요청은 토큰 만료 전까지 제한된 횟수만 다시 보낸다.
   */
  private async heartbeat(session: BattleSessionStarted): Promise<void> {
    if (this.beating) return;
    this.beating = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        const gameSessionId = this.handlers.gameSessionId();
        if (!gameSessionId || this.session?.battleSessionId !== session.battleSessionId) return;
        try {
          await battleSessionApi.heartbeat(session, gameSessionId);
          return;
        } catch (error) {
          if (this.session?.battleSessionId !== session.battleSessionId) return;
          const wait = isTransientBattleFailure(error) ? BATTLE_TRANSIENT_RETRY_DELAYS_MS[attempt] : undefined;
          if (wait === undefined) {
            const failure = error instanceof Error ? error : new Error("BATTLE_SESSION_HEARTBEAT_FAILED");
            if (isTransientBattleFailure(error)) this.connectionLost(failure);
            else this.fail(failure);
            return;
          }
          await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, wait); });
        }
      }
    } finally {
      this.beating = false;
    }
  }

  private async complete(session: BattleSessionStarted, notReadyRetries = 0): Promise<void> {
    const gameSessionId = this.handlers.gameSessionId();
    if (!gameSessionId || this.session?.battleSessionId !== session.battleSessionId) return;
    try {
      await this.settlementQueue;
      this.clearTimers();
      const checkpoint = this.lastCheckpoint ?? {
        logicalTick: session.logicalTickBasis,
        defeatedNormals: 0,
        playerHp: session.input.player.maxHp,
      };
      const result = await battleSessionApi.complete(session, gameSessionId, null, checkpoint);
      if (this.session?.battleSessionId !== session.battleSessionId) return;
      this.session = null;
      const retryAt = result.battle.success ? null : Date.now() + BATTLE_FAILURE_RETRY_DELAY_MS;
      this.deliverSettlements(result.settlements);
      this.handlers.onCompleted(result, retryAt);
      if (this.stopped) return;
      if (result.battle.success) {
        await this.startNext();
      } else {
        /*
         * 다음 판은 서버가 정한다. 실패하면 서버가 앞 판을 돌려주므로 진 판을 그대로 다시 열면
         * 안 된다. 예전에는 result.stageId 로 다시 열고, 선택 판이 달라진 걸 본 AutoBattleRuntime
         * 이 클라이언트를 통째로 껐다 켜서 겨우 앞 판으로 갔다. 그 경로는 부활 대기와 안내를
         * 함께 날려서 쓰러진 뒤 아무 설명도 못 보여 줬다.
         */
        this.retryStageId = result.nextStageId;
        this.transitionTimer = globalThis.setTimeout(() => void this.startNext(result.nextStageId), BATTLE_FAILURE_RETRY_DELAY_MS) as unknown as number;
      }
    } catch (error) {
      if (this.stopped || this.session?.battleSessionId !== session.battleSessionId) return;
      const failure = error instanceof Error ? error : new Error("BATTLE_SESSION_COMPLETE_FAILED");
      if (failure.message === "BATTLE_SESSION_NOT_READY" && notReadyRetries < MAX_BATTLE_COMPLETION_RETRIES) {
        this.transitionTimer = globalThis.setTimeout(() => void this.complete(session, notReadyRetries + 1), BATTLE_COMPLETION_RETRY_MS) as unknown as number;
        return;
      }
      if (isTransientBattleFailure(error)) this.connectionLost(failure);
      else this.fail(failure);
    }
  }

  private fail(error: Error): void {
    this.stopped = true;
    this.clearTimers();
    this.session = null;
    this.retryStageId = null;
    this.lastCheckpoint = null;
    this.settlementKeys.clear();
    this.deliveredSettlementIds.clear();
    this.handlers.onError(error);
  }

  private connectionLost(error: Error): void {
    this.stopped = true;
    this.clearTimers();
    this.session = null;
    this.retryStageId = null;
    this.lastCheckpoint = null;
    this.settlementKeys.clear();
    this.deliveredSettlementIds.clear();
    this.handlers.onConnectionLost?.(error);
  }

  private clearTimers(): void {
    clearInterval(this.heartbeatTimer);
    for (const timer of this.eventTimers) clearTimeout(timer);
    clearTimeout(this.transitionTimer);
    this.heartbeatTimer = undefined;
    this.eventTimers = [];
    this.transitionTimer = undefined;
  }
}

function eventRenderingDelay(event: CombatRenderingEvent): number {
  if (event.type === "PLAYER_ATTACK_IMPACT" || event.type === "PLAYER_SKILL_IMPACT") return DIRECT_ATTACK_IMPACT_DELAY_MS;
  if (event.type === "ENEMY_DEFEATED") return 380;
  if (event.type === "ENEMY_ATTACK_STARTED") return 420;
  if (event.type === "PLAYER_HIT") return 480;
  if (event.type === "PLAYER_DEFEATED" || event.type === "BATTLE_FAILED" || event.type === "BATTLE_CYCLE_COMPLETED") return 520;
  return 0;
}
