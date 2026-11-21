import { describe, expect, it, vi } from "vitest";
import { adminGameAuthApi, authApi } from "./api";
import { fetchEventLifecycle } from "./eventLifecycleApi";

describe("authApi", () => {
  it("requests the current session with credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { authenticated: false, account: null, administrator: false } }), { status: 200 }));

    await expect(authApi.session()).resolves.toEqual({ authenticated: false, account: null, administrator: false });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/session", { credentials: "include", headers: { Accept: "application/json" } });
    fetchMock.mockRestore();
  });

  it("checks administrator game session independently from lifecycle state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { administrator: true } }), { status: 200 }));

    await expect(adminGameAuthApi.session()).resolves.toEqual({ administrator: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/v1/auth/game/session", { credentials: "include", headers: { Accept: "application/json" } });
    fetchMock.mockRestore();
  });

  it("reports whether email login is enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { emailEnabled: false } }), { status: 200 }));

    await expect(authApi.methods()).resolves.toEqual({ emailEnabled: false });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/methods", { credentials: "include", headers: { Accept: "application/json" } });
    fetchMock.mockRestore();
  });

  it("sends signup credentials as an idempotent command", async () => {
    const account = { accountId: "account", characterId: "character", email: "player@example.com", nickname: "한짝", level: 1, experience: 0, rice: 0 };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: account }), { status: 200 }));

    await expect(authApi.signup({ email: "player@example.com", password: "password123", nickname: "한짝" })).resolves.toEqual(account);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ email: "player@example.com", password: "password123", nickname: "한짝" }) });
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/i);
    fetchMock.mockRestore();
  });

  it("requests a password reset without an idempotency header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { accepted: true } }), { status: 200 }));

    await expect(authApi.requestPasswordReset({ email: "player@example.com" })).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/password-reset/request", {
      method: "POST",
      credentials: "include",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "player@example.com" }),
    });
    fetchMock.mockRestore();
  });

  it("confirms a password reset with token and new password", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { accepted: true } }), { status: 200 }));

    await expect(authApi.confirmPasswordReset({ token: "one-time-token", password: "new-password" })).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/password-reset/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: "one-time-token", password: "new-password" }),
    });
    fetchMock.mockRestore();
  });

  it("updates nickname as an idempotent command", async () => {
    const account = { accountId: "account", characterId: "character", email: "player@example.com", nickname: "새한짝", level: 1, experience: 0, rice: 0 };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: account }), { status: 200 }));

    await expect(authApi.updateNickname({ nickname: "새한짝" })).resolves.toEqual(account);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ nickname: "새한짝" }) });
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/i);
    fetchMock.mockRestore();
  });

  it("checks nickname availability with a trimmed encoded query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { available: false } }), { status: 200 }));

    await expect(authApi.nicknameAvailability(" 이미 사용 ")).resolves.toEqual({ available: false });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/nickname-availability?nickname=%EC%9D%B4%EB%AF%B8%20%EC%82%AC%EC%9A%A9", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    fetchMock.mockRestore();
  });

  it("changes password as an idempotent command", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: { authenticated: false, account: null, administrator: false } }), { status: 200 }));
    const request = { currentPassword: "password123", newPassword: "new-password456", newPasswordConfirmation: "new-password456" };

    await expect(authApi.changePassword(request)).resolves.toEqual({ authenticated: false, account: null, administrator: false });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/profile/password");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify(request) });
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/i);
    fetchMock.mockRestore();
  });

  it("throws the server error code for login failures", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ code: "LOGIN_FAILED" }), { status: 422 }));

    await expect(authApi.login({ email: "player@example.com", password: "wrong-password" })).rejects.toThrow("LOGIN_FAILED");
    fetchMock.mockRestore();
  });

  it("preserves the HTTP status for unavailable deployment responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }));

    await expect(authApi.session()).rejects.toMatchObject({ status: 502 });
    fetchMock.mockRestore();
  });

  it("lists provider availability and starts configured social login with PKCE server flow", async () => {
    const providers = [{ id: "google", displayName: "Google", enabled: true }, { id: "naver", displayName: "Naver", enabled: false }];
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: providers }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=server" } }), { status: 200 }));

    await expect(authApi.socialProviders()).resolves.toEqual(providers);
    await expect(authApi.beginSocial("google")).resolves.toEqual({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=server" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/social/providers");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/v1/auth/social/google/begin");
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: "{}" });
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/i);
    fetchMock.mockRestore();
  });

  it("finishes nickname confirmation and unlinks a non-last social provider", async () => {
    const account = { accountId: "account", characterId: "character", email: "player@example.com", nickname: "한짝", level: 1, experience: 0, rice: 0 };
    const connections = { passwordEnabled: true, providers: [] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: account }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: connections }), { status: 200 }));

    await expect(authApi.finishSocialSignup({ token: "pending-token", nickname: "한짝" })).resolves.toEqual(account);
    await expect(authApi.unlinkSocial("google")).resolves.toEqual(connections);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/social/signup");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/social/connections/google");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", credentials: "include" });
    fetchMock.mockRestore();
  });
});

describe("event lifecycle screen", () => {
  it("fetches the public lifecycle state without authentication", async () => {
    const state = { serviceId: "event-2026-09", enabled: true, phase: "PRE_START", startsAt: null, endsAt: null, noticeEndsAt: null, dailyRestrictionEnabled: false, dailyRestrictionStartsAt: null, dailyRestrictionEndsAt: null, dailyRestrictionTimeZone: "Asia/Seoul", dailyRestrictionEndsOnNextDay: false, nextDailyRestrictionTransitionAt: null, version: 0, serverTime: "2026-09-21T00:00:00Z", mainServerUrl: "https://hanjjak.verte.kr", updatedAt: null, updatedByUsername: null };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ data: state }), { status: 200 }));

    await expect(fetchEventLifecycle()).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/event-lifecycle", { credentials: "include", headers: { Accept: "application/json" } });
    fetchMock.mockRestore();
  });
});
