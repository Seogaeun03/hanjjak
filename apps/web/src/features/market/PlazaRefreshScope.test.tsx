// @vitest-environment happy-dom
/*
 * 거래 하나가 거래소 전체를 다시 읽던 것을 잡아 둔다.
 *
 * 예전에는 무슨 일을 하든 열한 갈래의 조회를 통째로 낡은 것으로 표시했다. 간단 목록이
 * 펼쳐져 있으면 품목마다 주문장이 하나씩 걸려 있으므로, 감자 한 조각을 파는 일이 서른 번
 * 가까운 요청이 됐다. 값이 움직인 자리만 다시 읽는지 요청 수로 확인한다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketPlaza } from "./MarketPlaza";
import { MARKET_UI_STORAGE_KEY } from "./marketUiState";

const server = vi.hoisted(() => ({
  bookCalls: {} as Record<string, number>,
  mailCalls: 0,
  tradeCalls: 0,
  /** 취소 뒤의 내 주문 다시 읽기를 붙잡아 둔다. 응답과 다시 읽기의 선후를 가른다. */
  holdOrderRefetch: false,
  orderCalls: 0,
  activeOrders: [] as unknown[],
  cancelOrder: undefined as undefined | (() => Promise<unknown>),
}));

vi.mock("./api", () => {
  const instrument = (id: string, itemId: string, name: string) => ({
    instrumentId: id, canonicalKey: `material:${itemId}`, itemId, displayName: name,
    category: "MATERIAL", attributes: {}, status: "ACTIVE",
    bestBidUnitPrice: 50, bestAskUnitPrice: 52, lastTradeUnitPrice: 51, marketRevision: 1,
  });
  const page = { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 };
  return {
    marketApi: {
      instruments: async () => [instrument("potato-1", "POTATO_M1", "감자 한 조각"), instrument("potato-2", "SWEET_M1", "고구마 한 조각"), instrument("potato-3", "CORN_M1", "옥수수 한 조각")],
      orderBook: async (instrumentId: string) => {
        server.bookCalls[instrumentId] = (server.bookCalls[instrumentId] ?? 0) + 1;
        return { instrumentId, marketRevision: 1, bids: [], asks: [{ unitPrice: 52, totalQuantity: 10, cumulativeQuantity: 10, myQuantity: 0 }], bestBidUnitPrice: 50, bestAskUnitPrice: 52, spread: 2, recentTrades: [] };
      },
      quote: async () => ({
        instrumentId: "potato-1", side: "SELL", timeInForce: "GTC", requestedQuantity: 1, limitUnitPrice: 52,
        expectedFilledQuantity: 0, expectedRemainingQuantity: 1, lowestFilledUnitPrice: null, highestFilledUnitPrice: null,
        weightedAverageUnitPrice: null, totalPrice: 0, expectedFee: 0, expectedSettlementAmount: 0,
        availableRice: 100_000, availableQuantity: 50, marketRevision: 1,
      }),
      /* 걸어 두기만 한 판매다. 체결된 것이 없으니 받을 쌀도 체결 내역도 움직이지 않는다. */
      createOrder: async () => ({ commandId: "c1", idempotencyKey: "k1", status: "SUCCEEDED", result: { side: "SELL", filledQuantity: 0, instrumentId: "potato-1" } }),
      cancelOrder: () => server.cancelOrder!(),
      orders: async (scope: string) => {
        if (scope !== "ACTIVE") return { ...page, items: [] };
        server.orderCalls += 1;
        if (server.orderCalls > 1 && server.holdOrderRefetch) return new Promise(() => {});
        return { ...page, items: server.activeOrders };
      },
      deliveries: async () => page,
      settlementMails: async () => { server.mailCalls += 1; return page; },
      trades: async () => { server.tradeCalls += 1; return page; },
      summary: async () => ({ activeOrders: 0, closedOrders: 0, recoveryReviewOrders: 0, claimableDeliveries: 0, claimableSettlements: 0, unread: [] }),
      changeState: async () => ({ accountStateVersion: 1, instruments: [], unread: [] }),
      markRead: async () => ({}),
      updateOrder: async () => ({}),
      claimDelivery: async () => ({}),
      claimAllDeliveries: async () => ({}),
      claimSettlement: async () => ({}),
      claimAllSettlements: async () => ({}),
    },
  };
});

beforeEach(() => {
  server.bookCalls = {};
  server.mailCalls = 0;
  server.tradeCalls = 0;
  server.orderCalls = 0;
  server.holdOrderRefetch = false;
  server.activeOrders = [];
  server.cancelOrder = async () => ({ commandId: "c2", idempotencyKey: "k2", status: "SUCCEEDED", result: {} });
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { account: { rice: 100_000 }, availableQuantity: 50, gems: [] } }),
  })) as unknown as typeof fetch;
  window.sessionStorage.setItem(MARKET_UI_STORAGE_KEY, JSON.stringify({ boardView: "list" }));
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function openSellScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(<QueryClientProvider client={client}><MarketPlaza initialMode="sell" pollingEnabled={false} /></QueryClientProvider>);
}

it("판매 등록은 판 품목만 다시 읽는다", async () => {
  openSellScreen();
  /* 간단 목록이 품목마다 주문장을 한 번씩 물어본 뒤부터 센다. */
  await waitFor(() => expect(Object.keys(server.bookCalls).length).toBe(3));
  const before: Record<string, number> = { ...server.bookCalls, mails: server.mailCalls, trades: server.tradeCalls };

  const cta = await screen.findByRole("button", { name: /판매하기/ });
  await waitFor(() => expect(cta.hasAttribute("disabled")).toBe(false));
  fireEvent.click(cta);

  await waitFor(() => expect(server.bookCalls["potato-1"]).toBe(before["potato-1"] + 1));
  /* 옆 품목의 주문장은 내가 판 것과 아무 상관이 없다. */
  expect(server.bookCalls["potato-2"]).toBe(before["potato-2"]);
  expect(server.bookCalls["potato-3"]).toBe(before["potato-3"]);
  /* 체결된 것이 없으니 받을 쌀과 체결 내역도 그대로다. */
  expect(server.mailCalls).toBe(before.mails);
  expect(server.tradeCalls).toBe(before.trades);
});

it("주문 취소는 화면을 바로 돌려주되 그 줄은 다시 눌리지 않는다", async () => {
  server.activeOrders = [{
    orderId: "order-1", instrumentId: "potato-1", itemId: "POTATO_M1", displayName: "감자 한 조각",
    side: "SELL", timeInForce: "GTC", initialQuantity: 3, filledQuantity: 0, remainingQuantity: 3,
    limitUnitPrice: 52, reservedRice: 0, status: "ACTIVE", priorityAt: "2026-09-17T00:00:00Z",
    createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", expiresAt: null,
  }];
  server.holdOrderRefetch = true;
  let answer: (() => void) | undefined;
  server.cancelOrder = () => new Promise(resolve => { answer = () => resolve({ commandId: "c2", idempotencyKey: "k2", status: "SUCCEEDED", result: {} }); });
  openSellScreen();

  fireEvent.click(await screen.findByRole("button", { name: /내 거래/ }));
  const cancelRow = await screen.findByRole("button", { name: "취소" });
  fireEvent.click(cancelRow);

  const tradeTab = () => screen.getByRole("button", { name: /거래하기/ });
  /* 서버가 답하기 전까지는 잠긴다. 여기까지는 예전과 같다. */
  await waitFor(() => expect(tradeTab().hasAttribute("disabled")).toBe(true));

  answer!();
  /* 취소는 끝났다. 내 주문 다시 읽기가 아직 돌아오지 않아도 다른 칸은 풀려야 한다. */
  await waitFor(() => expect(tradeTab().hasAttribute("disabled")).toBe(false));
  /* 사라질 줄만은 잠가 둔다. 한 번 더 눌러 봐야 없는 주문을 취소하려 들 뿐이다. */
  expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "수정" }).hasAttribute("disabled")).toBe(true);
});
