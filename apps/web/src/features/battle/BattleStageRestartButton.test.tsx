// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AutoBattleClient } from "./autoBattleClient";
import { registerAutoBattleClient } from "./autoBattleControl";
import { BattleStageRestartButton } from "./BattleHud";

afterEach(() => {
  registerAutoBattleClient(null);
  cleanup();
});

const trigger = () => screen.getByRole("button", { name: "스테이지 재시작" }) as HTMLButtonElement;

it("버튼에도 재시작이라고 표시한다", () => {
  render(<BattleStageRestartButton />);
  expect(trigger().textContent).toContain("재시작");
  expect(trigger().textContent).not.toContain("초기화");
});

/* 재시작은 진행 중인 판을 닫고 같은 스테이지를 다시 여는 일이다. 두 호출이 이 순서로
   가야 새 장비·스킬이 실린 입력으로 다시 계산된다. */
function fakeClient(active: boolean) {
  const calls: string[] = [];
  const client = {
    get active() { return active ? ({} as never) : null; },
    stop: vi.fn(async () => { calls.push("stop"); }),
    start: vi.fn(async () => { calls.push("start"); }),
  };
  return { client: client as unknown as AutoBattleClient, calls, spies: client };
}

it("전투 중에 누르면 판을 닫고 같은 스테이지를 다시 연다", async () => {
  const { client, calls, spies } = fakeClient(true);
  registerAutoBattleClient(client);
  render(<BattleStageRestartButton />);

  fireEvent.click(trigger());

  await waitFor(() => expect(spies.start).toHaveBeenCalled());
  expect(calls).toEqual(["stop", "start"]);
});

it("전투가 없으면 아무것도 건드리지 않는다", async () => {
  const { client, spies } = fakeClient(false);
  registerAutoBattleClient(client);
  render(<BattleStageRestartButton />);

  fireEvent.click(trigger());

  await waitFor(() => expect(trigger().disabled).toBe(false));
  expect(spies.stop).not.toHaveBeenCalled();
  expect(spies.start).not.toHaveBeenCalled();
});

it("재시작이 끝날 때까지 버튼을 잠가 두 번 눌리지 않게 한다", async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const client = {
    get active() { return {} as never; },
    stop: vi.fn(async () => { await blocked; }),
    start: vi.fn(async () => {}),
  } as unknown as AutoBattleClient;
  registerAutoBattleClient(client);
  render(<BattleStageRestartButton />);

  fireEvent.click(trigger());
  await waitFor(() => expect(trigger().disabled).toBe(true));

  fireEvent.click(trigger());
  release();

  await waitFor(() => expect(trigger().disabled).toBe(false));
  expect(client.stop).toHaveBeenCalledTimes(1);
});
