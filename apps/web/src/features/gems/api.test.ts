import { afterEach, describe, expect, it, vi } from "vitest";
import { gemDungeonsApi, gemsApi } from "./api";
import { serverNow } from "../../shared/serverClock";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("gemsApi", () => {
  it("loads gem state", async () => {
    const state = { unlocked: false, tickets: 0, secondsUntilNextTicket: 0, todayBoss: "SURVIVAL", gemBoxQuantity: 0, gems: [], presets: {}, contentVersion: "gem-v1-draft" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: state }) }));
    await expect(gemsApi.state()).resolves.toEqual(state);
    expect(fetch).toHaveBeenCalledWith("/api/v1/gems", { credentials: "include", headers: { Accept: "application/json" } });
  });

  it("opens boxes with idempotency", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000020" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { granted: [], state: {} } }) }));
    await gemsApi.openBoxes(1);
    expect(fetch).toHaveBeenCalledWith("/api/v1/gems/boxes/open", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "Idempotency-Key": "00000000-0000-4000-8000-000000000020" }), body: JSON.stringify({ quantity: 1 }) }));
  });

  it("updates any preset and executes a reviewed safe fusion", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000023" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));

    await gemsApi.updatePreset("ARMORED", ["gem-1"]);
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/gems/presets/ARMORED", expect.objectContaining({ method: "PUT", body: JSON.stringify({ gemIds: ["gem-1"] }) }));
    await gemsApi.previewFusion({ mode: "SAFE_BATCH", level: 2, selections: [{ option: "FLAT_ATTACK", quantity: 6 }] });

    expect(fetch).toHaveBeenLastCalledWith("/api/v1/gem-fusions/preview", expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "SAFE_BATCH", level: 2, selections: [{ option: "FLAT_ATTACK", quantity: 6 }] }) }));

    await gemsApi.fuse("SAFE_BATCH", ["gem-1", "gem-2", "gem-3"]);
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/gem-fusions", expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "SAFE_BATCH", gemIds: ["gem-1", "gem-2", "gem-3"] }) }));
  });

  it("starts a lifecycle dungeon challenge with idempotency", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000021" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { challengeId: "challenge-1" } }) }));
    await gemDungeonsApi.start();
    expect(fetch).toHaveBeenCalledWith("/api/v1/gem-dungeons/challenges", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "00000000-0000-4000-8000-000000000021" }),
      body: JSON.stringify({}),
    }));
  });

  it("requests a selected boss for an authorized test account", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000022" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { challengeId: "challenge-2", boss: "BERSERK" } }) }));
    await gemDungeonsApi.today("BERSERK");
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/gem-dungeons/today?boss=BERSERK", expect.objectContaining({ credentials: "include" }));
    await gemDungeonsApi.start("BERSERK");
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/gem-dungeons/challenges", expect.objectContaining({ body: JSON.stringify({ boss: "BERSERK" }) }));
  });
});

/* 던전 보상 창은 서버 시각으로만 열린다. 화면이 브라우저 시계로 그 창을 재면 일찍 눌러
   거절당하거나 늦게 눌러 창을 놓치고, 어느 쪽이든 보상과 입장권이 함께 사라진다. */
describe("서버 시계 보정", () => {
  const BROWSER_NOW = Date.UTC(2026, 8, 22, 3, 0, 0);

  it("성공 응답의 serverTime 으로 오차를 잰다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BROWSER_NOW);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ serverTime: new Date(BROWSER_NOW - 20_000).toISOString(), data: {} }),
    }));

    await gemsApi.state();

    expect(serverNow()).toBe(BROWSER_NOW - 20_000);
  });

  it("거절당한 응답으로도 오차를 잰다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BROWSER_NOW);
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000024" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ serverTime: new Date(BROWSER_NOW - 8_000).toISOString(), code: "GEM_DUNGEON_COMPLETE_TOO_EARLY" }),
    }));

    await expect(gemDungeonsApi.complete("challenge-1")).rejects.toThrow("GEM_DUNGEON_COMPLETE_TOO_EARLY");
    expect(serverNow()).toBe(BROWSER_NOW - 8_000);
  });
});
