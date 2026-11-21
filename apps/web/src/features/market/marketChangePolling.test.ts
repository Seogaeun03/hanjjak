import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { MarketChangeState, MarketUnreadStream } from "./api";
import { diffMarketChangeState, refreshChangedMarketQueries } from "./marketChangePolling";

const streams: MarketUnreadStream[] = ["FILLS", "DELIVERIES", "SETTLEMENTS", "EXPIRATIONS"];

function state({ account = 10, market = 4, fill = 2, delivery = 1, settlement = 0, expiration = 0 } = {}): MarketChangeState {
  const latest: Record<MarketUnreadStream, number> = { FILLS: fill, DELIVERIES: delivery, SETTLEMENTS: settlement, EXPIRATIONS: expiration };
  return {
    accountStateVersion: account,
    instruments: [{ instrumentId: "instrument-1", marketRevision: market }],
    unread: streams.map((stream) => ({ stream, latestSequence: latest[stream], readSequence: 0, unreadCount: latest[stream] })),
  };
}

describe("market change polling", () => {
  it("does nothing when the compact versions have not changed", () => {
    expect(diffMarketChangeState(state(), state())).toEqual({
      stale: false,
      accountChanged: false,
      changedInstrumentIds: [],
      changedStreams: [],
    });
  });

  it("identifies only the account, instrument, and personal streams that changed", () => {
    expect(diffMarketChangeState(state(), state({ account: 11, market: 5, fill: 3 }))).toEqual({
      stale: false,
      accountChanged: true,
      changedInstrumentIds: ["instrument-1"],
      changedStreams: ["FILLS"],
    });
  });

  it("rejects a late response with lower versions", () => {
    expect(diffMarketChangeState(state(), state({ account: 9, market: 3, fill: 1 })).stale).toBe(true);
  });

  it("refreshes market data without touching unrelated inbox queries", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    await refreshChangedMarketQueries(client, {
      stale: false,
      accountChanged: false,
      changedInstrumentIds: ["instrument-1"],
      changedStreams: [],
    });

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual([
      ["market-instruments"],
      ["market-order-book", "instrument-1"],
      ["market-price-levels", "instrument-1"],
      ["market-order-quote", "instrument-1"],
      ["market-candles", "instrument-1"],
    ]);
    expect(keys).not.toContainEqual(["market-deliveries"]);
    expect(keys).not.toContainEqual(["market-mails"]);
  });

  it("refreshes only delivery and summary data for a delivery notification", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    await refreshChangedMarketQueries(client, {
      stale: false,
      accountChanged: false,
      changedInstrumentIds: [],
      changedStreams: ["DELIVERIES"],
    });

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["market-deliveries"],
      ["market-summary"],
    ]);
  });
});
