// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PresetEditor } from "./GemManagement";
import type { GemState, GemSummary } from "./api";

const PRESET_STORAGE_KEY = "hanjjak.gem-presets.v3";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function gem(gemId: string, level: number, option: GemSummary["option"] = "FLAT_ATTACK"): GemSummary {
  return { gemId, level, option, optionName: `${option} ${gemId}`, value: level * 8, locked: false, reservedForSale: false, equippedPresets: [] };
}

function state(gems: GemSummary[]): GemState {
  return { unlocked: true, tickets: 3, secondsUntilNextTicket: 600, todayBoss: "SURVIVAL", gemBoxQuantity: 2, gems, presets: {}, lockedPresets: [], contentVersion: "v1" };
}

/* 저장해 둔 프리셋에 전투 연결이 적혀 있지 않은 경우가 있다. 연결을 기억하기 전에 쓰던
   기록이 그렇다. 그때 기본 연결까지 지워 버리면 저장을 눌러도 서버로 아무것도 안 가고,
   화면만 바뀐 채 보석이 실제로는 착용되지 않는다. */
it("메인 전투 연결이 빠진 기록을 읽어도 기본 연결을 지키고 서버에 보낸다", () => {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify({
    unlockedCount: 3,
    activeIndex: 0,
    riceSpent: 0,
    presets: [{ name: "프리셋 1", gemIds: [] }, { name: "프리셋 2", gemIds: [] }, { name: "프리셋 3", gemIds: [] }],
  }));
  const attack = gem("attack", 3);
  const onSave = vi.fn();
  render(<PresetEditor data={state([attack])} busy={false} onSave={onSave} />);

  fireEvent.click(screen.getByRole("button", { name: /^3레벨 FLAT_ATTACK attack/ }));
  fireEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));

  expect(onSave).toHaveBeenCalledWith(["MAIN"], ["attack"]);
});

/* 직접 끈 연결은 그대로 꺼져 있어야 한다. 기본값으로 되살아나면 끌 방법이 없어진다. */
it("직접 끈 연결은 기본값으로 되살아나지 않는다", () => {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify({
    unlockedCount: 3,
    activeIndex: 0,
    riceSpent: 0,
    presets: [{ name: "프리셋 1", gemIds: [] }, { name: "프리셋 2", gemIds: [] }, { name: "프리셋 3", gemIds: [] }],
    assignments: { MAIN: null, SURVIVAL: 1, BERSERK: 2, ARMORED: 2, RAID: null },
  }));
  const onSave = vi.fn();
  render(<PresetEditor data={state([gem("attack", 3)])} busy={false} onSave={onSave} />);

  fireEvent.click(screen.getByRole("button", { name: /^3레벨 FLAT_ATTACK attack/ }));
  fireEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));

  expect(onSave).toHaveBeenCalledWith([], ["attack"]);
});

/* 저장해 둔 프리셋의 보석이 합성·판매로 사라지거나, 같은 브라우저에서 다른 계정으로
   들어오면 ID 만 남는다. 그 ID 까지 칸을 차지한 것으로 세면 슬롯은 비어 보이는데
   목록은 "슬롯 가득 참"으로 잠겨, 보석을 한 개도 끼울 수 없다. */
it("사라진 보석 ID 는 칸을 차지하지 않는다", () => {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify({
    unlockedCount: 3,
    activeIndex: 0,
    riceSpent: 0,
    presets: [
      { name: "프리셋 1", gemIds: ["gone-1", "gone-2", "gone-3", "gone-4", "gone-5", "gone-6"] },
      { name: "프리셋 2", gemIds: [] },
      { name: "프리셋 3", gemIds: [] },
    ],
    assignments: { MAIN: 0, SURVIVAL: 1, BERSERK: 2, ARMORED: 2, RAID: null },
  }));
  const attack = gem("attack", 3);
  const onSave = vi.fn();
  render(<PresetEditor data={state([attack])} busy={false} onSave={onSave} />);

  expect(screen.queryByText("슬롯 가득 참")).toBeNull();
  const tile = screen.getByRole("button", { name: /^3레벨 FLAT_ATTACK attack/ }) as HTMLButtonElement;
  expect(tile.disabled).toBe(false);

  fireEvent.click(tile);
  fireEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));
  expect(onSave).toHaveBeenCalledWith(["MAIN"], ["attack"]);
});
