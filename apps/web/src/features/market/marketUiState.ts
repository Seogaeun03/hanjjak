import type { NumericFieldValue } from "./marketForm";

export const MARKET_UI_STORAGE_KEY = "hanjjak.market-ui";

export type MarketCategory = "material" | "skillbook" | "gem";
/** 거래하기 칸을 값만 죽 적은 목록으로 볼지, 시세(차트·호가)로 볼지. 기본은 목록이다. */
export type MarketBoardView = "chart" | "list";

export type MarketUiState = {
  selectedItemId: string | null;
  sellQuantity: NumericFieldValue;
  sellUnitPrice: NumericFieldValue;
  purchaseQuantity: NumericFieldValue;
  boardView: MarketBoardView;
  /** 손으로 골라 본 품목, 가장 최근이 앞. 왼쪽 칸 맨 아래의 지름길이 이것을 읽는다. */
  recentItemIds: string[];
};

export const DEFAULT_MARKET_UI_STATE: MarketUiState = {
  selectedItemId: null,
  sellQuantity: 1,
  sellUnitPrice: 10,
  purchaseQuantity: 1,
  boardView: "list",
  recentItemIds: [],
};

export function readMarketUiState(storage: Pick<Storage, "getItem">): MarketUiState {
  try {
    const parsed = JSON.parse(storage.getItem(MARKET_UI_STORAGE_KEY) ?? "null") as Partial<MarketUiState> | null;
    if (!parsed) return DEFAULT_MARKET_UI_STATE;
    return {
      selectedItemId: typeof parsed.selectedItemId === "string" ? parsed.selectedItemId : null,
      sellQuantity: parsed.sellQuantity === "" ? "" : Number.isInteger(parsed.sellQuantity) && parsed.sellQuantity! > 0 ? parsed.sellQuantity! : 1,
      sellUnitPrice: parsed.sellUnitPrice === "" ? "" : Number.isInteger(parsed.sellUnitPrice) && parsed.sellUnitPrice! > 0 ? parsed.sellUnitPrice! : 10,
      purchaseQuantity: parsed.purchaseQuantity === "" ? "" : Number.isInteger(parsed.purchaseQuantity) && parsed.purchaseQuantity! > 0 ? parsed.purchaseQuantity! : 1,
      boardView: parsed.boardView === "chart" ? "chart" : "list",
      recentItemIds: Array.isArray(parsed.recentItemIds) ? parsed.recentItemIds.filter(id => typeof id === "string") : [],
    };
  } catch {
    return DEFAULT_MARKET_UI_STATE;
  }
}

export function selectMarketItemForSale(storage: Pick<Storage, "getItem" | "setItem">, itemId: string): void {
  const current = readMarketUiState(storage);
  storage.setItem(MARKET_UI_STORAGE_KEY, JSON.stringify({ ...current, selectedItemId: itemId }));
}

export function marketCategoryForItemId(itemId: string | null): MarketCategory {
  if (itemId?.startsWith("skillbook:")) return "skillbook";
  if (itemId?.startsWith("gem:")) return "gem";
  return "material";
}
