import { afterEach, expect, it, vi } from "vitest";
import { marketApi } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("scopes settlement listing and claim-all commands to market settlement mail", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ data: { items: [], nextCursor: null, totalItems: 0 } }),
  }));
  vi.stubGlobal("fetch", fetch);

  await marketApi.settlementMails();
  await marketApi.claimAllSettlements();

  expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/mails?claimable=true&type=MARKET_SETTLEMENT");
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/v1/mails/claim-all?type=MARKET_SETTLEMENT");
});
