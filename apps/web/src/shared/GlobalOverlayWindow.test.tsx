// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useEffect, useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalOverlayWindow } from "./GlobalOverlayWindow";

const mainSource = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const previewSource = readFileSync(resolve(process.cwd(), "src/features/battle/battle-hud-preview.tsx"), "utf8");
const overlayCss = readFileSync(resolve(process.cwd(), "src/shared/GlobalOverlayWindow.css"), "utf8");

beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* happy-dom 에는 top layer 도 inert 도 없다. 그래서 여기서는 브라우저가 쌓는 순서를
   그대로 결정하는 것 — 열린 모달 중 마지막인지 — 만 지킨다. 실제로 위에 그려지고
   아래 창이 눌리지 않는 것은 브라우저에서 확인했다. */
describe("global overlay over an already open window", () => {
  function MarketLike() {
    return <section className="market-plaza"><h2 id="market-plaza-title">거래소</h2></section>;
  }

  /* 진짜 InventoryWindow 와 같은 방식으로 연다. useEffect 로 열고, 창 자체를 누르면
     닫는다 — 거래소 클릭이 이 손잡이로 새던 것이 원래 버그였다. */
  function InventoryLikeWindow({ onClose = () => undefined }: { onClose?: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
    return <dialog
      ref={dialog}
      className="inventory-window"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    ><button type="button">인벤토리 닫기</button></dialog>;
  }

  function openDialogClasses() {
    return [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].map((dialog) => dialog.className);
  }

  it("is the last open modal, which is what puts it on top", () => {
    render(<>
      <InventoryLikeWindow />
      <GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => undefined}><MarketLike /></GlobalOverlayWindow>
    </>);

    /* 브라우저는 나중에 showModal() 한 창을 위에 놓고, 배너도 같은 기준으로 자리를
       고른다 — features/broadcast/useBannerHost.ts 의 topmostModal(). */
    expect(openDialogClasses()).toEqual(["inventory-window", "global-overlay-window"]);
    expect(screen.getByText("거래소").closest("dialog")?.className).toBe("global-overlay-window");
  });

  it("does not let a press on the overlay reach the window underneath", () => {
    const closeInventory = vi.fn();
    render(<>
      <InventoryLikeWindow onClose={closeInventory} />
      <GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => undefined}><MarketLike /></GlobalOverlayWindow>
    </>);

    fireEvent.mouseDown(document.querySelector("dialog.global-overlay-window")!);
    fireEvent.mouseDown(screen.getByText("거래소"));

    expect(closeInventory).not.toHaveBeenCalled();
    expect(openDialogClasses()).toContain("inventory-window");
  });

  it("names the window so a screen reader announces which one is on top", () => {
    render(<GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => undefined}><MarketLike /></GlobalOverlayWindow>);

    const frame = screen.getByRole("dialog", { name: "거래소" });
    expect(frame.className).toBe("global-overlay-window");
    /* 이름표가 가리키는 제목이 실제로 창 안에 있어야 한다. */
    expect(frame.querySelector("#market-plaza-title")?.textContent).toBe("거래소");
  });

  it("holds focus on the frame so no button wears a focus ring nobody asked for", () => {
    render(<GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => undefined}>
      <section className="market-plaza"><h2 id="market-plaza-title">거래소</h2><button type="button">거래하기</button></section>
    </GlobalOverlayWindow>);

    /* 틀에 두지 않으면 showModal() 이 첫 단추로 초점을 옮기고 브라우저가 :focus-visible
       로 쳐서, 누른 적 없는 탭에 테두리가 그려진다. Chromium 에서 확인했다. */
    expect(document.activeElement).toBe(document.querySelector("dialog.global-overlay-window"));
  });

  it("takes the close request itself instead of letting the browser shut the dialog", () => {
    const onClose = vi.fn();
    render(<>
      <InventoryLikeWindow />
      <GlobalOverlayWindow labelledBy="market-plaza-title" onClose={onClose}><MarketLike /></GlobalOverlayWindow>
    </>);

    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(document.querySelector("dialog.global-overlay-window")!, cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(openDialogClasses()).toContain("inventory-window");
  });

  it("releases the top layer when it goes away", () => {
    const view = render(<>
      <InventoryLikeWindow />
      <GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => undefined}><MarketLike /></GlobalOverlayWindow>
    </>);

    view.rerender(<InventoryLikeWindow />);

    /* 닫지 않고 사라지면 문서 전체가 inert 인 채로 남아 아무것도 눌리지 않는다. */
    expect(openDialogClasses()).toEqual(["inventory-window"]);
  });

  it("keeps the frame invisible so the overlay draws its own veil once", () => {
    expect(overlayCss).toMatch(/\.global-overlay-window\s*\{[^}]*background:\s*transparent/);
    expect(overlayCss).toContain(".global-overlay-window::backdrop { background: transparent; }");
    /* 틀에 filter 가 걸리면 안쪽 position: fixed 의 기준이 화면에서 이 틀로 바뀐다.
       주석을 걷어 내고 한 줄 규칙과 -webkit- 접두사까지 본다. */
    const declarations = overlayCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toMatch(/(?:^|[{;\s])(?:-webkit-|-moz-)?(?:backdrop-)?filter\s*:/);
  });
});

/* 본 앱과 프리뷰 하네스는 같은 전역 오버레이 상태를 쓴다. 한쪽만 감싸면 QA 를 도는
   프리뷰에서는 같은 버그가 그대로 남는다. */
describe("shell wiring", () => {
  it.each([
    ["main", () => mainSource],
    ["preview", () => previewSource],
  ])("%s wraps every global overlay in the shared top layer window", (_name, source) => {
    for (const overlay of ["market", "mail"]) {
      /* ` &&` 로 렌더 줄만 고른다. 프리뷰에는 같은 비교를 쓰는 삼항 라벨 줄도 있다. */
      const lines = source().split("\n").filter((entry) => entry.includes(`globalOverlay === "${overlay}" &&`));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain("<GlobalOverlayWindow");
        expect(line).toContain("labelledBy=");
      }
    }
  });
});
