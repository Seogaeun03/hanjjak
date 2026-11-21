// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CosmeticHero } from "../cosmetics/CosmeticHero";
import { BattleProfileSummary } from "./BattleHud";

afterEach(cleanup);

const account = {
  accountId: "account-1",
  characterId: "character-1",
  email: "hero@example.com",
  nickname: "한짝",
  level: 24,
  experience: 0,
  rice: 15_820,
};

it("keeps the profile portrait on its original fixed frame instead of the battle auto-height rule", () => {
  const css = readFileSync(resolve(process.cwd(), "src/features/battle/BattleHud.css"), "utf8");
  expect(css).toMatch(/\.cozy-profile-avatar\.cosmetic-hero-layers > img\s*\{[^}]*align-self:\s*auto;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;[^}]*object-position:\s*50% 100%;/s);
});

it("renders the equipped cosmetic layers in the profile avatar and follows cache updates", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  client.setQueryData(["cosmetic-catalog"], {
    contentVersion: "test",
    cosmetics: [{ cosmeticId: "cosmetic-019", displayName: "아프로 가발", imageUrl: null, grade: "NORMAL", slot: "HEAD", setId: null }],
    sets: [],
  });
  client.setQueryData(["cosmetic-collection"], { equipment: {}, states: [], color: null });

  const view = render(<QueryClientProvider client={client}>
    <BattleProfileSummary account={account} onOpen={vi.fn()} />
  </QueryClientProvider>);

  expect(view.container.querySelector(".cozy-profile-avatar.cosmetic-hero-layers")).not.toBeNull();
  expect(Array.from(view.container.querySelectorAll(".cozy-profile-avatar img")).some(image => image.getAttribute("src")?.includes("/afro/"))).toBe(false);

  client.setQueryData(["cosmetic-collection"], { equipment: { HEAD: "cosmetic-019" }, states: [], color: null });

  await waitFor(() => expect(Array.from(view.container.querySelectorAll(".cozy-profile-avatar img")).some(image => image.getAttribute("src")?.includes("/afro/"))).toBe(true));
});

it("falls back to the default avatar when a composed layer cannot load", () => {
  const view = render(<CosmeticHero
    equipment={{}}
    catalog={{ cosmetics: [], sets: [] }}
    alt="프로필"
    fallback={<img data-testid="fallback-avatar" src="/fallback.webp" alt="" />}
  />);

  fireEvent.error(view.container.querySelector(".cosmetic-hero-layers img")!);

  expect(view.getByTestId("fallback-avatar")).not.toBeNull();
  expect(view.container.querySelector(".cosmetic-hero-layers")).toBeNull();
});
