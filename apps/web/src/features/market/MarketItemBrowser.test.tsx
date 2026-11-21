// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarketItemBrowser } from "./MarketItemBrowser";
import { browseMarketItems, browseShowsCheapestOnly, EMPTY_BROWSE, type MarketBrowse } from "./marketBrowse";
import type { MarketInstrument } from "./api";

afterEach(cleanup);

function material(itemId: string, displayName: string): MarketInstrument {
  return {
    instrumentId: `inst-${itemId}`, canonicalKey: itemId.toLowerCase(), itemId, displayName,
    category: "MATERIAL", attributes: {}, status: "ACTIVE",
    bestBidUnitPrice: 10, bestAskUnitPrice: 12, lastTradeUnitPrice: 11, marketRevision: 1,
  };
}

const catalog = [
  material("POTATO_M1", "감자 조각"), material("POTATO_M2", "작은 감자"), material("POTATO_M3", "감자"),
  material("CORN_M1", "옥수수 알갱이"),
  {
    instrumentId: "inst-gem", canonicalKey: "gem:3:flat_attack", itemId: "gem:3:flat_attack", displayName: "3레벨 공격력 보석",
    category: "GEM", attributes: { level: "3", option: "flat_attack", value: "12" }, status: "ACTIVE",
    bestBidUnitPrice: 900, bestAskUnitPrice: 1_000, lastTradeUnitPrice: 950, marketRevision: 1,
  } satisfies MarketInstrument,
];

/** 화면과 상태를 함께 굴린다. 왼쪽 칸이 하는 일은 "무엇을 보여 줄지"를 바꾸는 것뿐이다. */
function renderBrowser(initial: MarketBrowse = EMPTY_BROWSE, recent: MarketInstrument[] = []) {
  const state = { browse: initial };
  const onSelect = vi.fn();
  const draw = () => render(<MarketItemBrowser
    catalog={catalog} selected={catalog[0]} browse={state.browse} recent={recent} onSelect={onSelect}
    onBrowse={next => { state.browse = next; cleanup(); draw(); }} />);
  draw();
  return { state, onSelect };
}

function rowNames() {
  return within(document.querySelector(".market-browser-rows")!).getAllByRole("button").map(row => row.querySelector("strong")?.textContent);
}

it("opens on the four categories, not on a list of every item", () => {
  renderBrowser();

  expect(rowNames()).toEqual(["전체", "강화재료", "스킬북", "보석"]);
});

it("opens a branch underneath its own row instead of replacing the screen", () => {
  const { state } = renderBrowser();

  fireEvent.click(screen.getByRole("button", { name: /강화재료/ }));
  /* 누른 줄은 제자리에 남고, 형제 분류도 그대로 서 있다. 그 사이로 계열이 끼어든다. */
  expect(rowNames()).toEqual(["전체", "강화재료", "감자", "옥수수", "스킬북", "보석"]);

  fireEvent.click(screen.getByRole("button", { name: /감자/ }));
  expect(rowNames()).toEqual(["전체", "강화재료", "감자", "감자 조각", "작은 감자", "감자", "옥수수", "스킬북", "보석"]);
  expect(browseMarketItems(catalog, state.browse).map(item => item.itemId)).toEqual(["POTATO_M1", "POTATO_M2", "POTATO_M3"]);
});

it("closes a branch when its row is pressed again, and closes a sibling when another opens", () => {
  const { state } = renderBrowser();

  fireEvent.click(screen.getByRole("button", { name: /강화재료/ }));
  fireEvent.click(screen.getByRole("button", { name: /강화재료/ }));
  expect(rowNames()).toEqual(["전체", "강화재료", "스킬북", "보석"]);
  expect(state.browse).toEqual(EMPTY_BROWSE);

  /* 한 층에 열린 줄은 하나뿐이다. 둘이 함께 열리면 가운데가 무엇으로 좁혀졌는지 말할 수 없다. */
  fireEvent.click(screen.getByRole("button", { name: /강화재료/ }));
  fireEvent.click(screen.getByRole("button", { name: /보석/ }));
  expect(rowNames()).toEqual(["전체", "강화재료", "스킬북", "보석", "공격력"]);
});

it("marks the open row so it reads as the heading of what came out under it", () => {
  renderBrowser({ ...EMPTY_BROWSE, category: "MATERIAL", group: "MATERIAL:POTATO" });

  const open = [...document.querySelectorAll(".market-browser-row.is-open")].map(row => row.querySelector("strong")?.textContent);
  expect(open).toEqual(["강화재료", "감자"]);
  expect(document.querySelector(".market-browser-row.is-open")?.getAttribute("aria-expanded")).toBe("true");
});

it("shows one item on its own when a row is tapped, with every price it is listed at", () => {
  const { state, onSelect } = renderBrowser({ ...EMPTY_BROWSE, category: "MATERIAL", group: "MATERIAL:POTATO" });

  fireEvent.click(screen.getByRole("button", { name: /작은 감자/ }));

  expect(onSelect).toHaveBeenCalledWith("inst-POTATO_M2");
  expect(browseMarketItems(catalog, state.browse).map(item => item.itemId)).toEqual(["POTATO_M2"]);
  /* 줄을 누른 것은 하나를 파고드는 일이다. 값을 한 줄로 접지 않는다. */
  expect(browseShowsCheapestOnly(state.browse)).toBe(false);
});

it("compares the checked items at their cheapest, several at a time", () => {
  const { state } = renderBrowser({ ...EMPTY_BROWSE, category: "MATERIAL", group: "MATERIAL:POTATO" });

  fireEvent.click(screen.getByLabelText(/감자 조각 F등급 최저가 견주기/));
  fireEvent.click(screen.getByLabelText(/작은 감자 D등급 최저가 견주기/));

  expect(browseMarketItems(catalog, state.browse).map(item => item.itemId)).toEqual(["POTATO_M1", "POTATO_M2"]);
  expect(browseShowsCheapestOnly(state.browse)).toBe(true);

  /* 마지막 하나까지 빼면 견주기를 그만두고 계열 전체로 돌아간다. */
  fireEvent.click(screen.getByLabelText(/감자 조각 F등급 최저가 견주기/));
  fireEvent.click(screen.getByLabelText(/작은 감자 D등급 최저가 견주기/));
  expect(browseMarketItems(catalog, state.browse).map(item => item.itemId)).toEqual(["POTATO_M1", "POTATO_M2", "POTATO_M3"]);
});

it("moves the trade panel onto whatever was just checked, and off whatever was unchecked", () => {
  const { onSelect } = renderBrowser({
    ...EMPTY_BROWSE, category: "MATERIAL", group: "MATERIAL:POTATO",
    pick: { kind: "compare", ids: ["inst-POTATO_M1", "inst-POTATO_M2"] },
  });

  /* 거래 칸이 잡고 있는 감자 조각을 빼면, 남은 것 가운데 마지막으로 옮겨 간다. */
  fireEvent.click(screen.getByLabelText(/감자 조각 F등급 최저가 견주기/));

  expect(onSelect).toHaveBeenCalledWith("inst-POTATO_M2");
});

it("searches across every category without asking which one to look in", () => {
  const { state } = renderBrowser();

  fireEvent.change(screen.getByLabelText("품목 검색"), { target: { value: "감자" } });

  expect(rowNames()).toEqual(["감자 조각", "작은 감자", "감자"]);
  expect(browseMarketItems(catalog, state.browse)).toHaveLength(3);
});

it("holds the recent shortcuts' space open before anything has been picked", () => {
  /* 하나씩 쌓일 때마다 칸이 자라면 위 목록이 밀려 올라가, 누르려던 줄이 손끝에서 달아난다. */
  renderBrowser(EMPTY_BROWSE, []);

  const recent = document.querySelector(".market-browser-recent")!;
  expect(recent).toBeTruthy();
  expect(within(recent as HTMLElement).getByRole("heading", { name: "최근 본 아이템" })).toBeTruthy();
  expect(recent.querySelector(".market-browser-recent-empty")).toBeTruthy();
  expect(recent.querySelectorAll("li")).toHaveLength(0);
});

it("keeps the recent shortcuts free of checkboxes — they are a way back, not a comparison", () => {
  renderBrowser(EMPTY_BROWSE, [catalog[3]]);

  const recent = document.querySelector(".market-browser-recent")!;
  expect(within(recent as HTMLElement).getByRole("button").textContent).toContain("옥수수 알갱이");
  expect(recent.querySelector("input[type=checkbox]")).toBeNull();
});

it("lands a recent shortcut back where that item lives", () => {
  const { state, onSelect } = renderBrowser(EMPTY_BROWSE, [catalog[3]]);

  fireEvent.click(within(document.querySelector(".market-browser-recent") as HTMLElement).getByRole("button"));

  expect(onSelect).toHaveBeenCalledWith("inst-CORN_M1");
  expect(state.browse).toEqual({ category: "MATERIAL", group: "MATERIAL:CORN", pick: { kind: "one", id: "inst-CORN_M1" }, query: "" });
});
