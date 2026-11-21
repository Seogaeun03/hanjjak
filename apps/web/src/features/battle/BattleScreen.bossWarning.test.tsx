// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CombatRenderingEvent } from "./sessionApi";
import { useBossArrivalWarning } from "./BattleScreen";
import { useCountdownSeconds } from "./BattleHud";

function bossSpawn(eventId: string): CombatRenderingEvent {
  return {
    eventId,
    logicalTick: 400,
    type: "BOSS_SPAWNED",
    actor: "ENEMY",
    target: "PLAYER",
    enemyIndex: 21,
    boss: true,
    skillId: null,
    damage: null,
    critical: false,
    hpBefore: null,
    hpAfter: null,
    defeated: false,
  };
}

describe("boss arrival warning event flow", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["stage.03-04", "ruby-jam-sand-queen", false, 2800],
    ["stage.04-10", "futomaki-king", true, 4200],
  ] as const)("shows and automatically hides the %s boss warning", (stageId, monsterId, finalBoss, duration) => {
    vi.useFakeTimers();
    const event = bossSpawn(`boss-${stageId}`);
    const { result, rerender } = renderHook(
      ({ events }) => useBossArrivalWarning(events, stageId, "battle-1"),
      { initialProps: { events: [] as CombatRenderingEvent[] } },
    );

    expect(result.current).toBeNull();
    rerender({ events: [event] });
    expect(result.current).toEqual({ eventId: event.eventId, monsterId, finalBoss });

    act(() => vi.advanceTimersByTime(duration - 1));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();

    rerender({ events: [event] });
    expect(result.current).toBeNull();
  });

  it("restarts the full countdown after the intro when a repeated battle reuses the same event id", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));
    const event = bossSpawn("event-00042");
    const { result, rerender } = renderHook(
      ({ battleSessionId, events }) => {
        const warning = useBossArrivalWarning(events, "stage.01-04", battleSessionId);
        const remainingSeconds = useCountdownSeconds(warning === null && events.length > 0, 10_000, battleSessionId);
        return { warning, remainingSeconds };
      },
      { initialProps: { battleSessionId: "battle-1", events: [] as CombatRenderingEvent[] } },
    );

    rerender({ battleSessionId: "battle-1", events: [event] });
    expect(result.current).toEqual({ warning: expect.objectContaining({ eventId: event.eventId }), remainingSeconds: null });
    act(() => vi.advanceTimersByTime(2800));
    expect(result.current).toEqual({ warning: null, remainingSeconds: 10 });

    rerender({ battleSessionId: "battle-2", events: [] });
    rerender({ battleSessionId: "battle-2", events: [event] });
    expect(result.current).toEqual({ warning: expect.objectContaining({ eventId: event.eventId }), remainingSeconds: null });
    act(() => vi.advanceTimersByTime(2799));
    expect(result.current.remainingSeconds).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ warning: null, remainingSeconds: 10 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remainingSeconds).toBe(9);
  });
});
