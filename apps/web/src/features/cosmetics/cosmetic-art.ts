// 착용한 치장을 그릴 그림 경로를 고른다. 서버가 `imageUrl`을 내려주면 그 값이 항상 우선한다.
//
// 파일은 `public/cosmetics` 아래에 두고 경로 문자열로만 참조한다. 번들러 모듈로 import하면
// 백 종 가까운 그림이 화면과 무관하게 전부 로드되어 개발 서버가 다른 요청을 밀어낸다.

import { LOOSE_ART_NAMES, LOOSE_ART_SLUGS, SET_ART_COLORS, SET_ART_NAMES, SET_ART_SLUGS } from "./cosmetic-art-map";
import { cosmeticColor } from "./cosmeticColor";
import { loadCosmeticImage } from "./cosmeticImageCache";

const ICON_BASE = "/cosmetics/item-icons";
const MOTION_BASE = "/cosmetics/motion";

const COSMETIC_ASSET_VERSION = typeof __COSMETIC_ASSET_VERSION__ === "string" ? __COSMETIC_ASSET_VERSION__ : "";

/**
 * `public/cosmetics` 그림 주소에 빌드 버전을 붙인다. 파일명에 해시가 없어 캐시된 옛 레이어와 새 레이어가
 * 섞이지 않게, 그림이 바뀐 배포마다 주소가 바뀐다. 버전이 없으면(개발 서버·테스트) 경로를 그대로 둔다.
 */
export function versionedCosmeticAsset(path: string, version = COSMETIC_ASSET_VERSION): string {
  return version ? `${path}?v=${version}` : path;
}

/** 아이콘 파일 이름에 붙는 부위 이름. `BOTTOM`은 화면에서 무기로 쓴다. */
const ICON_SUFFIXES: Record<string, string> = {
  HEAD: "head", FACE: "face", TOP: "top", BOTTOM: "bottom", WEAPON: "bottom",
  GLOVES: "gloves", SHOES: "shoes", CAPE: "cape",
};

/** 낱장 그림 파일 이름에 붙는 부위 이름. 아트가 쓰는 말이라 아이콘 쪽과 다르다. */
const LAYER_PARTS: Record<string, string> = {
  HEAD: "hat", FACE: "face", TOP: "body", BOTTOM: "weapon", WEAPON: "weapon",
  GLOVES: "gloves", SHOES: "shoes", CAPE: "back",
};

/**
 * 겹쳐 그리는 차례. 아트가 파일 이름 앞 번호로 정해 둔 것을 그대로 옮겼다.
 * 상의는 팔 아래, 소매는 팔 위다. 그래야 민소매 옷을 입어도 팔이 옷 속으로 사라지지 않는다.
 */
const DRAW_ORDER = ["CAPE", "BODY", "SHOES", "TOP", "HEAD", "FACE", "BOTTOM", "ARMS", "SLEEVES", "GLOVES"] as const;

/** 착용 칸을 늘어놓는 차례. 화면이 부위를 줄세울 때 쓴다. */
export const COSMETIC_LAYER_ORDER = ["CAPE", "TOP", "SHOES", "BOTTOM", "GLOVES", "HEAD", "FACE"] as const;

/** 아트가 다섯 동작을 내놓았다. 쓰러지는 동작만 한 장이다. */
export const COSMETIC_MOTIONS = ["rest", "run", "strike1", "strike2", "death"] as const;
export type CosmeticMotion = (typeof COSMETIC_MOTIONS)[number];
export const COSMETIC_MOTION_FRAMES: Record<CosmeticMotion, number> = { rest: 4, run: 4, strike1: 4, strike2: 4, death: 1 };

/** 낱장 그림 한 장의 크기. 화면 비율과 바닥 보정이 이 값에서 나온다. */
export const COSMETIC_FRAME_WIDTH = 737;
export const COSMETIC_FRAME_HEIGHT = 620;
/** 프레임 아래 남는 빈 칸. 캐릭터를 바닥에 붙일 때 이만큼 내린다. */
export const COSMETIC_FRAME_FOOT_GAP = "14.4%";

type ArtCosmetic = { cosmeticId?: string; setId?: string | null; slot?: string; imageUrl?: string | null };

/** 이 치장의 그림이 어느 폴더에 있는지. 세트에 속하지 않으면 번호로 찾는다. */
export function cosmeticArtSlug(cosmetic?: ArtCosmetic | null, color?: string | null): string | null {
  if (!cosmetic) return null;
  const base = cosmetic.setId ? SET_ART_SLUGS[cosmetic.setId] : cosmetic.cosmeticId ? LOOSE_ART_SLUGS[cosmetic.cosmeticId] : undefined;
  if (!base) return null;
  const colors = cosmetic.setId ? SET_ART_COLORS[cosmetic.setId] : undefined;
  if (!colors) return base;
  // 부르는 쪽이 색을 안 넘기면 이 사람이 고른 색을 쓴다. 모든 조합 자리에 색을 들려 보내면
  // 자리 하나만 빠뜨려도 캐릭터가 화면마다 다른 색으로 선다.
  const picked = color ?? cosmeticColor();
  return `${base}-${picked && colors.includes(picked) ? picked : colors[0]}`;
}

/** 이 세트가 색을 고를 수 있는지. 고를 수 있으면 고를 수 있는 색을 돌려준다. */
export function cosmeticSetColors(setId?: string | null): readonly string[] | null {
  return setId ? SET_ART_COLORS[setId] ?? null : null;
}

/** 부위 아이콘. 콘텐츠 이미지가 있으면 그것을, 없으면 로컬 아트를 쓴다. */
export function cosmeticArtUrl(cosmetic?: ArtCosmetic | null, color?: string | null): string | null {
  if (!cosmetic) return null;
  if (cosmetic.imageUrl) return cosmetic.imageUrl;
  const slug = cosmeticArtSlug(cosmetic, color);
  const suffix = cosmetic.slot ? ICON_SUFFIXES[cosmetic.slot] : undefined;
  return slug && suffix ? versionedCosmeticAsset(`${ICON_BASE}/${slug}-${suffix}.png`) : null;
}

/**
 * 세트를 한 눈에 가리키는 그림. 예전에는 세트마다 전신 완성본이 따로 있었는데 새 아트에는
 * 없다. 상의 아이콘이 세트 색과 무늬를 가장 잘 담고 있어 그것으로 대신한다.
 */
export function cosmeticSetArtUrl(set?: { setId?: string; previewImageUrl?: string | null } | null, color?: string | null): string | null {
  if (!set) return null;
  if (set.previewImageUrl) return set.previewImageUrl;
  return cosmeticArtUrl({ setId: set.setId, slot: "TOP" }, color);
}

/** 세트 이름. 콘텐츠 표시명이 없으면 아트 표의 이름을 쓴다. */
export function cosmeticSetName(set?: { setId?: string; displayName?: string | null } | null): string | null {
  if (set?.displayName) return set.displayName;
  return set?.setId ? SET_ART_NAMES[set.setId] ?? null : null;
}

const SLOT_NAMES: Record<string, string> = {
  HEAD: "모자", FACE: "얼굴", TOP: "상의", BOTTOM: "무기", WEAPON: "무기",
  GLOVES: "장갑", SHOES: "신발", CAPE: "망토",
};

/** 치장 이름. 세트 치장은 `세트 이름 + 부위`, 세트 없는 치장은 제 이름을 쓴다. */
export function cosmeticDisplayName(cosmetic?: { cosmeticId?: string; displayName?: string | null; setId?: string | null; slot?: string } | null): string {
  if (cosmetic?.displayName) return cosmetic.displayName;
  if (cosmetic?.cosmeticId && LOOSE_ART_NAMES[cosmetic.cosmeticId]) return LOOSE_ART_NAMES[cosmetic.cosmeticId];
  const setName = cosmetic?.setId ? SET_ART_NAMES[cosmetic.setId] : undefined;
  const slotName = cosmetic?.slot ? SLOT_NAMES[cosmetic.slot] : undefined;
  if (setName && slotName) return `${setName} ${slotName}`;
  return `치장 #${(cosmetic?.cosmeticId ?? "").slice(-3)}`;
}

/**
 * 전투 쪽이 쓰는 동작 이름을 아트 폴더 이름으로 옮긴다. 새 아트가 오면서 이름이 바뀌었는데,
 * 전투 판정과 화면 로직이 쓰던 이름까지 따라 바꿀 이유는 없다.
 */
const MOTION_ALIASES: Record<string, CosmeticMotion> = { run2: "run", thrust1: "strike2", death1: "death" };

function frameName(motion: string, frame: number): string {
  const art = MOTION_ALIASES[motion] ?? motion;
  // 쓰러지는 동작은 한 장뿐이다. 넘치는 프레임은 마지막 장으로 눌러 둔다.
  const count = COSMETIC_MOTION_FRAMES[art as CosmeticMotion] ?? 4;
  return `${art}_${String(Math.min(count, Math.max(1, frame + 1))).padStart(2, "0")}`;
}

/** 무기 자리를 비웠을 때 쥐여 주는 기본 나무검. */
export function cosmeticDefaultWeaponUrl(motion: string, frame: number): string {
  return versionedCosmeticAsset(`${MOTION_BASE}/weapon-default/${frameName(motion, frame)}.png`);
}

/** 치장 없는 맨몸과 팔. 어느 세트를 입어도 같은 그림이라 한 벌만 둔다. */
export function cosmeticBodyUrl(motion: string, frame: number): string {
  return versionedCosmeticAsset(`${MOTION_BASE}/body/${frameName(motion, frame)}.png`);
}
export function cosmeticArmsUrl(motion: string, frame: number): string {
  return versionedCosmeticAsset(`${MOTION_BASE}/arms/${frameName(motion, frame)}.png`);
}

/** 한 부위의 그림. 어느 폴더인지 알 수 없는 치장이면 null이다. */
export function cosmeticLayerUrl(cosmetic: ArtCosmetic | undefined, motion: string, frame: number, color?: string | null): string | null {
  const slug = cosmeticArtSlug(cosmetic, color);
  const part = cosmetic?.slot ? LAYER_PARTS[cosmetic.slot] : undefined;
  return slug && part ? versionedCosmeticAsset(`${MOTION_BASE}/${slug}/${cosmeticFrameName(slug, motion, frame)}-${part}.png`) : null;
}

/** 상의가 몸통과 소매로 나뉜 세트. 소매는 팔보다 위에 올려야 팔에 덮이지 않는다. */
const SLEEVED_SLUGS: ReadonlySet<string> = new Set(["sushi", "chef", "climbing-red", "climbing-blue"]);

/** 전달받은 신규 아트에는 두 번째 공격 모션이 없어 첫 번째 공격 레이어를 명시적으로 재사용한다. */
const STRIKE2_FALLBACK_SLUGS: ReadonlySet<string> = new Set([
  "cardboard-crayon", "white-fox-spirit", "dokkaebi", "magical-girl", "snake-water-guardian",
  "lightning-laurel", "forest-spirit", "royal-knight", "king", "grim-reaper", "cheerleader",
  "leaf", "meat-skewer", "geek-chic-glasses", "neon-glasses", "tears", "face-mask",
  "octopus-mouth", "bandage", "santa-nose", "aing-eyes", "duck-mouth", "pacifier",
  "cardboard-brows", "ssafy-hood-black", "ssafy-hood-blue", "ssafy-hood-white",
]);
const EXPANDED_SLEEVED_SLUGS: ReadonlySet<string> = new Set([
  ...SLEEVED_SLUGS,
  "magical-girl", "snake-water-guardian", "king",
  "ssafy-hood-black", "ssafy-hood-blue", "ssafy-hood-white",
]);

function cosmeticFrameName(slug: string, motion: string, frame: number): string {
  const aliased = MOTION_ALIASES[motion] ?? motion;
  return frameName(aliased === "strike2" && STRIKE2_FALLBACK_SLUGS.has(slug) ? "strike1" : motion, frame);
}

/** 상의 위에 덧그리는 소매. 소매가 따로 그려진 세트만 있다. */
function cosmeticSleevesUrl(cosmetic: ArtCosmetic | undefined, motion: string, frame: number, color?: string | null): string | null {
  if (cosmetic?.slot !== "TOP") return null;
  const slug = cosmeticArtSlug(cosmetic, color);
  return slug && EXPANDED_SLEEVED_SLUGS.has(slug) ? versionedCosmeticAsset(`${MOTION_BASE}/${slug}/${cosmeticFrameName(slug, motion, frame)}-sleeves.png`) : null;
}

type ComposeCosmetic = { cosmeticId: string; setId?: string | null; slot: string; imageUrl?: string | null };
type ComposeCatalog = { cosmetics: ComposeCosmetic[]; sets: Array<{ setId: string }> };

/** 무기 부위의 데이터 슬롯 이름. 콘텐츠 판에 따라 BOTTOM과 WEAPON 중 하나를 쓴다. */
export function cosmeticWeaponSlot(catalog: ComposeCatalog): string {
  const hasBottom = catalog.cosmetics.some(item => item.slot === "BOTTOM");
  const hasWeapon = catalog.cosmetics.some(item => item.slot === "WEAPON");
  return !hasBottom && hasWeapon ? "WEAPON" : "BOTTOM";
}

/**
 * 한 프레임을 그릴 그림들을 겹치는 차례대로 쌓는다. 아무것도 걸치지 않았으면 맨몸과 팔만
 * 돌려준다. 모든 세트가 같은 차례를 쓰므로 섞어 입어도 자리가 맞는다.
 */
export function composeCosmeticHeroMotion(
  equipment: Record<string, string | null | undefined> | undefined,
  catalog: ComposeCatalog | undefined,
  motion: string,
  frame: number,
  color?: string | null,
): string[] {
  const body = cosmeticBodyUrl(motion, frame);
  const arms = cosmeticArmsUrl(motion, frame);
  const cosmetics = new Map((catalog?.cosmetics ?? []).map(item => [item.cosmeticId, item]));
  const weaponSlot = catalog ? cosmeticWeaponSlot(catalog) : "BOTTOM";
  const resolvedEquipment = equipment ?? {};
  const worn = new Map<string, ComposeCosmetic>();
  for (const uiSlot of COSMETIC_LAYER_ORDER) {
    const id = resolvedEquipment[uiSlot === "BOTTOM" ? weaponSlot : uiSlot];
    const item = id ? cosmetics.get(id) : undefined;
    if (item) worn.set(uiSlot, item);
  }
  const top = worn.get("TOP");
  return DRAW_ORDER.flatMap(step => {
    if (step === "BODY") return [body];
    if (step === "ARMS") return [arms];
    if (step === "SLEEVES") return [cosmeticSleevesUrl(top, motion, frame, color)];
    // 무기 자리가 비면 기본 나무검을 쥐여 준다. 아트가 정한 자리가 무기 자리이므로 여기 끼운다.
    if (step === "BOTTOM" && !worn.has("BOTTOM")) return [cosmeticDefaultWeaponUrl(motion, frame)];
    return [cosmeticLayerUrl(worn.get(step), motion, frame, color)];
  }).filter((layer): layer is string => Boolean(layer));
}

/** 세트 한 벌을 입은 모습. 세트 전체를 보여 줄 때 쓴다. */
export function composeCosmeticSetHero(
  set: { members?: Record<string, string> } | undefined,
  catalog: ComposeCatalog | undefined,
  color?: string | null,
): string[] {
  return composeCosmeticHeroMotion(set?.members, catalog, "rest", 0, color);
}

/** 대기 자세 한 장. 캐릭터 창·장비 창·랭킹처럼 움직이지 않는 자리에서 쓴다. */
export function composeCosmeticHero(
  equipment: Record<string, string | null | undefined> | undefined,
  catalog: ComposeCatalog | undefined,
  color?: string | null,
): string[] {
  return composeCosmeticHeroMotion(equipment, catalog, "rest", 0, color);
}

const preloadedMotions = new Set<string>();

/**
 * 한 동작의 모든 프레임을 미리 받아 둔다. 없으면 프레임이 넘어갈 때마다 브라우저가 처음 보는
 * 파일을 받으러 가서 캐릭터가 한 번씩 깜빡인다.
 */
export function preloadCosmeticHeroMotion(
  equipment: Record<string, string | null | undefined> | undefined,
  catalog: ComposeCatalog | undefined,
  motion: string,
  color?: string | null,
): void {
  if (typeof Image === "undefined") return;
  const key = `${motion}:${color ?? ""}:${catalog ? "catalog-ready" : "catalog-loading"}:${Object.entries(equipment ?? {}).filter(([, id]) => id).map(([slot, id]) => `${slot}=${id}`).sort().join("&")}`;
  if (preloadedMotions.has(key)) return;
  preloadedMotions.add(key);
  for (let frame = 0; frame < (COSMETIC_MOTION_FRAMES[motion as CosmeticMotion] ?? 4); frame += 1) {
    for (const url of composeCosmeticHeroMotion(equipment, catalog, motion, frame, color)) {
      void loadCosmeticImage(url).catch(() => undefined);
    }
  }
}
