// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CosmeticBoxClaimedDialog } from "./CosmeticBoxClaimedDialog";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("moves focus into the receipt dialog, traps it, and restores it on close", () => {
  const trigger = document.createElement("button");
  trigger.textContent = "받기";
  document.body.append(trigger);
  trigger.focus();
  const onClose = vi.fn();

  const view = render(<CosmeticBoxClaimedDialog count={2} onGoToInventory={() => undefined} onClose={onClose} />);
  const inventory = screen.getByRole("button", { name: "인벤토리로 이동" });
  const cancel = screen.getByRole("button", { name: "취소" });
  expect(document.activeElement).toBe(inventory);

  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(inventory);
  fireEvent.keyDown(inventory, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);

  fireEvent.click(cancel);
  view.unmount();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
});
