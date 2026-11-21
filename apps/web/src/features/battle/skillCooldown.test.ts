import { describe, expect, it } from "vitest";
import { scheduledReadyWindow, skillCooldowns, SKILL_COOLDOWN_TICKS } from "./skillCooldown";
import type { CombatRenderingEvent } from "./sessionApi";

function cast(skillId: string, logicalTick: number): CombatRenderingEvent {
  return {
    eventId: `${skillId}-${logicalTick}`, logicalTick, type: "PLAYER_SKILL_CAST_STARTED", actor: "PLAYER",
    target: null, enemyIndex: null, boss: false, skillId, damage: null, critical: false,
    hpBefore: null, hpAfter: null, defeated: false,
  };
}
const ORDER = ["active_haste", "active_heavy"];

describe("skillCooldowns", () => {
  it("reports a skill as ready before it has ever been cast", () => {
    const [haste] = skillCooldowns(ORDER, [], 0, 100);
    expect(haste).toMatchObject({ skillId: "active_haste", onCooldown: false, remainingTicks: 0, progress: 1 });
  });

  it("puts a skill on cooldown the moment its cast plays", () => {
    const [haste, heavy] = skillCooldowns(ORDER, [cast("active_haste", 40)], 40, 100);
    expect(haste).toMatchObject({ onCooldown: true, remainingTicks: SKILL_COOLDOWN_TICKS, remainingSeconds: 10, progress: 0 });
    expect(heavy.onCooldown).toBe(false);
  });

  it("counts the cooldown down and rounds the seconds up so it never reads zero early", () => {
    const [haste] = skillCooldowns(ORDER, [cast("active_haste", 40)], 135, 100);
    expect(haste.remainingTicks).toBe(5);
    expect(haste.remainingSeconds).toBe(1);
    expect(haste.onCooldown).toBe(true);
  });

  it("becomes ready again once the full cooldown has passed", () => {
    const [haste] = skillCooldowns(ORDER, [cast("active_haste", 40)], 140, 100);
    expect(haste).toMatchObject({ onCooldown: false, remainingTicks: 0, remainingSeconds: 0, progress: 1 });
  });

  it("ignores casts the screen has not played yet and keeps only the latest one", () => {
    const events = [cast("active_haste", 10), cast("active_haste", 60), cast("active_haste", 400)];
    const [haste] = skillCooldowns(ORDER, events, 100, 100);
    expect(haste.remainingTicks).toBe(SKILL_COOLDOWN_TICKS - 40);
  });
});

describe("cast tick", () => {
  it("reports the cast the clock should count from, and nothing before the first cast", () => {
    const [haste, heavy] = skillCooldowns(ORDER, [cast("active_haste", 10), cast("active_haste", 60)], 100, 100);
    expect(haste.castTick).toBe(60);
    expect(heavy.castTick).toBeNull();
  });
});

describe("scheduledReadyWindow", () => {
  const schedule = { castsAt: new Map([["active_heavy", [1_000, 16_000]]]), pauses: [], renderedTickMilliseconds: 150 };

  it("counts to the moment the replay plays the next cast, not to the raw cooldown", () => {
    expect(scheduledReadyWindow("active_heavy", schedule, 1_000)).toEqual({ remainingMilliseconds: 15_000, totalMilliseconds: 15_000 });
    expect(scheduledReadyWindow("active_heavy", schedule, 11_000)).toEqual({ remainingMilliseconds: 5_000, totalMilliseconds: 15_000 });
  });

  it("leaves a skill ready until its first cast has played", () => {
    expect(scheduledReadyWindow("active_heavy", schedule, 999)).toBeNull();
  });

  it("falls back to the rendered cooldown once no further cast is scheduled", () => {
    expect(scheduledReadyWindow("active_heavy", schedule, 16_000)).toEqual({ remainingMilliseconds: 15_000, totalMilliseconds: 15_000 });
    expect(scheduledReadyWindow("active_heavy", schedule, 20_000)).toEqual({ remainingMilliseconds: 11_000, totalMilliseconds: 15_000 });
  });

  it("says nothing about a skill the schedule does not cover", () => {
    expect(scheduledReadyWindow("active_dot", schedule, 16_000)).toBeNull();
    expect(scheduledReadyWindow("active_heavy", null, 16_000)).toBeNull();
  });
});

/*
 * 보스 등장 연출 동안은 전투가 멈춰 선다.  그 시간까지 세면 쿨타임이 한 바퀴보다
 * 길어져서, 인트로가 붙었다고 스킬 쿨타임 자체가 늘어난 것처럼 보인다.
 */
describe("scheduledReadyWindow, with the replay paused for an intro", () => {
  const schedule = {
    castsAt: new Map([["active_heavy", [0, 18_000]]]),
    pauses: [{ from: 5_000, to: 8_000 }],
    renderedTickMilliseconds: 150,
  };

  it("never counts beyond one cooldown even though the cast is 18s away", () => {
    expect(scheduledReadyWindow("active_heavy", schedule, 0)).toEqual({ remainingMilliseconds: 15_000, totalMilliseconds: 15_000 });
  });

  it("holds the countdown still while the intro plays", () => {
    expect(scheduledReadyWindow("active_heavy", schedule, 5_000)?.remainingMilliseconds).toBe(10_000);
    expect(scheduledReadyWindow("active_heavy", schedule, 6_500)?.remainingMilliseconds).toBe(10_000);
    expect(scheduledReadyWindow("active_heavy", schedule, 8_000)?.remainingMilliseconds).toBe(10_000);
  });

  it("picks the countdown back up and runs out exactly as the cast plays", () => {
    expect(scheduledReadyWindow("active_heavy", schedule, 9_000)?.remainingMilliseconds).toBe(9_000);
    expect(scheduledReadyWindow("active_heavy", schedule, 17_999)?.remainingMilliseconds).toBe(1);
    /* 시전이 나가는 순간 다음 한 바퀴가 시작한다. */
    expect(scheduledReadyWindow("active_heavy", schedule, 18_000)?.remainingMilliseconds).toBe(15_000);
  });
});
