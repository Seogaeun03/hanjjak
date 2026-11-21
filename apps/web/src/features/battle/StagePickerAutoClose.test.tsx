// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BattleStageProgress } from "./BattleHud";

/* 스테이지 목록은 시간이 지나도 유지하고, 사용자가 직접 선택하거나 바깥을 누르거나
   Escape를 눌렀을 때만 닫는다. */

const stages = Array.from({ length: 3 }, (_, index) => ({
  stageId: `stage.02-0${index + 1}`,
  unlocked: true,
  clearCount: 1,
  contentVersion: "test",
  isCurrent: index === 0,
  isRepeatTarget: false,
  repeatEligible: true,
  normalMonsterIds: [],
  bossMonsterId: null,
  backgroundId: null,
  bossOnly: false,
}));

function openPicker() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BattleStageProgress
      stages={stages}
      selectedStageId="stage.02-01"
      remainingSeconds={null}
      defeatedNormals={5}
      bossOnly={false}
      bossPhase={false}
      stageComplete={false}
      idleMode="AUTO_PROGRESS"
      idleModeSaving={false}
      repeatEligible
      onSelectStage={() => undefined}
      onChangeMode={() => undefined}
    />
  </QueryClientProvider>);
  const picker = document.querySelector("details.cozy-stage-picker") as HTMLDetailsElement;
  /* 시험용 DOM 은 summary 를 눌러도 details 를 열지 않는다. 열림 자체는 브라우저 몫이라
     보고, 여기서는 열린 다음에 무엇이 일어나는지만 본다. */
  act(() => {
    picker.open = true;
    picker.dispatchEvent(new Event("toggle"));
  });
  return picker;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

it("시간이 지나도 스테이지 목록을 자동으로 닫지 않는다", () => {
  const picker = openPicker();
  expect(picker.open).toBe(true);

  act(() => void vi.advanceTimersByTime(60_000));
  expect(picker.open).toBe(true);
});

it("바깥을 누르면 스테이지 목록을 닫는다", () => {
  const picker = openPicker();

  fireEvent.pointerDown(document.body);
  expect(picker.open).toBe(false);
});

it("Escape를 누르면 스테이지 목록을 닫는다", () => {
  const picker = openPicker();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(picker.open).toBe(false);
});

it("leaves the list alone until it is opened", () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BattleStageProgress
      stages={stages}
      selectedStageId="stage.02-01"
      remainingSeconds={null}
      defeatedNormals={5}
      bossOnly={false}
      bossPhase={false}
      stageComplete={false}
      idleMode="AUTO_PROGRESS"
      idleModeSaving={false}
      repeatEligible
      onSelectStage={() => undefined}
      onChangeMode={() => undefined}
    />
  </QueryClientProvider>);

  const picker = document.querySelector("details.cozy-stage-picker") as HTMLDetailsElement;
  expect(picker.open).toBe(false);
  act(() => void vi.advanceTimersByTime(10_000));
  expect(picker.open).toBe(false);
});
