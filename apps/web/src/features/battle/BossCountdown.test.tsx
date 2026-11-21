// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCountdownSeconds } from "./BattleHud";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T00:00:00Z"));
});

afterEach(() => vi.useRealTimers());

it("does not spend the boss limit during the arrival cutscene", () => {
  const { result, rerender } = renderHook(
    ({ warning }) => useCountdownSeconds(!warning, 5_000, "battle-1"),
    { initialProps: { warning: true } },
  );

  expect(result.current).toBeNull();
  act(() => vi.advanceTimersByTime(4_200));
  expect(result.current).toBeNull();

  rerender({ warning: false });
  expect(result.current).toBe(5);
  act(() => vi.advanceTimersByTime(4_801));
  expect(result.current).toBe(1);
  act(() => vi.advanceTimersByTime(199));
  expect(result.current).toBe(0);
});
