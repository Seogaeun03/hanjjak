// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";
import { adminGameAuthApi, authApi } from "./api";

vi.mock("../runtime/bootstrapPrefetch", () => ({
  discardAuthenticatedBootstrap: vi.fn(),
  prefetchAuthenticatedBootstrap: vi.fn(),
}));

vi.mock("../runtime/gameSessionClient", () => ({
  gameSessionClient: { invalidate: vi.fn() },
}));

vi.mock("../battle/runtimeStore", () => ({
  useBattleRuntimeStore: (selector: (state: { reset: () => void }) => unknown) => selector({ reset: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderLogin(emailEnabled: boolean) {
  vi.spyOn(authApi, "methods").mockResolvedValue({ emailEnabled });
  vi.spyOn(authApi, "socialProviders").mockResolvedValue([{ id: "ssafy-gitlab", displayName: "SSAFY GitLab", enabled: true }]);
  vi.spyOn(authApi, "session").mockResolvedValue({ authenticated: false, account: null, administrator: false });
  vi.spyOn(adminGameAuthApi, "session").mockResolvedValue({ administrator: false });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {
    serviceId: "game-1",
    enabled: false,
    phase: "RUNNING",
  } }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AuthGate><div>game</div></AuthGate></QueryClientProvider>);
  await screen.findByRole("button", { name: "SSAFY GitLab 로그인" });
}

it("hides the email login entry point when email login is disabled", async () => {
  await renderLogin(false);

  expect(screen.queryByRole("button", { name: "이메일 로그인" })).toBeNull();
  expect(screen.queryByText("또는")).toBeNull();
  expect(screen.getByRole("button", { name: "SSAFY GitLab 로그인" })).toBeTruthy();
});

it("shows the email login entry point when email login is enabled", async () => {
  await renderLogin(true);

  expect(screen.getByRole("button", { name: "이메일 로그인" })).toBeTruthy();
  expect(screen.getByText("또는")).toBeTruthy();
});

it("bypasses the pre-start screen for an administrator game session", async () => {
  window.history.replaceState({}, "", "/");
  vi.spyOn(authApi, "session").mockResolvedValue({ authenticated: true, account: { accountId: "admin", characterId: "character", email: "admin@admin.hanjjak.local", nickname: "관리자", level: 1, experience: 0, rice: 0 }, administrator: false });
  vi.spyOn(adminGameAuthApi, "session").mockResolvedValue({ administrator: true });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { serviceId: "event-2026-09", enabled: true, phase: "PRE_START" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(<QueryClientProvider client={client}><AuthGate><div>game</div></AuthGate></QueryClientProvider>);

  await screen.findByText("game");
  expect(screen.queryByText("한짝 이벤트 서버 준비 중")).toBeNull();
});
