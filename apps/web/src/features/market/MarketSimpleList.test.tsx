// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MarketSimpleList } from "./MarketSimpleList";
import { browseMarketItems, browseShowsCheapestOnly, EMPTY_BROWSE, type MarketBrowse } from "./marketBrowse";
import type { MarketInstrument } from "./api";

afterEach(cleanup);

function instrument(itemId: string, displayName: string, category: string, ask: number | null, bid: number | null, attributes: Record<string, string> = {}): MarketInstrument {
  return {
    instrumentId: `inst-${itemId}`, canonicalKey: itemId.toLowerCase(), itemId, displayName, category, attributes,
    status: "ACTIVE", bestBidUnitPrice: bid, bestAskUnitPrice: ask, lastTradeUnitPrice: ask, marketRevision: 1,
  };
}

const catalog = [
  instrument("POTATO_M1", "감자 조각", "MATERIAL", 52, 50),
  instrument("CORN_M2", "작은 옥수수", "MATERIAL", 12, 10),
  instrument("SWEET_POTATO_M1", "고구마 조각", "MATERIAL", null, null),
  instrument("gem:3:flat_attack", "3레벨 공격력 보석", "GEM", 1_200, 1_150, { level: "3", option: "flat_attack", value: "12" }),
];

function rows() {
  return within(document.querySelector(".market-simple-rows")!).getAllByRole("button");
}
function names() {
  return rows().map(row => row.querySelector("strong")?.textContent);
}

/** 주문장이 없는 화면은 품목이 알려 준 가장 싼 값 한 줄로 버틴다. 그 자리를 채우려면 넣어 준다. */
function ask(unitPrice: number, totalQuantity: number, myQuantity = 0) {
  return { unitPrice, totalQuantity, cumulativeQuantity: totalQuantity, myQuantity };
}

/*
 * 목록은 왼쪽 칸이 좁혀 건네준 것을 그대로 받는다. 시험도 같은 길로 좁힌다 —
 * 목록에 무엇이 서는지와 왼쪽에서 무엇을 골랐는지가 따로 놀면 시험이 화면을 못 지킨다.
 */
function renderList(
  browse: MarketBrowse = EMPTY_BROWSE,
  mine: ReadonlySet<string> = new Set(),
  books: Record<string, ReturnType<typeof ask>[]> = {},
  onSelect = vi.fn(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  for (const [instrumentId, asks] of Object.entries(books)) {
    client.setQueryData(["market-order-book", instrumentId], { instrumentId, marketRevision: 1, bids: [], asks, bestBidUnitPrice: null, bestAskUnitPrice: asks[0]?.unitPrice ?? null, spread: null, recentTrades: [] });
  }
  render(<QueryClientProvider client={client}>
    <MarketSimpleList
      items={browseMarketItems(catalog, browse)} cheapestOnly={browseShowsCheapestOnly(browse)} searching={Boolean(browse.query.trim())}
      mine={mine} selected={catalog[0]} onSelect={onSelect} toggle={<button type="button">시세 보기</button>} />
  </QueryClientProvider>);
  return onSelect;
}

const material: MarketBrowse = { ...EMPTY_BROWSE, category: "MATERIAL" };

it("shows every category at once when the picker is at the top", () => {
  renderList(EMPTY_BROWSE);

  expect(names()).toEqual(["감자 조각", "공격력", "작은 옥수수"]);
});

it("marks the rows whose listing is my own — the market will not sell them to me", () => {
  renderList(material, new Set(["inst-CORN_M2"]));

  const corn = rows().find(row => row.textContent?.includes("작은 옥수수"))!;
  const potato = rows().find(row => row.textContent?.includes("감자 조각"))!;
  expect(corn.querySelector(".market-simple-mine")?.textContent).toBe("내 매물");
  expect(potato.querySelector(".market-simple-mine")).toBeNull();
});

it("gives every listing its own row — the same item at three prices is three rows", () => {
  renderList({ ...material, pick: { kind: "one", id: "inst-POTATO_M1" } }, new Set(), {
    "inst-POTATO_M1": [ask(31, 7), ask(34, 40), ask(38, 120, 120)],
  });

  const listed = rows().map(row => [row.querySelector("strong")?.textContent, row.querySelector(".market-simple-ask")?.textContent, row.querySelector(".market-simple-stock")?.textContent]);
  expect(listed).toEqual([
    ["감자 조각", "31", "7개"],
    ["감자 조각", "34", "40개"],
    ["감자 조각", "38", "120개"],
  ]);
  /* 먼저 나가는 값은 맨 위 한 줄뿐이고, 내가 올린 매물은 그 줄에만 적힌다. */
  expect(rows().filter(row => row.classList.contains("is-cheapest"))).toHaveLength(1);
  expect(rows()[0].classList.contains("is-cheapest")).toBe(true);
  expect(rows()[2].querySelector(".market-simple-mine")?.textContent).toBe("내 매물");
  expect(rows()[0].querySelector(".market-simple-mine")).toBeNull();
});

it("keeps the compared rows to one apiece — that is what makes them comparable", () => {
  /* 체크 표시로 골라 둔 자리다. 하나가 값 스무 줄을 차지하면 견줄 것이 함께 서지 못한다. */
  renderList({ ...material, pick: { kind: "compare", ids: ["inst-POTATO_M1", "inst-CORN_M2"] } }, new Set(), {
    "inst-POTATO_M1": [ask(31, 7), ask(34, 40)],
    "inst-CORN_M2": [ask(12, 90), ask(15, 5)],
  });

  expect(rows().map(row => row.querySelector(".market-simple-ask")?.textContent)).toEqual(["31", "12"]);
  expect(names()).toEqual(["감자 조각", "작은 옥수수"]);
});

it("shows one price per row — what the item is selling for", () => {
  renderList(material);

  const row = within(document.querySelector(".market-simple-rows")!).getByRole("button", { pressed: true });
  expect(row.querySelector("strong")?.textContent).toBe("감자 조각");
  expect(row.querySelector(".market-simple-ask")?.textContent).toBe("52");
  expect(row.querySelector(".market-simple-ask img")).toBeTruthy();
  expect(row.querySelector(".market-simple-bid")).toBeNull();
});

it("picks the row the player taps so the trade panel follows along", () => {
  const onSelect = renderList(material);

  fireEvent.click(within(document.querySelector(".market-simple-rows")!).getByRole("button", { name: /작은 옥수수/ }));

  expect(onSelect).toHaveBeenCalledWith("inst-CORN_M2");
});

it("leaves out what nobody is selling — this is a list of what is actually for sale", () => {
  /* 고구마 조각은 파는 사람이 없다. 살 수 없는 줄을 보여 주면 골라 놓고 막힌다. */
  renderList(material);

  expect(names()).toEqual(["감자 조각", "작은 옥수수"]);
});

it("says why the list is empty instead of quietly widening it", () => {
  renderList({ ...material, pick: { kind: "one", id: "inst-SWEET_POTATO_M1" } });

  expect(document.querySelector(".market-simple-rows")).toBeNull();
  expect(screen.getByText("지금 이걸 파는 사람이 없어요.")).toBeTruthy();
});

it("orders by name first, and by price when asked", () => {
  renderList(material);
  expect(names()).toEqual(["감자 조각", "작은 옥수수"]);

  fireEvent.click(screen.getByRole("button", { name: "싼 값순" }));

  expect(names()).toEqual(["작은 옥수수", "감자 조각"]);
});

it("narrows to the one row the picker drilled into", () => {
  /* 왼쪽에서 계열까지 들어가면 그 계열만, 등급 하나를 고르면 그 하나만 남는다. */
  renderList({ ...material, group: "MATERIAL:POTATO" });
  expect(names()).toEqual(["감자 조각"]);

  cleanup();
  renderList({ ...material, pick: { kind: "one", id: "inst-CORN_M2" } });
  expect(names()).toEqual(["작은 옥수수"]);

  /* 체크를 여럿 해 두면 고른 만큼 나란히 본다. */
  cleanup();
  renderList({ ...material, pick: { kind: "compare", ids: ["inst-CORN_M2", "inst-POTATO_M1"] } });
  expect(names()).toEqual(["감자 조각", "작은 옥수수"]);
});

it("follows the category and search the picker on the left is holding", () => {
  renderList({ ...EMPTY_BROWSE, category: "GEM" });
  /* 레벨과 옵션 값은 오른쪽 이름표가 말해 주므로 이름에서는 뗀다. */
  expect(names()).toEqual(["공격력"]);
  expect(rows()[0].querySelector(".market-simple-tag")?.textContent).toBe("Lv.3 · +12");

  cleanup();
  renderList({ ...material, query: "옥수수" });
  expect(names()).toEqual(["작은 옥수수"]);
});
