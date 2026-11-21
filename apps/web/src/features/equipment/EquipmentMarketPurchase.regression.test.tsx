// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { EquipmentScreen } from "./EquipmentScreen";
import { equipmentApi, type EquipmentState } from "./api";

vi.mock("../cosmetics/CosmeticHero", () => ({
  CosmeticHero: ({ fallback }: { fallback: React.ReactNode }) => fallback,
  useOwnCosmeticAppearance: () => ({ equipment: undefined, catalog: undefined }),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const growth = { grade: "NORMAL" as const, gradeName: "노말", enhancementLevel: 1, q: 1, stats: { attack: 1, maxHp: 0, penetration: 0 } };
const state: EquipmentState = { riceBalance: 100_000, slots: [{
  slot: "WEAPON", slotName: "무기", unlocked: true, current: growth, unlock: null, promote: null, growthComplete: false,
  enhance: { cost: { riceCost: 30, materials: [{ itemId: "POTATO_M1", displayName: "감자 M1", requiredQuantity: 1_250, availableQuantity: 462 }] }, result: growth, statIncrease: growth.stats, executable: false, disabledReason: "INSUFFICIENT_MATERIALS" },
}] };

function setup(publicAsk: number | null = 30, otherAsk: number | null = 40, supply = 1_000) {
  vi.spyOn(equipmentApi, "marketInstruments").mockResolvedValue([{ instrumentId: "potato", itemId: "POTATO_M1", bestAskUnitPrice: publicAsk }]);
  const quotes = vi.spyOn(equipmentApi, "purchaseQuote").mockImplementation(async (instrumentId, quantity, limit) => {
    const filled = otherAsk !== null && otherAsk <= limit ? Math.min(quantity, supply) : 0;
    return { instrumentId, requestedQuantity: quantity, expectedFilledQuantity: filled, expectedRemainingQuantity: quantity - filled,
      lowestFilledUnitPrice: filled ? otherAsk : null, highestFilledUnitPrice: filled ? otherAsk : null,
      weightedAverageUnitPrice: filled ? otherAsk : null, totalPrice: filled * (otherAsk ?? 0), availableRice: 100_000, marketRevision: 1 };
  });
  const purchase = vi.spyOn(equipmentApi, "purchaseMaterial").mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><EquipmentScreen previewData={state} /></QueryClientProvider>);
  return { quotes, purchase };
}

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "감자 한 조각 거래소에서 구매" }));
  await screen.findByRole("dialog", { name: "거래소" });
}

it("buys another seller's 40-rice order even when the public cheapest ask is the buyer's 30-rice order", async () => {
  const { purchase } = setup();
  await open();
  await waitFor(() => expect(screen.getByText("40 쌀")).toBeTruthy());
  expect(screen.queryByText("구매할 수 있는 다른 사용자의 매도 주문이 없습니다.")).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: /^구매$/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /^구매$/ }));
  await waitFor(() => expect(purchase).toHaveBeenCalledWith(expect.objectContaining({ instrumentId: "potato", quantity: 788, maxUnitPrice: 40 })));
});

const buyButton = () => screen.getByRole("button", { name: /^구매$/ }) as HTMLButtonElement;
const priceInput = () => screen.getByRole("textbox", { name: "개당 최대 단가" }) as HTMLInputElement;

it("discovers an available ask when the cached public summary has no asks", async () => {
  setup(null, 40);
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  expect(priceInput().value).toBe("40");
});

it("shows no other orders without a zero-rice price or an enabled purchase", async () => {
  const { purchase } = setup(30, null);
  await open();
  await screen.findByText("구매할 수 있는 다른 사용자의 매도 주문이 없습니다.");
  expect(screen.getByText("없음")).toBeTruthy();
  expect(screen.queryByText("0 쌀")).toBeNull();
  expect(buyButton().disabled).toBe(true);
  fireEvent.click(buyButton());
  expect(purchase).not.toHaveBeenCalled();
});

it("distinguishes a low price limit from missing asks and permits an explicit higher limit", async () => {
  const { purchase } = setup();
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  fireEvent.change(priceInput(), { target: { value: "30" } });
  await screen.findByText("최대 단가가 현재 구매 가능 최저가보다 낮습니다.");
  expect(screen.queryByText("구매할 수 있는 다른 사용자의 매도 주문이 없습니다.")).toBeNull();
  expect(buyButton().disabled).toBe(true);
  fireEvent.change(priceInput(), { target: { value: "50" } });
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  expect(screen.getByText("31,520")).toBeTruthy();
  fireEvent.click(buyButton());
  await waitFor(() => expect(purchase).toHaveBeenCalledWith(expect.objectContaining({ quantity: 788, maxUnitPrice: 50 })));
});

it("uses the server total for partial liquidity instead of quantity times the cheapest price", async () => {
  setup(30, 40, 100);
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  expect(screen.getByText("예상 체결 100개 · 미체결 688개")).toBeTruthy();
  expect(screen.getByText("4,000")).toBeTruthy();
  expect(screen.queryByText("23,640")).toBeNull();
});

it("blocks stale quantity quotes while a changed quantity is loading", async () => {
  const { quotes, purchase } = setup();
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  quotes.mockReturnValue(new Promise(() => {}));
  fireEvent.change(screen.getByRole("textbox", { name: "구매 수량" }), { target: { value: "789" } });
  expect(buyButton().disabled).toBe(true);
  fireEvent.click(buyButton());
  expect(purchase).not.toHaveBeenCalled();
  expect(screen.queryByText("31,520")).toBeNull();
});

it("keeps a cleared price empty when refreshed and does not allow an invalid price", async () => {
  setup();
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  fireEvent.change(priceInput(), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "시세 새로고침" }));
  await screen.findByText("40 쌀");
  expect(priceInput().value).toBe("");
  expect(buyButton().disabled).toBe(true);
  fireEvent.change(priceInput(), { target: { value: "9" } });
  await screen.findByText("최대 단가는 10~999,999쌀의 정수로 입력해 주세요.");
  expect(buyButton().disabled).toBe(true);
});

it("keeps the agreed limit when a refreshed market price rises", async () => {
  const { quotes } = setup();
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  const original = quotes.getMockImplementation()!;
  quotes.mockImplementation(async (id, quantity, limit) => {
    const q = await original(id, quantity, limit);
    return quantity === 1 ? { ...q, lowestFilledUnitPrice: 50, highestFilledUnitPrice: 50 } : { ...q, expectedFilledQuantity: 0, lowestFilledUnitPrice: null, totalPrice: 0 };
  });
  fireEvent.click(screen.getByRole("button", { name: "시세 새로고침" }));
  await screen.findByText("50 쌀");
  expect(priceInput().value).toBe("40");
  expect(buyButton().disabled).toBe(true);
  expect(screen.queryByText("구매할 수 있는 다른 사용자의 매도 주문이 없습니다.")).toBeNull();
});

it("shows discovery errors with retry instead of an empty modal", async () => {
  const { quotes } = setup();
  quotes.mockRejectedValue(new Error("network"));
  await open();
  await screen.findByRole("alert");
  expect(screen.getByText("현재 최저가를 불러오지 못했습니다.")).toBeTruthy();
  expect(buyButton().disabled).toBe(true);
});

it("blocks purchase after a failed quote refetch even if a previous quote succeeded", async () => {
  const { quotes } = setup();
  await open();
  await waitFor(() => expect(buyButton().disabled).toBe(false));
  const original = quotes.getMockImplementation()!;
  quotes.mockImplementation((id, quantity, limit) => quantity === 1 ? original(id, quantity, limit) : Promise.reject(new Error("network")));
  fireEvent.click(screen.getByRole("button", { name: "시세 새로고침" }));
  await screen.findByText("구매 견적을 불러오지 못했습니다.");
  expect(buyButton().disabled).toBe(true);
  expect(screen.queryByText("31,520")).toBeNull();
});
