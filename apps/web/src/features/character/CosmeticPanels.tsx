import { useEffect, useRef, useState, type CSSProperties } from "react";
import { layout, prepare, type PreparedText } from "@chenglou/pretext";
import type { CatalogCosmetic, CharacterCollection, CharacterCommand, CosmeticCatalog } from "./api";
import { COSMETIC_LAYER_ORDER, composeCosmeticHero, composeCosmeticSetHero, cosmeticArtUrl, cosmeticDisplayName, cosmeticSetColors, cosmeticSetName, versionedCosmeticAsset } from "../cosmetics/cosmetic-art";
import characterBackdrop from "./assets-cosmetics-v3/costume-myroom-background-v3.png";
import characterShadow from "./assets-cozy-pixel/character-floor-shadow.png";
import armorFallback from "../equipment/assets-cozy-pixel/equipment-armor-basic-v2.png";
import bootsFallback from "../equipment/assets-cozy-pixel/equipment-boots-basic-v2.png";
import capeFallback from "../equipment/assets-cozy-pixel/equipment-cape-basic-v2.png";
import glovesFallback from "../equipment/assets-cozy-pixel/equipment-gloves-basic-v2.png";
import helmetFallback from "../equipment/assets-cozy-pixel/equipment-helmet-basic-v2.png";
import weaponFallback from "../equipment/assets-cozy-pixel/equipment-weapon-basic-v2.png";
import emptyCapeSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-cape.png";
import emptyFaceSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-face.png";
import emptyGlovesSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-gloves.png";
import emptyHeadSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-head.png";
import emptyShoesSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-shoes.png";
import emptyTopSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-top.png";
import emptyWeaponSlot from "./assets-cozy-pixel/empty-slots-v1/empty-slot-weapon.png";
import collectionBookIcon from "./assets-cozy-pixel/collection-v1/collection-book-icon.png";
import collectionEffectBoxIcon from "./assets-cozy-pixel/collection-v1/collection-effect-box-icon.png";
import collectionPieceIcon from "./assets-cozy-pixel/collection-v1/collection-piece-icon.png";
import collectionSignDecoration from "./assets-cozy-pixel/collection-v1/collection-sign-decoration.png";
import defenseShieldIcon from "./assets-cozy-pixel/collection-v1/defense-shield-icon.png";
import setEffectStarActive from "./assets-cozy-pixel/collection-v1/set-effect-star-active.png";
import setEffectStarLocked from "./assets-cozy-pixel/collection-v1/set-effect-star-locked.png";
import heartIcon from "./assets-cozy-pixel/heart-icon-128.png";
import swordIcon from "./assets-cozy-pixel/sword-icon-128.png";

export const SLOT_LABELS: Record<string, string> = { HEAD: "머리", FACE: "얼굴", TOP: "상의", GLOVES: "장갑", SHOES: "신발", CAPE: "망토", BOTTOM: "무기" };
/** 세트가 채우는 여섯 자리. 얼굴은 세트 밖 치장만 쓰므로 도감에는 나오지 않는다. */
export const SET_SLOT_LABELS = Object.fromEntries(Object.entries(SLOT_LABELS).filter(([slot]) => slot !== "FACE"));
/** 부위를 가리지 않는 보기. 실제 부위 이름과 부딪히지 않는 값을 쓴다. */
const ALL_SLOTS = "ALL";
// 장비 슬롯은 좌우 세 칸씩 두고, 얼굴은 캐릭터 얼굴 가까이에 작은 플로팅 슬롯으로 둔다.
const SLOT_SIDES: Record<string, "left" | "right" | "face"> = { HEAD: "left", TOP: "left", GLOVES: "left", FACE: "face", SHOES: "right", CAPE: "right", BOTTOM: "right" };
/** 같은 쪽에 앉는 칸들. 몇 번째인지와 몇 개인지를 알아야 위아래로 고르게 나눌 수 있다. */
const SLOT_ROWS = Object.entries(SLOT_SIDES).reduce<Record<string, { row: number; rows: number }>>((rows, [slot, side], _index, entries) => {
  const sameSide = entries.filter(([, other]) => other === side);
  rows[slot] = { row: sameSide.findIndex(([id]) => id === slot), rows: Math.max(1, sameSide.length - 1) };
  return rows;
}, {});
const GRADE_LABELS: Record<string, string> = { NORMAL: "노말", RARE: "희귀", EPIC: "영웅", LEGENDARY: "전설" };
const GRADE_ORDER = ["NORMAL", "RARE", "EPIC", "LEGENDARY"] as const;
const GRADE_RANK = new Map<string, number>(GRADE_ORDER.map((grade, index) => [grade, index]));
const compareCosmeticGrade = (left: { grade: string }, right: { grade: string }) =>
  (GRADE_RANK.get(left.grade) ?? GRADE_ORDER.length) - (GRADE_RANK.get(right.grade) ?? GRADE_ORDER.length);
const COLOR_NAMES: Record<string, string> = { red: "빨강", blue: "파랑" };
const SLOT_FALLBACKS: Record<string, string> = {
  HEAD: helmetFallback,
  TOP: armorFallback,
  BOTTOM: weaponFallback,
  GLOVES: glovesFallback,
  SHOES: bootsFallback,
  CAPE: capeFallback,
  WEAPON: weaponFallback,
  FACE: emptyFaceSlot,
};
const EMPTY_SLOT_ART: Record<string, string> = {
  HEAD: emptyHeadSlot,
  FACE: emptyFaceSlot,
  TOP: emptyTopSlot,
  GLOVES: emptyGlovesSlot,
  SHOES: emptyShoesSlot,
  CAPE: emptyCapeSlot,
  BOTTOM: emptyWeaponSlot,
  WEAPON: emptyWeaponSlot,
};
// 아무것도 착용하지 않은 기본 모습은 기본 나무검을 든 자세다.
const DEFAULT_HERO = versionedCosmeticAsset("/cosmetics/hero-default.png");
const STAT_LABELS: Record<string, string> = { attackPercent: "공격력", maxHpPercent: "최대 HP", defensePenetrationPercent: "방어 관통", basicAttackDamagePercent: "기본공격 피해", criticalChancePoint: "치명타 확률", attackSpeedPercent: "공격속도", buffDurationSeconds: "버프 지속시간" };
type CommandInput = Omit<Extract<CharacterCommand, { kind: "register" }>, "key"> | Omit<Extract<CharacterCommand, { kind: "bulkRegister" }>, "key"> | Omit<Extract<CharacterCommand, { kind: "equip" }>, "key"> | Omit<Extract<CharacterCommand, { kind: "color" }>, "key">;
type Props = { collection: CharacterCollection; catalog: CosmeticCatalog; pending: boolean; send: (command: CommandInput) => void };

export const cosmeticFallbackName = (id: string) => `치장 #${id.slice(-3)}`;
export const setFallbackName = (id: string) => `세트 #${id.slice(-2)}`;
const cosmeticName = (cosmetic?: CatalogCosmetic) => (cosmetic ? cosmeticDisplayName(cosmetic) : "콘텐츠 없음");
const effectValueText = (effect: { value: number; unit: string }) => (effect.unit === "SECONDS" ? `${effect.value}초` : `${effect.value / 100}%`);
const effectText = (effect: { statId: string; value: number; unit: string }) => `${STAT_LABELS[effect.statId] ?? effect.statId} ${effectValueText(effect)}`;

function dataSlotFor(uiSlot: string, catalog: CosmeticCatalog) {
  if (uiSlot !== "BOTTOM") return uiSlot;
  const hasBottom = catalog.cosmetics.some(item => item.slot === "BOTTOM");
  const hasPreviewWeapon = catalog.cosmetics.some(item => item.slot === "WEAPON");
  return !hasBottom && hasPreviewWeapon ? "WEAPON" : "BOTTOM";
}

function usePretextCostumeLayout(contentKey: string) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!document.fonts || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void document.fonts.ready.then(() => {
      if (disposed || !root.current) return;
      const prepared = new Map<HTMLElement, PreparedText>();
      root.current.querySelectorAll<HTMLElement>("[data-pretext]").forEach(element => {
        prepared.set(element, prepare(element.textContent ?? "", getComputedStyle(element).font, { wordBreak: "keep-all" }));
      });
      const relayout = () => {
        prepared.forEach((text, element) => {
          const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 18;
          element.style.minHeight = `${Math.ceil(layout(text, Math.max(element.clientWidth, 1), lineHeight).height)}px`;
        });

        const grid = root.current?.querySelector<HTMLElement>(".costume-owned-grid");
        const closet = root.current?.querySelector<HTMLElement>(".costume-closet-pane");
        const firstCard = grid?.querySelector<HTMLElement>("li > button");
        if (!grid || !closet || !firstCard) return;
        if (getComputedStyle(grid).overflowY === "visible") {
          grid.style.removeProperty("height");
          return;
        }

        // 스크롤 칸의 끝에 다음 행 머리만 걸치면 카드가 잘린 것처럼 보인다.
        // 카드 비율은 유지하고, 현재 칸에 온전히 들어가는 행 수만큼만 뷰포트를 잡는다.
        const style = getComputedStyle(grid);
        const gap = Number.parseFloat(style.rowGap) || 0;
        const paddingTop = Number.parseFloat(style.paddingTop) || 0;
        const available = closet.getBoundingClientRect().bottom - grid.getBoundingClientRect().top;
        const rowHeight = firstCard.getBoundingClientRect().height;
        const visibleRows = Math.max(1, Math.floor((available - paddingTop + gap) / (rowHeight + gap)));
        const fittedHeight = paddingTop + visibleRows * rowHeight + Math.max(0, visibleRows - 1) * gap;
        grid.style.height = `${Math.ceil(Math.min(available, fittedHeight))}px`;
      };
      observer = new ResizeObserver(relayout);
      observer.observe(root.current);
      relayout();
    });
    return () => { disposed = true; observer?.disconnect(); };
  }, [contentKey]);
  return root;
}

function CosmeticImage({ cosmetic, slot, compact = false }: { cosmetic?: CatalogCosmetic; slot?: string; compact?: boolean }) {
  const resolvedSlot = cosmetic?.slot ?? slot ?? "HEAD";
  const emptySlot = !cosmetic;
  const fallback = emptySlot
    ? EMPTY_SLOT_ART[resolvedSlot] ?? emptyHeadSlot
    : SLOT_FALLBACKS[resolvedSlot] ?? helmetFallback;
  const artUrl = cosmeticArtUrl(cosmetic);
  const artStateClass = artUrl ? " has-content-art" : emptySlot ? " is-empty-slot-art" : " is-placeholder-art";
  return <span className={`character-cosmetic-art${compact ? " is-compact" : ""}${artStateClass}`}>
    <img
      className="character-cosmetic-image"
      src={artUrl ?? fallback}
      alt={artUrl ? cosmeticName(cosmetic) : cosmetic ? `${cosmeticName(cosmetic)} 이미지 준비 중` : `${SLOT_LABELS[resolvedSlot] ?? "치장"} 비어 있음`}
    />
  </span>;
}

export function CostumePanel({ collection, catalog, pending, send, sendBatch, nickname = "한짝" }: Props & { onGacha: () => void; sendBatch: (commands: CommandInput[]) => void; nickname?: string }) {
  // 이 화면에서는 방금 받은 목록이 가장 정확하다. 기억해 둔 값은 다른 화면을 위한 것이다.
  const color = collection.color;
  const [slot, setSlot] = useState("HEAD");
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [focusedCosmeticId, setFocusedCosmeticId] = useState<string | null>(null);
  const cosmetics = new Map(catalog.cosmetics.map(item => [item.cosmeticId, item]));
  /* 부위를 하나씩 오가지 않고 가진 것을 한눈에 보고 싶을 때가 있다. 그때는
     부위를 가리지 않고 모두 내놓고, 입고 벗기는 그 치장이 속한 부위로 한다. */
  const showingAll = slot === ALL_SLOTS;
  const activeDataSlot = dataSlotFor(showingAll ? "HEAD" : slot, catalog);
  const owned = collection.states.filter(item => item.registeredQuantity > 0 && (showingAll || item.slot === activeDataSlot));
  const selected = Object.hasOwn(draft, activeDataSlot) ? draft[activeDataSlot] : collection.equipment[activeDataSlot];
  const selectedState = collection.states.find(item => item.cosmeticId === selected);
  const selectedCosmetic = cosmetics.get(focusedCosmeticId ?? selected ?? "");
  const summaryCosmetic = selectedCosmetic ?? cosmetics.get(owned[0]?.cosmeticId ?? "");
  // 화면에 보이는 부위 차례를 따른다. 겹쳐 그리는 차례(COSMETIC_LAYER_ORDER)는 무기가
  // 장갑보다 앞이어야 해서 다르고, 명령 순서가 거기에 끌려다닐 이유는 없다.
  const equipmentSlots = [...new Set(Object.keys(SLOT_LABELS).map(uiSlot => dataSlotFor(uiSlot, catalog)))];
  const resetCommands: CommandInput[] = equipmentSlots
    .filter(dataSlot => Boolean(collection.equipment[dataSlot]))
    .map(dataSlot => ({ kind: "equip", slot: dataSlot, cosmeticId: null }));
  // 겹쳐 그리는 일은 한 곳에서만 한다. 예전에는 이 화면이 제 나름의 차례를 따로 들고 있어
  // 전투 화면과 미리보기가 같은 옷을 다르게 그리는 일이 생겼다.
  const previewEquipment = Object.fromEntries(COSMETIC_LAYER_ORDER.map(uiSlot => {
    const dataSlot = dataSlotFor(uiSlot, catalog);
    return [dataSlot, Object.hasOwn(draft, dataSlot) ? draft[dataSlot] : collection.equipment[dataSlot]];
  }));
  const composedLayers = composeCosmeticHero(previewEquipment, catalog, color);
  const previewSet = catalog.sets.find(item => item.setId === summaryCosmetic?.setId) ?? null;
  const previewSetMembers = previewSet
    ? Object.entries(previewSet.members).filter((entry): entry is [string, string] => Boolean(entry[1]))
    : [];
  const previewSetOwnedCount = previewSetMembers.filter(([, id]) => collection.states.some(state => state.cosmeticId === id && state.registeredQuantity > 0)).length;
  const previewSetEquippedCount = previewSetMembers.filter(([memberSlot, id]) => previewEquipment[memberSlot] === id).length;
  const previewSetEquipCommands: CommandInput[] = previewSetMembers
    .filter(([memberSlot, id]) => previewEquipment[memberSlot] !== id)
    .map(([memberSlot, id]) => ({ kind: "equip", slot: memberSlot, cosmeticId: id }));
  const previewSetDisplayName = previewSet
    ? (cosmeticSetName(previewSet) ?? setFallbackName(previewSet.setId))
    : "선택한 치장의 세트";
  const previewSetTitle = previewSetDisplayName.endsWith("세트") ? previewSetDisplayName : `${previewSetDisplayName} 세트`;
  // 모자와 상의를 그 세트로 맞춰 입었을 때만 색 단추를 낸다. 신발 한 짝만 걸쳐도 뜨게 했더니
  // 무엇의 색을 고르는 단추인지 알 수 없었다.
  const colorSetOf = (uiSlot: string) => {
    const id = previewEquipment[dataSlotFor(uiSlot, catalog)];
    const setId = id ? cosmetics.get(id)?.setId : null;
    return cosmeticSetColors(setId) ? setId : null;
  };
  const colorableSetId = colorSetOf("HEAD");
  const wearableColors = colorableSetId && colorableSetId === colorSetOf("TOP") ? cosmeticSetColors(colorableSetId) : null;
  const layoutRoot = usePretextCostumeLayout(`${slot}:${owned.map(item => item.cosmeticId).join(",")}`);
  return <div ref={layoutRoot} className="character-two-columns costume-layout">
    <section className="costume-preview-pane" aria-label="치장 미리보기">
      <div className="costume-character-stage" aria-label="치장 부위 선택">
        <img className="costume-character-stage__backdrop" src={characterBackdrop} alt="" />
        <img className="costume-character-stage__shadow" src={characterShadow} alt="" />
        <span className="costume-character-stage__hero costume-hero-layers" role="img" aria-label="선택한 치장을 미리 보는 한짝 캐릭터">
          {composedLayers.map(layer => <img key={layer} src={layer} alt="" />)}
        </span>
        <div className="costume-character-nameplate" aria-label={nickname}>
          <strong>{nickname}</strong>
        </div>
        {wearableColors && <div className="costume-color-switch" role="group" aria-label="색 고르기">
          {wearableColors.map(option => <button key={option} type="button" className={`costume-color-chip is-${option}`} aria-pressed={(color ?? wearableColors[0]) === option} aria-label={COLOR_NAMES[option] ?? option} title={COLOR_NAMES[option] ?? option} onClick={() => send({ kind: "color", color: option })} />)}
        </div>}
        <button
          type="button"
          className="costume-preview-reset"
          disabled={pending || resetCommands.length === 0}
          onClick={() => {
            setDraft(Object.fromEntries(equipmentSlots.map(dataSlot => [dataSlot, null])));
            sendBatch(resetCommands);
          }}
        >초기화</button>
        {Object.entries(SLOT_LABELS).map(([id, label]) => {
          const dataSlot = dataSlotFor(id, catalog);
          const current = collection.equipment[dataSlot];
          const preview = Object.hasOwn(draft, dataSlot) ? draft[dataSlot] : current;
          const previewCosmetic = cosmetics.get(preview ?? "");
          const previewStar = collection.states.find(item => item.cosmeticId === preview)?.cosmeticStar ?? 0;
          const changed = preview !== current;
          const itemName = previewCosmetic ? cosmeticName(previewCosmetic) : "비어 있음";
          return <button
            type="button"
            className={`costume-slot-card costume-slot-${SLOT_SIDES[id] ?? "left"} costume-slot-${id.toLowerCase()}`}
            style={{ "--slot-row": SLOT_ROWS[id]?.row ?? 0, "--slot-rows": SLOT_ROWS[id]?.rows ?? 1 } as CSSProperties}
            key={id}
            aria-label={`${label} ${itemName}${changed ? " 미리보기" : preview ? " 착용 중" : " 선택"}`}
            aria-pressed={slot === id}
            title={itemName}
            onClick={() => {
              setSlot(id);
              setFocusedCosmeticId(preview ?? null);
            }}
          >
            {slot === id && <span className="costume-slot-selection" aria-hidden="true"><i /></span>}
            <span className={`costume-grade costume-slot-grade ${previewCosmetic ? `grade-${previewCosmetic.grade.toLowerCase()}` : "grade-empty"}`}>{previewCosmetic ? (GRADE_LABELS[previewCosmetic.grade] ?? previewCosmetic.grade) : "미착용"}</span>
            <span className={`cosmetic-star-dot${previewStar > 0 ? " is-earned" : ""}`} aria-label={`${previewStar}성`}>{previewStar}</span>
            <strong>{itemName}</strong>
            <CosmeticImage cosmetic={previewCosmetic} slot={id} compact />
            <span className="costume-slot-state">{changed ? `${label} 미리보기` : label}</span>
          </button>;
        })}
      </div>
    </section>
    <section className="costume-closet-pane" aria-label="보유 치장">
      <div className="character-slot-filter" role="tablist" aria-label="치장 부위">
        <button type="button" role="tab" aria-selected={showingAll} onClick={() => setSlot(ALL_SLOTS)}>전체</button>
        {Object.entries(SLOT_LABELS).map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={slot === id} onClick={() => setSlot(id)}>{label}</button>)}
      </div>
      <section className={`costume-set-summary${previewSet ? " has-set" : " is-single"}`} aria-label="선택 치장 요약">
        <span className="costume-set-summary__thumb" aria-hidden="true">
          {summaryCosmetic && <CosmeticImage cosmetic={summaryCosmetic} slot={summaryCosmetic.slot} compact />}
        </span>
        <span className="costume-set-summary__copy">
          <strong>{previewSet ? previewSetTitle : summaryCosmetic ? cosmeticName(summaryCosmetic) : "치장을 선택해 주세요"}</strong>
          {previewSet && <span className="costume-set-progress" aria-label={`${previewSetMembers.length}개 중 ${previewSetOwnedCount}개 보유`}>
            <span className="costume-set-progress__dots" aria-hidden="true">
              {previewSetMembers.map(([, id], index) => <i key={id} className={index < previewSetOwnedCount ? "is-filled" : ""} />)}
            </span>
            <b>{previewSetOwnedCount}/{previewSetMembers.length}</b>
          </span>}
        </span>
        {previewSet && <button
          type="button"
          disabled={pending || previewSetOwnedCount !== previewSetMembers.length || previewSetEquipCommands.length === 0}
          onClick={() => sendBatch(previewSetEquipCommands)}
        >{previewSetEquippedCount === previewSetMembers.length ? "착용 완료" : "세트 착용"}</button>}
      </section>
      {/* 고르는 순간 바로 입는다. 이미 입고 있는 것을 다시 누르면 벗는다.
          예전에는 아래쪽 막대의 착용 단추를 한 번 더 눌러야 끝났다. */}
      <ul className="character-owned costume-owned-grid">{owned.map(item => {
        const cosmetic = cosmetics.get(item.cosmeticId);
        const itemSlot = showingAll ? item.slot : activeDataSlot;
        const worn = collection.equipment[itemSlot] === item.cosmeticId;
        return <li key={item.cosmeticId}><button
          type="button"
          data-cosmetic-id={item.cosmeticId}
          aria-pressed={worn}
          aria-label={`${cosmeticName(cosmetic)} ${worn ? "벗기" : "입기"}`}
          disabled={pending}
          onClick={() => {
            const next = worn ? null : item.cosmeticId;
            setFocusedCosmeticId(item.cosmeticId);
            setDraft(current => ({ ...current, [itemSlot]: next }));
            send({ kind: "equip", slot: itemSlot, cosmeticId: next });
          }}
        >
          <CosmeticImage cosmetic={cosmetic} slot={itemSlot} />
          <span className={`costume-grade grade-${item.grade.toLowerCase()}`}>{GRADE_LABELS[item.grade] ?? item.grade}</span>
          <span className={`cosmetic-star-dot${item.cosmeticStar > 0 ? " is-earned" : ""}`} aria-label={`${item.cosmeticStar}성`}>{item.cosmeticStar}</span>
          {/* 승급에 쓴 개수는 등록분으로 넘어가므로, 아직 쓰지 않은 중복만 센다. */}
          <span className="costume-card-count" aria-label={`남은 중복 ${item.availableUnregisteredQuantity}개`}>×{item.availableUnregisteredQuantity}</span>
          <strong className="costume-card-name" data-pretext>{cosmeticName(cosmetic)}</strong>
          <span className="costume-card-meta"><b>{item.cosmeticStar}성</b><small>등록 {item.registeredQuantity}</small></span>
          {worn && <i className="costume-selected-mark" aria-hidden="true" />}
        </button></li>;
      })}
      </ul>
      {owned.length === 0 && <p className="costume-empty-state">아직 보유한 {showingAll ? "" : `${SLOT_LABELS[slot]} `}치장이 없어요</p>}
    </section>
  </div>;
}

const SET_STAR_STEPS = [1, 2, 3, 4, 5] as const;
// 다음 성급까지 모은 개수. 등록분에 아직 등록하지 않은 중복을 더하고 기준치에서 멈춘다.
// 이 값이 기준치와 같아질 때 서버가 성급 올리기를 허용한다.
type MemberState = { registeredQuantity: number; availableUnregisteredQuantity: number; cosmeticStar: number; nextStarThreshold: number | null; neededForNextStar: number | null };

// 성급 올리기 버튼에 적을 말. 가진 여분과 다음 성급에 드는 개수를 나란히 적는다.
// 서버가 주는 neededForNextStar는 다음 기준까지 더 등록해야 하는 개수다.
function upgradeAction(state?: MemberState): { label: string; hint: string; ready: boolean; counts?: [number, number]; progress?: string } {
  if (!state || state.registeredQuantity === 0) return { label: "미획득", hint: "아직 뽑지 않은 부위입니다.", ready: false };
  const needed = state.neededForNextStar;
  if (needed == null) return { label: "최대 성급", hint: "더 올릴 성급이 없습니다.", ready: false };
  const have = state.availableUnregisteredQuantity;
  const nextStar = state.cosmeticStar + 1;
  // 버튼의 필요 개수는 기준치가 아니라 남은 개수라, 같은 등급이라도 얼마나 모았느냐에 따라
  // 부위마다 다른 숫자가 뜬다. 기준치와 지금 등록 수가 없으면 옆 부위와 견줬을 때 값이 다른
  // 이유를 읽을 수 없다. title 은 손가락으로는 뜨지 않으므로 카드에도 한 줄로 내놓는다.
  // 설명 문장에서는 수량이 네 개나 나오므로 "등록"과 "여분"을 붙여 어느 수인지 못 박는다.
  const threshold = state.nextStarThreshold;
  const lead = threshold == null ? "" : `${nextStar}성은 등록 ${threshold}개부터입니다. 지금 등록은 ${state.registeredQuantity}개입니다. `;
  // 성급 번호는 lead 가 비어도 남아야 한다. 기준치를 모르는 응답에서도 무엇을 향해 모으는지는
  // 알려 줘야 하고, 이 문구가 생기기 전에도 늘 들어 있던 정보다.
  return {
    label: `${have} / ${needed}`,
    counts: [have, needed],
    progress: threshold == null ? undefined : `${nextStar}성 등록 ${threshold} · 지금 ${state.registeredQuantity}`,
    hint: have >= needed
      ? `${lead}여분 ${needed}개를 넣으면 ${nextStar}성이 됩니다.`
      : `${lead}${nextStar}성까지 ${needed}개 더 필요한데 여분은 ${have}개입니다.`,
    ready: have >= needed,
  };
}
// 중앙 제목은 "<세트 이름> 세트"로 읽는다. 콘텐츠 표시명이 이미 "세트"로 끝나면 덧붙이지 않는다.
const setTitle = (name: string) => (name.endsWith("세트") ? name : `${name} 세트`);
const SET_CREATORS: Readonly<Record<string, string>> = {
  "cosmetic-set-16": "골판지크레용",
  "cosmetic-set-20": "저게뭐시당",
  "cosmetic-set-21": "저게뭐시당",
  "cosmetic-set-22": "🤘야르🤘",
  "cosmetic-set-23": "🤘야르🤘",
  "cosmetic-set-25": "저게뭐시당",
};
type GalleryFilter = "all" | "complete" | "missing";
const PRIMARY_EFFECTS = ["attackPercent", "maxHpPercent", "defensePenetrationPercent"];

function galleryEffectIcon(statId: string) {
  if (statId.toLowerCase().includes("hp")) return heartIcon;
  if (statId.toLowerCase().includes("defense")) return defenseShieldIcon;
  return swordIcon;
}

export function GalleryPanel({ collection, catalog, pending, send }: Props) {
  const [selectedId, setSelectedId] = useState(() => [...catalog.sets].sort(compareCosmeticGrade)[0]?.setId ?? "");
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const setProgress = catalog.sets.map(set => {
    const memberIds = Object.values(set.members).filter(Boolean);
    const registeredCount = memberIds.filter(id => collection.states.some(state => state.cosmeticId === id && state.registeredQuantity > 0)).length;
    return { set, memberCount: memberIds.length, registeredCount, complete: memberIds.length > 0 && registeredCount === memberIds.length };
  }).sort((left, right) => compareCosmeticGrade(left.set, right.set));
  const visibleSets = setProgress.filter(item => filter === "all" || (filter === "complete" ? item.complete : !item.complete));
  const selectedProgress = visibleSets.find(item => item.set.setId === selectedId) ?? visibleSets[0] ?? setProgress[0];
  if (!selectedProgress) return <p>등록된 세트가 없습니다.</p>;
  const selected = selectedProgress.set;
  const selectedCreator = SET_CREATORS[selected.setId];
  const setStar = collection.setStars[selected.setId] ?? 0;
  const selectedMembers = Object.entries(SET_SLOT_LABELS).map(([slot, label]) => {
    const dataSlot = slot === "BOTTOM" && !selected.members.BOTTOM && selected.members.WEAPON ? "WEAPON" : slot;
    const id = selected.members[dataSlot];
    const cosmetic = catalog.cosmetics.find(item => item.cosmeticId === id);
    const state = collection.states.find(item => item.cosmeticId === id);
    return { slot, label, dataSlot, id, cosmetic, state };
  });
  const currentSetEffects = collection.setEffects[selected.setId] ?? [];
  const nextEffect = Object.entries(selected.effects)
    .map(([star, effects]) => ({ star: Number(star), effects }))
    .filter(item => item.star > setStar)
    .sort((left, right) => left.star - right.star)[0];
  const completedSets = setProgress.filter(item => item.complete).length;
  const upgradeableCount = collection.states.filter(state => state.canUpgrade).length;
  const nextByStat = new Map((nextEffect?.effects ?? []).map(effect => [effect.statId, effect]));
  const mergedEffects = [
    ...currentSetEffects.map(effect => ({ statId: effect.statId, current: effect, next: nextByStat.get(effect.statId) })),
    ...(nextEffect?.effects ?? []).filter(effect => !currentSetEffects.some(item => item.statId === effect.statId)).map(effect => ({ statId: effect.statId, current: undefined, next: effect })),
  ];

  return <div className="character-two-columns character-gallery">
    <section className="gallery-set-panel" aria-label="세트 목록">
      <header className="gallery-panel-title">
        <img src={collectionBookIcon} alt="" />
        <h3>세트 목록</h3>
        <span><small>전체</small><b>{collection.uniqueRegisteredCount}</b> / {catalog.cosmetics.length}</span>
      </header>
      <div className="gallery-set-filters" role="tablist" aria-label="도감 세트 필터">
        {([["전체", "all"], ["완성", "complete"], ["미보유", "missing"]] as const).map(([label, id]) => <button
          type="button"
          role="tab"
          key={id}
          aria-selected={filter === id}
          onClick={() => setFilter(id)}
        >{label}</button>)}
      </div>
      <button
        type="button"
        className="gallery-bulk-upgrade"
        disabled={pending || upgradeableCount === 0}
        onClick={() => send({ kind: "bulkRegister" })}
      >
        <span>일괄 업그레이드</span>
        <b>{upgradeableCount}</b>
      </button>
      <div className="gallery-set-list">
        {visibleSets.map(({ set, memberCount, registeredCount }) => {
          const itemStar = collection.setStars[set.setId] ?? 0;
          return <button type="button" className={`grade-${set.grade.toLowerCase()}`} key={set.setId} aria-pressed={selected.setId === set.setId} onClick={() => setSelectedId(set.setId)}>
            <span className="gallery-set-thumb cosmetic-hero-layers" aria-hidden="true">
              {composeCosmeticSetHero(set, catalog).map(layer => <img key={layer} src={layer} alt="" />)}
            </span>
            <span className="gallery-set-copy">
              <strong>{cosmeticSetName(set) ?? setFallbackName(set.setId)}<i className={`gallery-set-grade grade-${set.grade.toLowerCase()}`}>{GRADE_LABELS[set.grade] ?? set.grade}</i></strong>
              <span className="gallery-set-meta"><span><img src={collectionPieceIcon} alt="" />{registeredCount} / {memberCount}</span><span><img src={itemStar > 0 ? setEffectStarActive : setEffectStarLocked} alt="" />{itemStar}성</span></span>
            </span>
            <i aria-hidden="true">›</i>
          </button>;
        })}
        {visibleSets.length === 0 && <p className="gallery-empty-list">해당하는 세트가 없습니다.</p>}
      </div>
    </section>

    <section className="gallery-detail-panel" aria-label="선택 세트 상세">
      <header className="gallery-set-title">
        <h3>{setTitle(cosmeticSetName(selected) ?? setFallbackName(selected.setId))}</h3>
        {selectedCreator && <span className="gallery-set-creator">made by {selectedCreator}</span>}
      </header>
      <ul className="gallery-member-grid">{selectedMembers.map(({ slot, label, dataSlot, id, cosmetic, state }) => {
        const star = state?.cosmeticStar ?? 0;
        const action = upgradeAction(state);
        return <li key={slot} className={(state?.registeredQuantity ?? 0) > 0 ? "" : "is-missing"} data-cosmetic-id={id}>
          <strong>{label}</strong>
          <span className={`cosmetic-star-dot${star > 0 ? " is-earned" : ""}`} aria-hidden="true">{star}</span>
          <span className="gallery-member-art"><CosmeticImage cosmetic={cosmetic} slot={dataSlot} /></span>
          <button
            type="button"
            className={`gallery-member-upgrade${action.ready ? " is-ready" : ""}`}
            disabled={pending || !id || !state?.canUpgrade}
            title={action.hint}
            aria-label={`${cosmeticName(cosmetic)} ${action.hint}`}
            onClick={() => id && send({ kind: "register", cosmeticId: id })}
          >{action.counts && <img src={collectionPieceIcon} alt="" />}{action.label}</button>
        </li>;
      })}</ul>
      <section className="gallery-set-effects" aria-label="선택 세트 성급">
        <div className="gallery-star-track" style={{ "--gallery-progress": Math.max(0, Math.min(setStar - 1, 4)) } as CSSProperties}>{SET_STAR_STEPS.map(star => <span key={star} className={star <= setStar ? "is-active" : ""}>
          <img src={star <= setStar ? setEffectStarActive : setEffectStarLocked} alt="" />
          <b>{star}성</b>
        </span>)}</div>
      </section>
    </section>

    <section className="gallery-total-panel" aria-label="세트 효과">
      <header className="gallery-panel-title">
        <img src={collectionEffectBoxIcon} alt="" />
        <h3>세트 효과</h3>
      </header>
      <section className="gallery-selected-effect" aria-label="선택 세트 효과">
        <header><strong>{setTitle(cosmeticSetName(selected) ?? setFallbackName(selected.setId))} · {setStar}성</strong></header>
        {mergedEffects.length > 0
        ? <ul className="gallery-selected-effects-list">
          {mergedEffects.map(({ statId, current, next }) => <li key={statId} className={current ? "" : "is-locked"}>
            <img src={galleryEffectIcon(statId)} alt="" />
            <strong>{STAT_LABELS[statId] ?? statId}</strong>
            <span>{current ? effectValueText(current) : "—"}</span>
            {current && next && <i aria-hidden="true">›</i>}
            {next && <b aria-label={`${nextEffect?.star}성 달성 시 ${effectValueText(next)}`}><img src={setEffectStarLocked} alt="" />{effectValueText(next)}</b>}
          </li>)}
        </ul>
        : <p className="gallery-no-effects">세트를 완성하면 1성 효과가 켜집니다.</p>}
      </section>
      <section className="gallery-account-effects" aria-label="전체 세트 효과">
        <header><strong>총 세트 효과</strong></header>
        <ul>{PRIMARY_EFFECTS.map(statId => {
          const effect = collection.totalEffects.find(item => item.statId === statId);
          return <li key={statId} aria-label={`${STAT_LABELS[statId] ?? statId} ${effect ? effectValueText(effect) : "0%"}`}>
            <img src={galleryEffectIcon(statId)} alt="" />
            <strong>{effect ? effectValueText(effect) : "0%"}</strong>
          </li>;
        })}</ul>
      </section>
      <div className="gallery-complete-count"><span>완성 세트</span><strong>{completedSets} / {catalog.sets.length}</strong></div>
      <img className="gallery-sign-decoration" src={collectionSignDecoration} alt="도감 완성 장식" />
    </section>
  </div>;
}
