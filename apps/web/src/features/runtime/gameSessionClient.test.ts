import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameSessionClient } from "./gameSessionClient";

const activeSession = { gameSessionId: "session-1", status: "ACTIVE", heartbeatIntervalSeconds: 30, expiresAfterSeconds: 90 } as const;

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>();
  if (initial) values.set("hanjjak.game-session", initial);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("game session client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens once and sends heartbeat for the active session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));
    const client = new GameSessionClient(memoryStorage());

    await expect(client.open("account-1")).resolves.toEqual(activeSession);
    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/game-sessions/session-1/heartbeat");
    client.suspend();
  });

  it("sends an immediate heartbeat when the active tab requests revalidation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));
    const client = new GameSessionClient(memoryStorage());

    await client.open("account-1");
    await expect(client.heartbeatNow()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/game-sessions/session-1/heartbeat");
    client.suspend();
  });

  it("resumes the stored tab session after refresh without opening a replacement", async () => {
    const storage = memoryStorage(JSON.stringify({ accountId: "account-1", session: activeSession }));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));

    const client = new GameSessionClient(storage);
    await expect(client.open("account-1")).resolves.toEqual(activeSession);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/game-sessions/session-1/heartbeat");
    client.suspend();
  });

  it("opens a replacement only after the stored session is rejected as inactive", async () => {
    const storage = memoryStorage(JSON.stringify({ accountId: "account-1", session: activeSession }));
    const replacement = { ...activeSession, gameSessionId: "session-2" };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "GAME_SESSION_NOT_ACTIVE" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: replacement }), { status: 200 }));

    const client = new GameSessionClient(storage);
    await expect(client.open("account-1")).resolves.toEqual(replacement);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/game-sessions/session-1/heartbeat",
      "/api/v1/game-sessions",
    ]);
    client.suspend();
  });

  it("does not replace a stored session when resume fails from the network", async () => {
    const storage = memoryStorage(JSON.stringify({ accountId: "account-1", session: activeSession }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network lost"));

    const client = new GameSessionClient(storage);
    await expect(client.open("account-1")).rejects.toThrow("network lost");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(storage.getItem("hanjjak.game-session")).not.toBeNull();
  });

  it("recovers a heartbeat that failed once from the network without losing the session", async () => {
    const storage = memoryStorage();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));
    const lost = vi.fn();
    const client = new GameSessionClient(storage);
    client.setSessionLostHandler(lost);

    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lost).not.toHaveBeenCalled();
    expect(storage.getItem("hanjjak.game-session")).not.toBeNull();
    client.suspend();
  });

  it("retries a heartbeat with the same idempotency key so a replay is not counted twice", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "UPSTREAM" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));
    const client = new GameSessionClient(memoryStorage());

    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(31_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const keyOf = (call: number) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers).get("Idempotency-Key");
    expect(keyOf(2)).toBe(keyOf(1));
    expect(keyOf(1)).not.toBe(keyOf(0));
    client.suspend();
  });

  it("gives up only after the bounded retry budget is spent", async () => {
    const storage = memoryStorage();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockRejectedValue(new TypeError("network lost"));
    const lost = vi.fn();
    const client = new GameSessionClient(storage);
    client.setSessionLostHandler(lost);

    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(11_000);

    // 30초 주기의 첫 시도와 1·3·7초 뒤 세 번의 재시도까지 쓰고 나서야 끊긴 것으로 본다.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(lost).toHaveBeenCalledOnce();
    expect(storage.getItem("hanjjak.game-session")).not.toBeNull();
  });

  it("lets battle transport failure enter the normal session recovery path", async () => {
    const lost = vi.fn();
    const client = new GameSessionClient(memoryStorage());
    client.setSessionLostHandler(lost);

    client.reportConnectionLost();

    expect(lost).toHaveBeenCalledOnce();
  });

  it("does not start a second heartbeat while the previous one is still in flight", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockImplementation(() => new Promise<Response>(() => undefined));
    const client = new GameSessionClient(memoryStorage());

    await client.open("account-1");
    // 응답이 오지 않는 박동 하나가 떠 있는 동안 주기 신호가 세 번 더 와도 명령은 겹치지 않는다.
    await vi.advanceTimersByTimeAsync(90_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.suspend();
  });

  it("does not restore a session after invalidation cancels an in-flight open", async () => {
    const storage = memoryStorage();
    let completeOpen: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => { completeOpen = resolve; }));
    const client = new GameSessionClient(storage);

    const opening = client.open("account-1");
    client.invalidate();
    completeOpen?.(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));

    await expect(opening).rejects.toThrow("GAME_SESSION_OPEN_CANCELLED");
    expect(storage.getItem("hanjjak.game-session")).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("starts a new account open after invalidation while the old request is pending", async () => {
    const storage = memoryStorage();
    let completeOld: ((response: Response) => void) | undefined;
    const accountTwoSession = { ...activeSession, gameSessionId: "session-2" };
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { completeOld = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: accountTwoSession }), { status: 200 }));
    const client = new GameSessionClient(storage);

    const oldOpening = client.open("account-1");
    client.invalidate();
    await expect(client.open("account-2")).resolves.toEqual(accountTwoSession);
    completeOld?.(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));

    await expect(oldOpening).rejects.toThrow("GAME_SESSION_OPEN_CANCELLED");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(storage.getItem("hanjjak.game-session")).toContain("account-2");
    client.suspend();
  });

  it("ignores a stale heartbeat failure after the same session reconnects", async () => {
    const storage = memoryStorage();
    let failOldHeartbeat: ((reason: unknown) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((_, reject) => { failOldHeartbeat = reject; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }));
    const lost = vi.fn();
    const client = new GameSessionClient(storage);
    client.setSessionLostHandler(lost);

    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(30_000);
    client.suspend();
    await client.open("account-1");
    failOldHeartbeat?.(new TypeError("old network loss"));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lost).not.toHaveBeenCalled();
    expect(storage.getItem("hanjjak.game-session")).not.toBeNull();
    client.suspend();
  });

  it("ignores a stale resume rejection after another account opens", async () => {
    const storage = memoryStorage(JSON.stringify({ accountId: "account-1", session: activeSession }));
    let rejectOldResume: ((response: Response) => void) | undefined;
    const accountTwoSession = { ...activeSession, gameSessionId: "session-2" };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { rejectOldResume = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: accountTwoSession }), { status: 200 }));
    const client = new GameSessionClient(storage);

    const oldOpening = client.open("account-1");
    client.invalidate();
    await client.open("account-2");
    rejectOldResume?.(new Response(JSON.stringify({ code: "GAME_SESSION_NOT_ACTIVE" }), { status: 409 }));

    await expect(oldOpening).rejects.toThrow("GAME_SESSION_OPEN_CANCELLED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storage.getItem("hanjjak.game-session")).toContain("account-2");
    client.suspend();
  });

  it("does not retry a heartbeat the server refused as inactive", async () => {
    const storage = memoryStorage();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "GAME_SESSION_NOT_ACTIVE" }), { status: 409 }));
    const lost = vi.fn();
    const client = new GameSessionClient(storage);
    client.setSessionLostHandler(lost);

    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(41_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledOnce();
    expect(storage.getItem("hanjjak.game-session")).toBeNull();
  });

  it("invalidates the session when heartbeat loses authority", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSession }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "GAME_SESSION_NOT_ACTIVE" }), { status: 409 }));
    const lost = vi.fn();
    const client = new GameSessionClient(memoryStorage());
    client.setSessionLostHandler(lost);

    await client.open("account-1");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledOnce();
    client.suspend();
  });
});
