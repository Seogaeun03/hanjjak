// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BattleSkillCooldowns } from "./BattleSkillCooldowns";
import { skillCooldowns, SKILL_COOLDOWN_TICKS, type BattleSkillCastSchedule } from "./skillCooldown";
import type { CombatRenderingEvent } from "./sessionApi";

const TICK_MS = 100;
const COOLDOWN_MS = SKILL_COOLDOWN_TICKS * TICK_MS;
const NAMES = { active_heavy: "강타" };

function cast(skillId: string, logicalTick: number): CombatRenderingEvent {
  return {
    eventId: `${skillId}-${logicalTick}`, logicalTick, type: "PLAYER_SKILL_CAST_STARTED", actor: "PLAYER",
    target: null, enemyIndex: null, boss: false, skillId, damage: null, critical: false,
    hpBefore: null, hpAfter: null, defeated: false,
  };
}

function rail(schedule: BattleSkillCastSchedule, events: CombatRenderingEvent[], playedTick: number) {
  return <BattleSkillCooldowns
    cooldowns={skillCooldowns(["active_heavy"], events, playedTick, TICK_MS)}
    names={NAMES}
    tickDurationMilliseconds={TICK_MS}
    schedule={schedule}
  />;
}

describe("battle skill cooldowns", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /* 화면이 서버 틱 속도로 돌면 쿨타임 100틱은 꼬박 10초다. */
  it("counts one cooldown down to the moment the replay casts again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule: BattleSkillCastSchedule = {
      castsAt: new Map([["active_heavy", [0, COOLDOWN_MS]]]),
      pauses: [],
      renderedTickMilliseconds: TICK_MS,
    };
    render(rail(schedule, [cast("active_heavy", 0)], 0));

    expect(screen.getByLabelText("강타 재사용까지 10초")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(9_900));
    expect(screen.queryByLabelText("강타 사용 가능")).toBeNull();
    expect(screen.getByLabelText("강타 재사용까지 1초")).toBeTruthy();

    /* 시전이 실제로 나가는 순간 다음 주기가 곧바로 시작한다 — 비는 구간이 없다. */
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.queryByLabelText("강타 사용 가능")).toBeNull();
    expect(screen.getByLabelText("강타 재사용까지 10초")).toBeTruthy();
  });

  /* 보스 인트로는 전투를 세워 둔다.  쿨타임이 늘어난 것처럼 보이면 안 된다. */
  it("holds the countdown still through a boss intro instead of stretching it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule: BattleSkillCastSchedule = {
      castsAt: new Map([["active_heavy", [0, COOLDOWN_MS + 3_000]]]),
      pauses: [{ from: 5_000, to: 8_000 }],
      renderedTickMilliseconds: TICK_MS,
    };
    render(rail(schedule, [cast("active_heavy", 0)], 0));

    /* 다음 시전은 13초 뒤지만 쿨타임 한 바퀴는 어디까지나 10초다. */
    expect(screen.getByLabelText("강타 재사용까지 10초")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(5_000));
    expect(screen.getByLabelText("강타 재사용까지 5초")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.getByLabelText("강타 재사용까지 5초")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.getByLabelText("강타 재사용까지 5초")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.getByLabelText("강타 재사용까지 4초")).toBeTruthy();
  });

  it("leaves a skill ready until its first cast plays", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule: BattleSkillCastSchedule = {
      castsAt: new Map([["active_heavy", [5_000]]]),
      pauses: [],
      renderedTickMilliseconds: TICK_MS,
    };
    render(rail(schedule, [], 0));

    expect(screen.getByLabelText("강타 사용 가능")).toBeTruthy();
  });

  it("counts the rendered cooldown out when the cycle holds no further cast", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const schedule: BattleSkillCastSchedule = {
      castsAt: new Map([["active_heavy", [0]]]),
      pauses: [],
      renderedTickMilliseconds: TICK_MS,
    };
    render(rail(schedule, [cast("active_heavy", 0)], 0));

    act(() => void vi.advanceTimersByTime(9_900));
    expect(screen.getByLabelText("강타 재사용까지 1초")).toBeTruthy();

    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByLabelText("강타 사용 가능")).toBeTruthy();
  });
});
