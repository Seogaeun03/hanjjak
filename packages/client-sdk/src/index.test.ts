import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index";

describe("admin client", () => {
  it("uses credentialed admin paths and unwraps envelopes", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { authenticated: false, operator: null } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ baseUrl: "https://admin.example.com/", fetch: request });

    await expect(client.admin.session()).resolves.toEqual({ authenticated: false, operator: null });
    expect(request).toHaveBeenCalledWith("https://admin.example.com/api/admin/v1/auth/session", expect.objectContaining({ credentials: "include" }));
  });

  it("begins GitLab OAuth without sending credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { authorizationUrl: "https://gitlab.example.com/oauth/authorize?state=server" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await expect(client.admin.beginGitlab()).resolves.toEqual({ authorizationUrl: "https://gitlab.example.com/oauth/authorize?state=server" });
    expect(request).toHaveBeenCalledWith("/api/admin/v1/auth/gitlab/begin", expect.objectContaining({ method: "POST", credentials: "include" }));
  });
  it("checks local login availability and submits same-origin credentials as JSON", async () => {
    const operator = { operatorId: "operator-1", username: "local-admin", displayName: "Local admin", roles: ["ADMIN"], permissions: ["cosmetic-showcase:manage"] };
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { enabled: true } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { authenticated: true, operator } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await expect(client.admin.localAvailability()).resolves.toEqual({ enabled: true });
    await expect(client.admin.loginLocal("local-admin", "secret-value"))
      .resolves.toEqual({ authenticated: true, operator });

    expect(request.mock.calls[0]?.[0]).toBe("/api/admin/v1/auth/local/availability");
    expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ credentials: "include" }));
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty("method");
    expect(request.mock.calls[1]?.[0]).toBe("/api/admin/v1/auth/local/login");
    expect(request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      mode: "same-origin",
      credentials: "include",
      headers: expect.objectContaining({ Accept: "application/json", "Content-Type": "application/json" }),
      body: JSON.stringify({ username: "local-admin", password: "secret-value" }),
    }));
  });

  it("checks the administrator game session separately from the console session", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { administrator: true } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await expect(client.admin.gameSession()).resolves.toEqual({ administrator: true });
    expect(request).toHaveBeenCalledWith("/api/admin/v1/auth/game/session", expect.objectContaining({ credentials: "include" }));
  });

  it("preserves server error codes for the console", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: "ADMIN_PERMISSION_DENIED", retryable: false }), { status: 403, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await expect(client.admin.dashboard()).rejects.toMatchObject({ status: 403, code: "ADMIN_PERMISSION_DENIED", retryable: false });
  });

  it("sends market mutations with independent idempotency keys", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { itemId: "POTATO_M1", totalQuantity: 10000, unitPrice: 100, orderIds: [], marketRevision: 2 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await client.admin.createSystemMarketOrder("POTATO_M1", 10_000, 100, "초기 유동성 공급");

    expect(request).toHaveBeenCalledWith("/api/admin/v1/market/system-orders", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json", "Idempotency-Key": expect.any(String) }),
      body: JSON.stringify({ itemId: "POTATO_M1", quantity: 10_000, unitPrice: 100, reason: "초기 유동성 공급" }),
    }));
  });

  it("sends user mutations and audit filters with explicit contracts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { before: {}, after: {}, replayed: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await client.admin.adjustUserRice("account-1", "ADD", 500, "고객 지원 보상");
    await client.admin.audit(200, { operatorId: "operator-1", action: "ADJUST_USER_RICE", mutationsOnly: true });

    expect(request.mock.calls[0]?.[0]).toBe("/api/admin/v1/accounts/account-1/management/rice");
    expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
      body: JSON.stringify({ mode: "ADD", amount: 500, reason: "고객 지원 보상" }),
    }));
    expect(request.mock.calls[1]?.[0]).toBe("/api/admin/v1/audit?limit=200&operatorId=operator-1&action=ADJUST_USER_RICE&mutationsOnly=true");
  });
  it("reads and updates global chat settings with version and idempotency data", async () => {
    const settings = { enabled: false, version: 3, updatedAt: "2026-09-30T12:00:00Z" };
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: settings }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { before: { ...settings, enabled: true }, after: settings, replayed: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createApiClient({ fetch: request });

    await expect(client.admin.chatSettings()).resolves.toEqual(settings);
    await expect(client.admin.updateChatSettings(false, 2, "운영 점검")).resolves.toEqual({ before: { ...settings, enabled: true }, after: settings, replayed: false });
    expect(request.mock.calls[0]?.[0]).toBe("/api/admin/v1/chat/settings");
    expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ credentials: "include" }));
    expect(request.mock.calls[1]?.[0]).toBe("/api/admin/v1/chat/settings");
    expect(request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
      body: JSON.stringify({ enabled: false, expectedVersion: 2, reason: "운영 점검" }),
    }));
  });
});
