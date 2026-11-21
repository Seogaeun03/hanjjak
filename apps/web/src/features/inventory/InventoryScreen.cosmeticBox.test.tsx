// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryScreen } from "./InventoryScreen";
import { cosmeticsApi, type Catalog, type Collection } from "../cosmetics/api";
import type { InventoryItem, InventoryPage } from "./api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const box: InventoryItem = {
  itemId: "cosmetic-selector-box-01",
  instanceId: null,
  slotId: "stack:cosmetic-selector-box-01:0",
  members: [],
  acquiredSequence: 1,
  name: "치장 선택권 박스",
  icon: "/box.png",
  category: "COSMETIC_BOX",
  description: "열어서 전설 치장 하나를 직접 골라 받는 상자입니다.",
  acquisitionSources: ["치장 뽑기 마일스톤 수령"],
  usages: ["치장 선택 상자 개봉"],
  tradeable: false,
  totalQuantity: 2,
  reservedQuantity: 0,
  availableQuantity: 2,
};

const catalog: Catalog = {
  contentVersion: "v2",
  cosmetics: [
    { cosmeticId: "cosmetic-061", displayName: "거북 모자", imageUrl: null, grade: "LEGENDARY", slot: "HEAD", setId: "cosmetic-set-15" },
    { cosmeticId: "cosmetic-062", displayName: "거북 상의", imageUrl: null, grade: "LEGENDARY", slot: "TOP", setId: "cosmetic-set-15" },
  ],
  sets: [{ setId: "cosmetic-set-15", displayName: "거북이 수호자", grade: "LEGENDARY", members: {}, effects: {} }],
};

const collection: Collection = {
  contentVersion: "v2", states: [], equipment: {}, color: null,
  uniqueRegisteredCount: 1, setStars: {}, setEffects: {}, totalEffects: [],
};

function renderInventory() {
  const page: InventoryPage = { items: [box], usedSlots: 1, maxSlots: 300, isFull: false, nextCursor: null };
  const dataSource = { list: vi.fn(async () => page), detail: vi.fn(async () => ({ ...box, slotId: null })) };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><InventoryScreen dataSource={dataSource} /></QueryClientProvider>);
  return client;
}

it("opens a cosmetic selector box from the inventory and picks a legendary cosmetic", async () => {
  vi.spyOn(cosmeticsApi, "catalog").mockResolvedValue(catalog);
  const openSelectorBox = vi.spyOn(cosmeticsApi, "openSelectorBox").mockResolvedValue(collection);
  renderInventory();

  // 뽑기 화면은 마일스톤 수령까지만 맡는다. 상자를 여는 자리는 인벤토리 하나뿐이다.
  fireEvent.click(await screen.findByRole("button", { name: "치장 선택 상자 열기" }));
  fireEvent.click(await screen.findByRole("button", { name: "거북이 수호자 선택" }));
  fireEvent.click(screen.getByRole("button", { name: /거북 모자/ }));
  fireEvent.click(screen.getByRole("button", { name: "확정하기" }));

  await waitFor(() => expect(openSelectorBox).toHaveBeenCalledWith("cosmetic-selector-box-01", "cosmetic-061", expect.any(String)));
  // 고르고 나면 선택 화면을 닫고 무엇을 받았는지 알려 준다.
  expect(await screen.findByText("거북 모자을(를) 받았습니다.")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "전설 세트 선택" })).toBeNull();
});

it("keeps the selector closed until the open button is pressed", async () => {
  const catalogQuery = vi.spyOn(cosmeticsApi, "catalog").mockResolvedValue(catalog);
  renderInventory();

  await screen.findByRole("button", { name: "치장 선택 상자 열기" });
  expect(screen.queryByRole("heading", { name: "전설 세트 선택" })).toBeNull();
  // 상자를 열기 전에는 치장 카탈로그를 읽지 않는다.
  expect(catalogQuery).not.toHaveBeenCalled();
});

it("sends only one selector command for rapid confirmation clicks", async () => {
  vi.spyOn(cosmeticsApi, "catalog").mockResolvedValue(catalog);
  const gate = Promise.withResolvers<Collection>();
  const openSelectorBox = vi.spyOn(cosmeticsApi, "openSelectorBox").mockImplementation(() => gate.promise);
  const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("selector-command-key" as ReturnType<typeof crypto.randomUUID>);
  renderInventory();

  fireEvent.click(await screen.findByRole("button", { name: "치장 선택 상자 열기" }));
  fireEvent.click(await screen.findByRole("button", { name: "거북이 수호자 선택" }));
  fireEvent.click(screen.getByRole("button", { name: /거북 모자/ }));
  const confirm = screen.getByRole("button", { name: "확정하기" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  await waitFor(() => expect(openSelectorBox).toHaveBeenCalledTimes(1));
  expect(openSelectorBox).toHaveBeenCalledWith("cosmetic-selector-box-01", "cosmetic-061", "selector-command-key");
  expect(randomUUID).toHaveBeenCalledTimes(1);
  gate.resolve(collection);
  expect(await screen.findByText("거북 모자을(를) 받았습니다.")).toBeTruthy();
});

it("shows a recoverable catalog error instead of trapping the only opening path", async () => {
  const catalogQuery = vi.spyOn(cosmeticsApi, "catalog")
    .mockRejectedValueOnce(new Error("catalog unavailable"))
    .mockResolvedValueOnce(catalog);
  renderInventory();

  fireEvent.click(await screen.findByRole("button", { name: "치장 선택 상자 열기" }));
  expect((await screen.findByRole("alert")).textContent).toContain("치장 목록을 불러오지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByRole("heading", { name: "전설 세트 선택" })).toBeTruthy();
  expect(catalogQuery).toHaveBeenCalledTimes(2);
});

it("retries an uncertain selector command with the same choice and idempotency key", async () => {
  vi.spyOn(cosmeticsApi, "catalog").mockResolvedValue(catalog);
  const openSelectorBox = vi.spyOn(cosmeticsApi, "openSelectorBox")
    .mockRejectedValueOnce(new TypeError("network lost"))
    .mockResolvedValueOnce(collection);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("stable-selector-key" as ReturnType<typeof crypto.randomUUID>);
  renderInventory();

  fireEvent.click(await screen.findByRole("button", { name: "치장 선택 상자 열기" }));
  fireEvent.click(await screen.findByRole("button", { name: "거북이 수호자 선택" }));
  fireEvent.click(screen.getByRole("button", { name: /거북 모자/ }));
  fireEvent.click(screen.getByRole("button", { name: "확정하기" }));
  fireEvent.click(await screen.findByRole("button", { name: "같은 요청 다시 확인" }));

  await waitFor(() => expect(openSelectorBox).toHaveBeenCalledTimes(2));
  expect(openSelectorBox.mock.calls[0]).toEqual(openSelectorBox.mock.calls[1]);
  expect(await screen.findByText("거북 모자을(를) 받았습니다.")).toBeTruthy();
});
