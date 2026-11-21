// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresetEditor } from "./GemManagement";
import type { GemState } from "./api";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const data: GemState = {
  unlocked: true,
  tickets: 3,
  secondsUntilNextTicket: 0,
  todayBoss: "SURVIVAL",
  gemBoxQuantity: 0,
  gems: [],
  presets: {},
  lockedPresets: [],
  contentVersion: "test",
};

describe("gem preset visibility", () => {
  it("shows three defaults and only the next unlock action", () => {
    render(<PresetEditor data={data} busy={false} riceBalance={20_000} onSave={vi.fn()} />);

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const unlockButton = screen.getByRole("button", { name: "프리셋 4 열기" });
    expect(unlockButton.querySelector("span")?.textContent).toBe("");
    expect(unlockButton.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("tab", { name: "프리셋 5" })).toBeNull();
    expect(document.querySelectorAll(".gem-preset-tabs > *")).toHaveLength(4);
  });

  it("opens the confirmation above the loadout panel instead of clipping it inside the tab scroller", () => {
    render(<PresetEditor data={data} busy={false} riceBalance={20_000} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "프리셋 4 열기" }));

    const dialog = screen.getByRole("dialog", { name: "프리셋 열기 확인" });
    expect(dialog.closest(".gem-preset-tab-shell.unlock")).toBeNull();
    expect(dialog.closest(".gem-loadout-panel")).not.toBeNull();
    expect(dialog.parentElement?.classList.contains("gem-unlock-confirm-layer")).toBe(true);
    expect(dialog.textContent).toContain("5,000 쌀");
  });

  it("closes the panel-level confirmation with Escape", () => {
    render(<PresetEditor data={data} busy={false} riceBalance={20_000} onSave={vi.fn()} />);

    const unlockButton = screen.getByRole("button", { name: "프리셋 4 열기" });
    fireEvent.click(unlockButton);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "예" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "프리셋 열기 확인" })).toBeNull();
    expect(document.activeElement).toBe(unlockButton);
  });

  it("keeps keyboard focus inside the confirmation", () => {
    render(<PresetEditor data={data} busy={false} riceBalance={20_000} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "프리셋 4 열기" }));
    const yesButton = screen.getByRole("button", { name: "예" });
    const noButton = screen.getByRole("button", { name: "아니오" });
    noButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(yesButton);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(noButton);
  });

  it("keeps the confirmation open for dialog interaction and closes it from the backdrop", () => {
    render(<PresetEditor data={data} busy={false} riceBalance={20_000} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "프리셋 4 열기" }));
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "프리셋 열기 확인" }));
    expect(screen.getByRole("dialog", { name: "프리셋 열기 확인" })).toBeDefined();

    fireEvent.mouseDown(document.querySelector(".gem-unlock-confirm-layer")!);
    expect(screen.queryByRole("dialog", { name: "프리셋 열기 확인" })).toBeNull();
  });

  it("moves the single unlock action to the preset immediately after the newly opened preset", () => {
    render(<PresetEditor data={data} busy={false} riceBalance={20_000} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "프리셋 4 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    expect(screen.getByRole("tab", { name: "프리셋 4" })).toBeDefined();
    expect(screen.getByRole("button", { name: "프리셋 5 열기" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "프리셋 4 열기" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /프리셋 \d+ 열기/ })).toHaveLength(1);
  });
});
