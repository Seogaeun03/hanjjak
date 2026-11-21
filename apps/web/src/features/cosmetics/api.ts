export type StatEffect = { statId: string; value: number; unit: string };
export type CosmeticState = { cosmeticId: string; displayName: string | null; imageUrl: string | null; grade: string; slot: string; registeredQuantity: number; unregisteredQuantity: number; reservedQuantity: number; availableUnregisteredQuantity: number; cosmeticStar: number; nextStarThreshold: number | null; neededForNextStar: number | null; canUpgrade: boolean; upgradeDisabledReason: string | null };
import { rememberCosmeticColor } from "./cosmeticColor";

/** 목록을 받을 때마다 고른 색을 기억해 둔다. 화면이 색을 물어볼 자리가 너무 많다. */
const remember = <T extends { color?: string | null }>(collection: T): T => { rememberCosmeticColor(collection.color); return collection; };

export type Collection = { contentVersion: string; states: CosmeticState[]; equipment: Record<string, string | null>; /** 색만 다른 세트에서 고른 색. 안 골랐으면 첫 번째 색으로 선다. */ color: string | null; uniqueRegisteredCount: number; setStars: Record<string, number>; setEffects: Record<string, StatEffect[]>; totalEffects: StatEffect[] };
export type Milestone = { totalSuccessfulDraws: number; claimedBoxCount: number; claimableBoxCount: number; drawsUntilNextBox: number; boxItemId: string; ownedBoxQuantity: number };
export type Banner = { bannerId: string; setId: string; displayName: string | null; singleRiceCost: number; ticketBalance: number; riceBalance: number; oneDraw: { ticketCost: number; riceCost: number; executable: boolean }; tenDraw: { ticketCost: number; riceCost: number; executable: boolean }; milestone: Milestone };
export type CatalogCosmetic = { cosmeticId: string; displayName: string | null; imageUrl: string | null; grade: string; slot: string; /** 세트에 속하지 않는 치장은 비어 있다. */ setId: string | null };
export type PoolItem = CatalogCosmetic & { probabilityNumerator: number; probabilityDenominator: number; probabilityDisplay: string };
export type Catalog = { contentVersion: string; cosmetics: CatalogCosmetic[]; sets: Array<{ setId: string; displayName: string | null; previewImageUrl?: string | null; grade: string; members: Record<string, string>; effects: Record<string, StatEffect[]>; colors?: string[] }> };
export type BannerDetail = { banner: Banner; gradeProbabilityMillionths: Record<string, number>; pool: PoolItem[] };
export type DrawResponse = { bannerId: string; ticketCost: number; riceCost: number; results: Array<{ cosmeticId: string; grade: string; isNew: boolean }>; collection: Collection };
export type MilestoneResult = { remainingClaimableCount: number };
export type CosmeticShowcase = {
  sets: Array<{ setId: string; displayName: string; imageUrl: string }>;
  version: number;
};

type Envelope<T> = { data: T; code?: string };
export class CosmeticsApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const isCosmeticsLockedError = (error: unknown) => error instanceof CosmeticsApiError && (error.code === "COSMETICS_LOCKED" || error.code === "COSMETIC_SYSTEM_LOCKED");
export const isUncertainCosmeticsError = (error: unknown) => !(error instanceof CosmeticsApiError) || error.status >= 500;

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok) throw new CosmeticsApiError(response.status, body.code ?? `HTTP_${response.status}`);
  return body.data;
}

const commandHeaders = (key: string = crypto.randomUUID()) => ({ "Content-Type": "application/json", "Idempotency-Key": key });
export const cosmeticsApi = {
  showcase: () => fetch("/api/v1/cosmetic-gacha/showcase", { credentials: "include" }).then(json<CosmeticShowcase>),
  detail: (bannerId: string) => fetch(`/api/v1/cosmetic-gacha/banners/${encodeURIComponent(bannerId)}`, { credentials: "include" }).then(json<BannerDetail>),
  banners: () => fetch("/api/v1/cosmetic-gacha/banners", { credentials: "include" }).then(json<Banner[]>),
  collection: () => fetch("/api/v1/cosmetics/collection", { credentials: "include" }).then(json<Collection>).then(remember),
  catalog: () => fetch("/api/v1/cosmetics/catalog", { credentials: "include" }).then(json<Catalog>),
  draw: (bannerId: string, count: 1 | 10, key: string = crypto.randomUUID()) => fetch(`/api/v1/cosmetic-gacha/banners/${encodeURIComponent(bannerId)}/draws`, { method: "POST", credentials: "include", headers: commandHeaders(key), body: JSON.stringify({ count }) }).then(json<DrawResponse>),
  register: (cosmeticId: string, mode: "ONE" | "UNTIL_NEXT_STAR", key: string = crypto.randomUUID()) => fetch(`/api/v1/cosmetics/${encodeURIComponent(cosmeticId)}/registrations`, { method: "POST", credentials: "include", headers: commandHeaders(key), body: JSON.stringify({ mode }) }).then(json<Collection>),
  equip: (slot: string, cosmeticId: string | null, key: string = crypto.randomUUID()) => fetch(`/api/v1/cosmetics/equipment/${encodeURIComponent(slot)}`, { method: "PATCH", credentials: "include", headers: commandHeaders(key), body: JSON.stringify({ cosmeticId }) }).then(json<Collection>),
  claimMilestone: (bannerId: string, count: number, key: string) => fetch(`/api/v1/cosmetic-gacha/banners/${encodeURIComponent(bannerId)}/milestone-claims`, { method: "POST", credentials: "include", headers: commandHeaders(key), body: JSON.stringify({ count }) }).then(json<MilestoneResult>),
  openSelectorBox: (boxItemId: string, cosmeticId: string, key: string) => fetch(`/api/v1/cosmetic-selector-boxes/${encodeURIComponent(boxItemId)}/open`, { method: "POST", credentials: "include", headers: commandHeaders(key), body: JSON.stringify({ cosmeticId }) }).then(json<Collection>),
};
