// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CharacterWindow } from "./CharacterWindow";
import type { CharacterCollection, CharacterCommand, CharacterCommandResult } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const collection: CharacterCollection = {
  contentVersion: "preview",
  states: [
    { cosmeticId: "head-1", displayName: "테스트 모자", imageUrl: null, grade: "NORMAL", slot: "HEAD", registeredQuantity: 1, unregisteredQuantity: 0, reservedQuantity: 0, availableUnregisteredQuantity: 0, cosmeticStar: 1, nextStarThreshold: 2, neededForNextStar: 1, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" },
    { cosmeticId: "face-1", displayName: "테스트 안경", imageUrl: null, grade: "NORMAL", slot: "FACE", registeredQuantity: 1, unregisteredQuantity: 0, reservedQuantity: 0, availableUnregisteredQuantity: 0, cosmeticStar: 1, nextStarThreshold: 2, neededForNextStar: 1, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" },
  ],
  color: null,
  equipment: {},
  uniqueRegisteredCount: 2,
  setStars: {},
  setEffects: {},
  totalEffects: [],
};

it("uses the injected preview command for head and face equipment without calling the live server", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const previewCommand = vi.fn((commands: readonly CharacterCommand[], current: CharacterCollection) => commands.reduce<CharacterCollection>((state, command) => command.kind === "equip"
    ? { ...state, equipment: { ...state.equipment, [command.slot]: command.cosmeticId } }
    : state, current));

  render(<QueryClientProvider client={client}><CharacterWindow
    open
    initialTab="cosmetics"
    previewData={{
      stats: { nickname: "한짝", level: 24, experience: 0, cosmeticsUnlocked: true, contentVersion: "preview", stats: [] },
      collection,
      catalog: { contentVersion: "preview", cosmetics: collection.states.map(({ cosmeticId, displayName, imageUrl, grade, slot }) => ({ cosmeticId, displayName, imageUrl, grade, slot, setId: null })), sets: [] },
    }}
    previewCommand={previewCommand}
    onClose={vi.fn()}
    onGacha={vi.fn()}
  /></QueryClientProvider>);

  await waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-cosmetic-id="head-1"]')).not.toBeNull());
  fireEvent.click(document.querySelector<HTMLButtonElement>('[data-cosmetic-id="head-1"]')!);
  await waitFor(() => expect(client.getQueryData<CharacterCollection>(["cosmetic-collection"])?.equipment.HEAD).toBe("head-1"));
  fireEvent.click(screen.getByRole("tab", { name: "얼굴" }));
  await waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-cosmetic-id="face-1"]')).not.toBeNull());
  fireEvent.click(document.querySelector<HTMLButtonElement>('[data-cosmetic-id="face-1"]')!);
  await waitFor(() => expect(client.getQueryData<CharacterCollection>(["cosmetic-collection"])?.equipment.FACE).toBe("face-1"));

  expect(previewCommand).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("/api/v1/cosmetics/equipment/"))).toBe(false);
  expect(screen.queryByRole("dialog", { name: "알림" })).toBeNull();
  client.clear();
});

it("shows the actual bulk-upgrade count in a centered status toast", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  const upgradeable = { ...collection.states[0], unregisteredQuantity: 1, availableUnregisteredQuantity: 1, canUpgrade: true, upgradeDisabledReason: null };
  const previewCollection = { ...collection, states: [upgradeable] };
  const previewCommand = vi.fn((commands: readonly CharacterCommand[], current: CharacterCollection): CharacterCommandResult => {
    expect(commands[0]?.kind).toBe("bulkRegister");
    const next = { ...current, states: current.states.map(state => ({ ...state, registeredQuantity: 2, unregisteredQuantity: 0, availableUnregisteredQuantity: 0, cosmeticStar: 2, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" })) };
    return { upgradedCount: 1, collection: next };
  });

  render(<QueryClientProvider client={client}><CharacterWindow
    open
    initialTab="gallery"
    previewData={{
      stats: { nickname: "한짝", level: 24, experience: 0, cosmeticsUnlocked: true, contentVersion: "preview", stats: [] },
      collection: previewCollection,
      catalog: { contentVersion: "preview", cosmetics: [{ cosmeticId: "head-1", displayName: "테스트 모자", imageUrl: null, grade: "NORMAL", slot: "HEAD", setId: "set-1" }], sets: [{ setId: "set-1", displayName: "테스트 세트", grade: "NORMAL", members: { HEAD: "head-1" }, effects: { 1: [], 2: [] } }] },
    }}
    previewCommand={previewCommand}
    onClose={vi.fn()}
    onGacha={vi.fn()}
  /></QueryClientProvider>);

  const button = await screen.findByRole("button", { name: /일괄 업그레이드/ });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);

  expect((await screen.findByRole("status")).textContent).toBe("1개의 치장 장비가 업그레이드 되었습니다.");
  expect(document.querySelector(".character-upgrade-toast")).not.toBeNull();
  client.clear();
});
