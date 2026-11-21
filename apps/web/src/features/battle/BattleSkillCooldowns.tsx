import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SkillArtwork } from "../skills/SkillArtwork";
import {
  SKILL_COOLDOWN_TICKS,
  scheduledReadyWindow,
  type BattleSkillCastSchedule,
  type SkillCooldown,
  type SkillReadyWindow,
} from "./skillCooldown";

/*
 * A small rail of the active skills the auto battle is cycling through.  A
 * skill greys out the moment its cast plays and counts back to ready, so the
 * fight reads as a rotation rather than a wall of effects.
 *
 * The countdown runs on the clock rather than on the battle's tick number.
 * Ticks only advance when an event arrives and can even step back when the
 * screen falls back to an older event, which made the seconds stutter and
 * sometimes climb — 6, then 7, then 6 again.
 *
 * 그 시계는 재생 일정에서 읽는다.  쿨타임 100틱을 그대로 초로 환산하면 화면이
 * 실제로 다음 시전을 트는 시각보다 먼저 밝아져서, 쿨타임이 돌았는데도
 * 스킬을 안 쓰는 것처럼 보였다.  등장 연출로 전투가 멈춘 동안에는 쿨타임도 함께
 * 멈춰서, 인트로가 길다고 쿨타임이 늘어난 것처럼 보이지 않는다.
 */
type FallbackDeadline = { castTick: number; readyAt: number; totalMilliseconds: number };
type CountingSkill = { skillId: string; window: SkillReadyWindow | null };

function useCooldownClock(
  cooldowns: SkillCooldown[],
  tickDurationMilliseconds: number,
  schedule: BattleSkillCastSchedule | null,
) {
  const fallbacks = useRef(new Map<string, FallbackDeadline>());
  const [, retick] = useState(0);
  /* 남은 시간은 그릴 때마다 실제 시계에서 읽고, 아래 타이머는 다시 그리기만 맡는다. */
  const now = Date.now();

  const windows: CountingSkill[] = cooldowns.map(cooldown => {
    const scheduled = scheduledReadyWindow(cooldown.skillId, schedule, now);
    if (scheduled) {
      fallbacks.current.delete(cooldown.skillId);
      return { skillId: cooldown.skillId, window: scheduled };
    }
    /* 일정이 닿지 않는 스킬만 예전처럼 재생된 사건의 틱으로 어림잡는다. */
    if (cooldown.castTick === null || schedule?.castsAt.has(cooldown.skillId)) {
      fallbacks.current.delete(cooldown.skillId);
      return { skillId: cooldown.skillId, window: null };
    }
    const known = fallbacks.current.get(cooldown.skillId);
    // A new cast restarts the clock; the same cast keeps the deadline it had.
    const deadline = !known || known.castTick !== cooldown.castTick
      ? {
        castTick: cooldown.castTick,
        readyAt: now + cooldown.remainingTicks * tickDurationMilliseconds,
        totalMilliseconds: SKILL_COOLDOWN_TICKS * tickDurationMilliseconds,
      }
      : known;
    fallbacks.current.set(cooldown.skillId, deadline);
    return {
      skillId: cooldown.skillId,
      window: { remainingMilliseconds: Math.max(0, deadline.readyAt - now), totalMilliseconds: deadline.totalMilliseconds },
    };
  });

  const counting = windows.some(({ window }) => (window?.remainingMilliseconds ?? 0) > 0);
  useEffect(() => {
    if (!counting) return;
    const timer = globalThis.setInterval(() => retick(frame => frame + 1), 100);
    return () => globalThis.clearInterval(timer);
  }, [counting]);

  return windows.map(({ skillId, window }) => {
    const remaining = window?.remainingMilliseconds ?? 0;
    return {
      skillId,
      onCooldown: remaining > 0,
      /* Round up so anything still running reads at least 1초. */
      remainingSeconds: Math.ceil(remaining / 1_000),
      progress: window ? Math.min(1, Math.max(0, 1 - remaining / window.totalMilliseconds)) : 1,
    };
  });
}

export function BattleSkillCooldowns({ cooldowns, names, tickDurationMilliseconds, schedule = null }: {
  cooldowns: SkillCooldown[];
  names: Record<string, string>;
  tickDurationMilliseconds: number;
  schedule?: BattleSkillCastSchedule | null;
}) {
  const live = useCooldownClock(cooldowns, tickDurationMilliseconds, schedule);
  if (live.length === 0) return null;
  return <ul className="battle-skill-cooldowns" aria-label="사용한 스킬과 재사용 시간">
    {live.map(cooldown => {
      const name = names[cooldown.skillId] ?? cooldown.skillId;
      return <li
        key={cooldown.skillId}
        className={cooldown.onCooldown ? "is-cooling" : "is-ready"}
        style={{ "--skill-cooldown-progress": cooldown.progress } as CSSProperties}
      >
        <SkillArtwork skillId={cooldown.skillId} name={name} compact />
        <i aria-hidden="true" />
        {cooldown.onCooldown
          ? <b aria-label={`${name} 재사용까지 ${cooldown.remainingSeconds}초`}>{cooldown.remainingSeconds}</b>
          : <span className="battle-skill-ready" aria-label={`${name} 사용 가능`} />}
      </li>;
    })}
  </ul>;
}
