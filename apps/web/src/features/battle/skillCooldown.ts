import type { CombatRenderingEvent } from "./sessionApi";

/*
 * The battle HUD shows which active skills just fired and how long until they
 * come round again.  Nothing in the session payload carries a cooldown, but the
 * simulator's rule is fixed — every active skill goes on cooldown for
 * SKILL_COOLDOWN_TICKS from the tick it was cast — so the whole thing can be
 * read back out of the rendering events the screen is already playing.
 */
export const SKILL_COOLDOWN_TICKS = 100;

export type SkillCooldown = {
  skillId: string;
  /** The tick of the most recent cast the screen has played, or null if never. */
  castTick: number | null;
  /** True from the moment the cast plays until the cooldown runs out. */
  onCooldown: boolean;
  remainingTicks: number;
  remainingSeconds: number;
  /** 0 when just cast, 1 when ready again — for a sweep or bar. */
  progress: number;
};

export function skillCooldowns(
  activeOrder: string[],
  events: CombatRenderingEvent[],
  playedTick: number,
  tickDurationMilliseconds: number,
): SkillCooldown[] {
  const castAt = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "PLAYER_SKILL_CAST_STARTED" || !event.skillId) continue;
    if (event.logicalTick > playedTick) continue;
    castAt.set(event.skillId, event.logicalTick);
  }
  return activeOrder.map(skillId => {
    const cast = castAt.get(skillId);
    const elapsed = cast === undefined ? SKILL_COOLDOWN_TICKS : playedTick - cast;
    const remainingTicks = Math.max(0, SKILL_COOLDOWN_TICKS - elapsed);
    return {
      skillId,
      castTick: cast ?? null,
      onCooldown: remainingTicks > 0,
      remainingTicks,
      /* Round up: a skill with any time left should never read "0초". */
      remainingSeconds: Math.ceil(remainingTicks * tickDurationMilliseconds / 1_000),
      progress: Math.min(1, Math.max(0, elapsed / SKILL_COOLDOWN_TICKS)),
    };
  });
}

/*
 * 틱은 화면에 실시간으로 흐르지 않는다.  조우와 보스 등장 연출이 끼면 그 동안은
 * 전투를 아예 멈춰 세운다.  그래서 "쿨타임 100틱"을 그대로 초로 환산해 세면
 * 아이콘이 먼저 밝아지고 스킬은 뒤늦게 나간다.
 *
 * 재생기는 각 시전을 언제 틀지, 어디서 전투를 멈춰 세울지 이미 알고 있다.  그걸
 * 받아서 "전투가 실제로 흐른 시간"만 센다.  연출로 멈춘 동안에는 쿨타임도 멈추고,
 * 그래서 표시되는 시간이 쿨타임 한 바퀴보다 길어지는 일이 없다.
 */
export type BattleSkillCastSchedule = {
  /** 스킬별로 시전이 화면에 뜨는 시각(epoch ms).  오름차순. */
  castsAt: Map<string, number[]>;
  /** 전투가 멈춰 서는 구간(epoch ms).  조우와 보스 등장 연출이 여기 들어온다. */
  pauses: { from: number; to: number }[];
  /** 화면에서 1틱이 흐르는 시간.  서버가 정한 틱 속도 그대로다. */
  renderedTickMilliseconds: number;
};

/** 남은 쿨타임과, 되감기 표시에 쓸 이번 주기의 길이.  둘 다 전투가 흐른 시간이다. */
export type SkillReadyWindow = { remainingMilliseconds: number; totalMilliseconds: number };

/** 두 시각 사이에서 전투가 멈춰 있는 시간. */
function pausedBetween(pauses: { from: number; to: number }[], from: number, to: number): number {
  let paused = 0;
  for (const pause of pauses) paused += Math.max(0, Math.min(to, pause.to) - Math.max(from, pause.from));
  return paused;
}

/** 두 시각 사이에서 전투가 실제로 흐른 시간. */
function battleSpan(schedule: BattleSkillCastSchedule, from: number, to: number): number {
  return Math.max(0, to - from - pausedBetween(schedule.pauses, from, to));
}

/**
 * 재생 일정에서 이 스킬의 남은 쿨타임을 읽는다.
 * 아직 한 번도 나가지 않았거나 일정이 없으면 null — 그때는 사용 가능한 상태다.
 */
export function scheduledReadyWindow(
  skillId: string,
  schedule: BattleSkillCastSchedule | null | undefined,
  now: number,
): SkillReadyWindow | null {
  const castsAt = schedule?.castsAt.get(skillId);
  if (!schedule || !castsAt || castsAt.length === 0) return null;
  let lastCastAt: number | undefined;
  let nextCastAt: number | undefined;
  for (const castAt of castsAt) {
    if (castAt <= now) lastCastAt = castAt;
    else {
      nextCastAt = castAt;
      break;
    }
  }
  if (lastCastAt === undefined) return null;
  const cooldownMilliseconds = SKILL_COOLDOWN_TICKS * schedule.renderedTickMilliseconds;
  /* 남은 일정에 시전이 없으면 — 사이클이 곧 끝난다 — 쿨타임 한 바퀴만 센다. */
  if (nextCastAt === undefined) {
    return {
      remainingMilliseconds: Math.max(0, cooldownMilliseconds - battleSpan(schedule, lastCastAt, now)),
      totalMilliseconds: cooldownMilliseconds,
    };
  }
  return {
    remainingMilliseconds: battleSpan(schedule, now, nextCastAt),
    totalMilliseconds: Math.max(1, battleSpan(schedule, lastCastAt, nextCastAt)),
  };
}
