// @vitest-environment happy-dom
/*
 * 판매 화면이 거래 응답을 받은 뒤에도 계속 잠겨 있던 문제를 잡아 둔다.
 *
 * 주문을 넣고 나면 거래소는 값·재고·주문·받을 것을 한꺼번에 다시 읽는다. 그 다시 읽기가
 * 끝날 때까지 거래 단추와 입력 칸을 잠가 두었는데, 정작 주문 응답은 이미 와 있었다.
 * 파는 사람은 다 끝난 거래를 앞에 두고 잠긴 화면을 기다렸다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketPlaza } from "./MarketPlaza";
import { MARKET_UI_STORAGE_KEY } from "./marketUiState";

/* 주문 응답과 뒤따르는 다시 읽기를 따로 쥔다. 둘을 갈라 놓아야 무엇을 기다리는지 보인다. */
const server = vi.hoisted(() => ({
  summaryCalls: 0,
  /** 주문 뒤의 요약 다시 읽기를 붙잡아 둔다. 주문 응답과 다시 읽기의 선후를 가른다. */
  holdSummaryRefetch: false,
  createOrder: undefined as undefined | (() => Promise<unknown>),
}));

vi.mock("./api", () => {
  const instrument = {
    instrumentId: "potato-1", canonicalKey: "material:potato_m1", itemId: "POTATO_M1", displayName: "감자 한 조각",
    category: "MATERIAL", attributes: {}, status: "ACTIVE",
    bestBidUnitPrice: 50, bestAskUnitPrice: 52, lastTradeUnitPrice: 51, marketRevision: 1,
  };
  const page = { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 };
  const summary = { activeOrders: 0, closedOrders: 0, recoveryReviewOrders: 0, claimableDeliveries: 0, claimableSettlements: 0, unread: [] };
  const quote = {
    instrumentId: "potato-1", side: "SELL", timeInForce: "GTC", requestedQuantity: 1, limitUnitPrice: 52,
    expectedFilledQuantity: 0, expectedRemainingQuantity: 1, lowestFilledUnitPrice: null, highestFilledUnitPrice: null,
    weightedAverageUnitPrice: null, totalPrice: 0, expectedFee: 0, expectedSettlementAmount: 0,
    availableRice: 100_000, availableQuantity: 50, marketRevision: 1,
  };
  return {
    marketApi: {
      instruments: async () => [instrument],
      orderBook: async () => ({ instrumentId: "potato-1", marketRevision: 1, bids: [], asks: [], bestBidUnitPrice: 50, bestAskUnitPrice: 52, spread: 2, recentTrades: [] }),
      quote: async () => quote,
      createOrder: () => server.createOrder!(),
      orders: async () => page,
      deliveries: async () => page,
      settlementMails: async () => page,
      trades: async () => page,
      summary: async () => {
        server.summaryCalls += 1;
        /* 첫 조회는 화면을 세우는 데 필요하다. 붙잡는 것은 주문 뒤의 다시 읽기뿐이다. */
        if (server.summaryCalls > 1 && server.holdSummaryRefetch) return new Promise(() => {});
        return summary;
      },
      changeState: async () => ({ accountStateVersion: 1, instruments: [], unread: [] }),
      markRead: async () => ({}),
      updateOrder: async () => ({}),
      cancelOrder: async () => ({}),
      claimDelivery: async () => ({}),
      claimAllDeliveries: async () => ({}),
      claimSettlement: async () => ({}),
      claimAllSettlements: async () => ({}),
    },
  };
});

beforeEach(() => {
  server.summaryCalls = 0;
  server.holdSummaryRefetch = false;
  server.createOrder = async () => ({ commandId: "c1", idempotencyKey: "k1", status: "SUCCEEDED", result: {} });
  /* 보유 쌀·재고는 거래소 계약 밖이라 그대로 흘려 준다. */
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { account: { rice: 100_000 }, availableQuantity: 50, gems: [] } }),
  })) as unknown as typeof fetch;
  /* 시세 보기라야 확인 단계를 거친다. 확인 단계의 단추가 거래 중임을 글자로 말한다. */
  window.sessionStorage.setItem(MARKET_UI_STORAGE_KEY, JSON.stringify({ boardView: "chart" }));
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function openSellScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(<QueryClientProvider client={client}><MarketPlaza initialMode="sell" pollingEnabled={false} /></QueryClientProvider>);
}

/** 확인 단계까지 간다. 값과 수량은 화면이 시세에서 채워 준다. */
async function confirmSale() {
  const cta = await screen.findByRole("button", { name: /예약 판매하기/ });
  await waitFor(() => expect(cta.hasAttribute("disabled")).toBe(false));
  fireEvent.click(cta);
  return screen.findByRole("button", { name: "이대로 거래하기" });
}

it("거래 응답이 오면 뒤따르는 다시 읽기를 기다리지 않고 화면을 돌려준다", async () => {
  server.holdSummaryRefetch = true;
  openSellScreen();

  fireEvent.click(await confirmSale());

  /* 주문은 이미 끝났다. 요약 다시 읽기가 아직 돌아오지 않아도 화면은 풀려야 한다. */
  const cta = await screen.findByRole("button", { name: /예약 판매하기/ });
  await waitFor(() => expect(cta.hasAttribute("disabled")).toBe(false));
  expect((screen.getByLabelText("거래 수량") as HTMLInputElement).disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "거래하는 중…" })).toBeNull();
});

it("거래가 오래 걸리는 동안에는 거래 중임을 알린다", async () => {
  let finish: (() => void) | undefined;
  server.createOrder = () => new Promise(resolve => { finish = () => resolve({ commandId: "c1", idempotencyKey: "k1", status: "SUCCEEDED", result: {} }); });
  openSellScreen();

  fireEvent.click(await confirmSale());

  const pending = await screen.findByRole("button", { name: "거래하는 중…" });
  expect(pending.hasAttribute("disabled")).toBe(true);

  finish!();
  await waitFor(() => expect(screen.queryByRole("button", { name: "거래하는 중…" })).toBeNull());
});

it("거래가 실패하면 까닭을 알리고 적어 둔 값을 지우지 않는다", async () => {
  server.createOrder = async () => { throw new Error("MARKET_NO_FILL"); };
  openSellScreen();

  fireEvent.click(await confirmSale());

  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("현재 가격 조건으로 체결할 주문이 없습니다.");
  /* 확인 칸은 그대로 남아 같은 값으로 다시 누를 수 있다. */
  const retry = await screen.findByRole("button", { name: "이대로 거래하기" });
  await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
  /* 칸 이름이 그대로라 감싼 label 이 −·+ 단추까지 가리킨다. 적는 칸만 집는다. */
  expect((screen.getByLabelText("예약 가격", { selector: "input" }) as HTMLInputElement).value).toBe("52");
});
