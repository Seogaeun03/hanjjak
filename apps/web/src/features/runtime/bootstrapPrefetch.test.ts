import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discardPrefetchedRuntimeState, fetchRuntimeState, prefetchRuntimeState } from "./api";
import { configureBootstrapQueryDefaults, prefetchAuthenticatedBootstrap } from "./bootstrapPrefetch";

const snapshot = (accountId: string) => ({
  accountId,
  stateVersion: 1,
  contentVersion: "v1",
  currentStageId: "stage.04-01",
  idleMode: "AUTO_PROGRESS",
  repeatStageId: null,
  maxHp: 100,
});

function ok(body: unknown) {
  return new Response(JSON.stringify({ data: body }), { status: 200 });
}

function requestedPaths(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

afterEach(() => {
  discardPrefetchedRuntimeState();
  vi.restoreAllMocks();
});

describe("runtime-state prefetch", () => {
  it("hands the prefetched response to the first connection only", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(snapshot("prefetched")))
      .mockResolvedValueOnce(ok(snapshot("fresh")));

    prefetchRuntimeState(1_000);
    await expect(fetchRuntimeState(2_000)).resolves.toMatchObject({ accountId: "prefetched" });
    await expect(fetchRuntimeState(3_000)).resolves.toMatchObject({ accountId: "fresh" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches when the prefetched response is too old", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(snapshot("stale")))
      .mockResolvedValueOnce(ok(snapshot("fresh")));

    prefetchRuntimeState(0);
    await expect(fetchRuntimeState(10_001)).resolves.toMatchObject({ accountId: "fresh" });
  });

  it("refetches instead of failing when the prefetch was rejected", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "MATERIAL_PREFERENCE_REQUIRED" }), { status: 409 }))
      .mockResolvedValueOnce(ok(snapshot("fresh")));

    prefetchRuntimeState(0);
    await expect(fetchRuntimeState(500)).resolves.toMatchObject({ accountId: "fresh" });
  });

  it("drops a prefetched response on logout or account switch", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(snapshot("previous-account")))
      .mockResolvedValueOnce(ok(snapshot("next-account")));

    prefetchRuntimeState(0);
    discardPrefetchedRuntimeState();
    await expect(fetchRuntimeState(100)).resolves.toMatchObject({ accountId: "next-account" });
  });
});

describe("authenticated bootstrap prefetch", () => {
  it("requests the gate and battle inputs together and reuses them on mount", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith("/material-preference")) return ok({ selected: true, primaryMaterialType: "POTATO", options: [], populationCounts: {} });
      if (path.endsWith("/stages")) return ok([]);
      return ok(snapshot("account"));
    });
    const client = new QueryClient();
    configureBootstrapQueryDefaults(client);

    prefetchAuthenticatedBootstrap(client);

    expect(requestedPaths(fetchMock)).toEqual(["/api/v1/material-preference", "/api/v1/stages", "/api/v1/runtime-state"]);
    await vi.waitFor(() => expect(client.getQueryData(["stages"])).toEqual([]));
    expect(client.getQueryState(["material-preference"])?.status).toBe("success");
    expect(client.getQueryCache().find({ queryKey: ["stages"] })?.isStaleByTime(client.defaultQueryOptions({ queryKey: ["stages"] }).staleTime as number)).toBe(false);
  });

  it("keeps the shared session fresh long enough for late subscribers", () => {
    const client = new QueryClient();
    configureBootstrapQueryDefaults(client);

    expect(client.defaultQueryOptions({ queryKey: ["auth", "session"] }).staleTime).toBe(5_000);
    expect(client.defaultQueryOptions({ queryKey: ["material-preference"] }).staleTime).toBe(30_000);
    expect(client.defaultQueryOptions({ queryKey: ["stages"] }).staleTime).toBe(60_000);
  });
});
