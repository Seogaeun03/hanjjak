import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  BattleGrowthNavigation,
  FirstClearRewardNotice,
  BattleStageRestartButton,
  BattleHistoryPopover,
  BattlePlayerStatus,
  BattleProfileSummary,
  BattleRewards,
  BattleStageProgress,
  BattleUtilityNavigation,
  CozySharedNavigation,
  type BattleHudRoute,
} from "./BattleHud";
import { CharacterWindow } from "../character/CharacterWindow";
import type { CharacterCollection, CharacterCommand, CharacterStats, CosmeticCatalog } from "../character/api";
import { EquipmentScreen, EquipmentWindow } from "../equipment/EquipmentScreen";
import type { EquipmentSlot, EquipmentState } from "../equipment/api";
import { InventoryScreen, InventoryWindow, type InventoryDataSource } from "../inventory/InventoryScreen";
import type { InventoryItem, InventorySort } from "../inventory/api";
import { MarketPlaza, type MarketMode } from "../market/MarketPlaza";
import { GlobalOverlayWindow } from "../../shared/GlobalOverlayWindow";
import { MailScreen, type MailDataSource, type NoticeDataSource } from "../mail/MailScreen";
import type { MailMessage, Notice } from "../mail/api";
import { selectMarketItemForSale } from "../market/marketUiState";
import { ProfileScreen, type ProfileTab } from "../profile/ProfileScreen";
import { RankingScreen } from "../ranking/RankingScreen";
import type { CombatPowerRanking, MaterialType, RankingAppearance, RankingEntry } from "../ranking/api";
import { LiveopsScreen, type LiveopsDataSource } from "../liveops/LiveopsScreen";
import type { LiveopsDrawResult, LiveopsState } from "../liveops/api";
import { SkillsScreen, SkillWindow } from "../skills/SkillsScreen";
import { PictureInPictureController } from "../picture-in-picture/PictureInPictureController";
import { TutorialDialogue } from "../tutorial/TutorialDialogue";
import { TutorialLauncher } from "../tutorial/TutorialLauncher";
import { TUTORIAL_PREVIEW_CHAPTERS, type TutorialPreviewStep } from "../tutorial/tutorialPreviewCatalog";
import type { TutorialRuntimeSurface } from "../tutorial/tutorialRuntimeCatalog";
import { ChatPanel } from "../chat/ChatPanel";
import type { ChatPage } from "../chat/api";
import { CosmeticGachaBoard, CosmeticWalletBalance } from "../cosmetics/CosmeticGachaBoard";
import { CosmeticDrawReveal } from "../cosmetics/CosmeticDrawReveal";
import { CosmeticBoxClaimedDialog } from "../cosmetics/CosmeticBoxClaimedDialog";
import type { Banner as CosmeticBanner, Catalog as GachaCatalog, Collection as GachaCollection, DrawResponse as CosmeticDrawResponse } from "../cosmetics/api";
import type { SkillVfx } from "../gems/skillVfx";
import type { GemFusionMode, GemFusionResult, GemOption, GemState, GemSummary } from "../gems/api";
import { GemsScreen } from "../gems/GemsScreen";
import { GemManagement } from "../gems/GemManagement";
import { CostumePanel, GalleryPanel } from "../character/CosmeticPanels";
import { BossArrivalWarning, ChapterOneMonster } from "./BattleScreen";
import type { BattleHistoryEvent, RewardLine } from "./api";
import { backgroundAsset, MONSTER_NAMES, stageVisual, type ChapterOneMonsterId } from "./battleVisuals";
import { PlayerBattleCharacter } from "../gems/PlayerBattleCharacter";
import appliedCosmeticContentJson from "../../../../../packages/game-content/versions/v1/cosmetics/cosmetics.json";
import { SET_ART_SLUGS } from "../cosmetics/cosmetic-art-map";
import "../../styles.css";
import "../cosmetics/cosmetics.css";
import { useHudScale } from "./useHudScale";
import "./BattleScreen.css";
import "./battle-hud-preview.css";
import "../../app-shell.css";

/* 1챕터는 다 깼고, 2챕터는 도중이며, 3챕터는 막 열렸고, 4챕터는 아직 잠겼다. */
const PREVIEW_CHAPTER_PROGRESS: Record<number, { unlockedThrough: number; clearedThrough: number }> = {
  1: { unlockedThrough: 10, clearedThrough: 10 },
  2: { unlockedThrough: 10, clearedThrough: 6 },
  3: { unlockedThrough: 2, clearedThrough: 1 },
  4: { unlockedThrough: 0, clearedThrough: 0 },
};
const INITIAL_PREVIEW_REWARD_RICE = 1_284;
const INITIAL_PREVIEW_REWARDS: RewardLine[] = [
  { itemId: "SWEET_POTATO_M1", requestedQuantity: 12, grantedQuantity: 12, discardedQuantity: 0 },
  { itemId: "CORN_M1", requestedQuantity: 3, grantedQuantity: 3, discardedQuantity: 0 },
  { itemId: "POTATO_M1", requestedQuantity: 7, grantedQuantity: 7, discardedQuantity: 0 },
  { itemId: "skillbook:active_dot:normal", requestedQuantity: 1, grantedQuantity: 1, discardedQuantity: 0 },
];
const stages = [1, 2, 3, 4].flatMap((chapter) => Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  const progress = PREVIEW_CHAPTER_PROGRESS[chapter];
  const stageId = `stage.${String(chapter).padStart(2, "0")}-${String(number).padStart(2, "0")}`;
  const bossOnly = number === 10;
  return {
    stageId,
    unlocked: number <= progress.unlockedThrough,
    clearCount: number <= progress.clearedThrough ? 3 : 0,
    contentVersion: "preview",
    isCurrent: stageId === "stage.01-07",
    isRepeatTarget: false,
    repeatEligible: !bossOnly,
    normalMonsterIds: [],
    bossMonsterId: bossOnly ? "strawberry-siru" : null,
    backgroundId: bossOnly ? "oven-cellar" : null,
    bossOnly,
  };
}));

const previewGemOptionNames: Record<GemOption, string> = {
  FLAT_ATTACK: "고정 공격력",
  FLAT_HP: "고정 최대 HP",
  ATTACK_PERCENT: "공격력%",
  FLAT_PENETRATION: "고정 방어 관통",
  CRITICAL_CHANCE: "치명타 확률",
  HASTE: "공격속도",
};
const previewGem = (gemId: string, level: number, option: GemOption): GemSummary => ({
  gemId,
  slotId: `${gemId}-slot`,
  level,
  option,
  optionName: previewGemOptionNames[option],
  value: level * 100,
  locked: false,
  reservedForSale: false,
  equippedPresets: [],
});
const previewTutorialGemState: GemState = {
  unlocked: true,
  tickets: 3,
  secondsUntilNextTicket: 27_142,
  todayBoss: "SURVIVAL",
  gemBoxQuantity: 12,
  gems: [
    previewGem("tutorial-equip-gem", 1, "FLAT_HP"),
    previewGem("tutorial-fusion-gem-1", 2, "ATTACK_PERCENT"),
    previewGem("tutorial-fusion-gem-2", 2, "ATTACK_PERCENT"),
    previewGem("tutorial-fusion-gem-3", 2, "ATTACK_PERCENT"),
  ],
  presets: {},
  lockedPresets: [],
  contentVersion: "preview-tutorial",
};

const previewSkillAction = (kind: "ENHANCE" | "PROMOTE", riceCost: number, bookCost: number) => ({
  kind,
  targetGrade: kind === "PROMOTE" ? "RARE" : null,
  targetLevel: kind === "PROMOTE" ? 1 : 2,
  books: [{ itemId: "SKILL_BOOK", displayName: "스킬 비법서", requiredQuantity: bookCost, availableQuantity: 38 }],
  riceCost,
  successBasisPoints: kind === "PROMOTE" ? 10_000 : 7_000,
  executable: true,
  disabledReason: null,
});

const previewSkillState = {
  riceBalance: 61_238,
  activeLoadout: ["active_haste", "active_dot", "active_basic_amp", "active_heavy"],
  skills: [
    { skillId: "active_heavy", name: "한짝의 일격", active: true, unlocked: true, grade: "NORMAL", gradeName: "노말", level: 10, equippedSlot: null, effectText: "강한 일격으로 공격력의 455% 피해", action: previewSkillAction("PROMOTE", 1_000, 4) },
    { skillId: "active_dot", name: "마! 쫄이나", active: true, unlocked: true, grade: "NORMAL", gradeName: "노말", level: 7, equippedSlot: 2, effectText: "5초 동안 총 865% 지속 피해", action: previewSkillAction("ENHANCE", 300, 2) },
    { skillId: "active_haste", name: "잘게 더 잘게!", active: true, unlocked: true, grade: "NORMAL", gradeName: "노말", level: 7, equippedSlot: 1, effectText: "8초 동안 공격 속도 18% 증가", action: previewSkillAction("ENHANCE", 210, 2) },
    { skillId: "active_basic_amp", name: "화력 최대로", active: true, unlocked: true, grade: "NORMAL", gradeName: "노말", level: 7, equippedSlot: 3, effectText: "10초 동안 기본 공격 피해 24% 증가", action: previewSkillAction("ENHANCE", 210, 2) },
    { skillId: "passive_critical", name: "회심의 간", active: false, unlocked: true, grade: "NORMAL", gradeName: "노말", level: 7, equippedSlot: null, effectText: "치명타 확률 7%, 치명타 피해 14% 증가", action: previewSkillAction("ENHANCE", 210, 2) },
    { skillId: "passive_all_damage", name: "오늘의 특선", active: false, unlocked: true, grade: "NORMAL", gradeName: "노말", level: 7, equippedSlot: null, effectText: "모든 피해 12% 증가", action: previewSkillAction("ENHANCE", 210, 2) },
  ],
};

const previewMarketInstrument = {
  instrumentId: "preview-potato-m1",
  canonicalKey: "material:potato_m1",
  itemId: "POTATO_M1",
  displayName: "감자 한 조각",
  category: "MATERIAL",
  attributes: {},
  status: "ACTIVE",
  bestBidUnitPrice: 90,
  bestAskUnitPrice: 95,
  lastTradeUnitPrice: 92,
  marketRevision: 1,
};

const MATERIAL_FAMILIES: Array<[string, string[]]> = [
  ["POTATO", ["감자 한 조각", "미니 감자", "감자", "황금 감자", "전설 감자"]],
  ["SWEET_POTATO", ["고구마 한 조각", "미니 고구마", "고구마", "황금 고구마", "전설 고구마"]],
  ["CORN", ["옥수수 한 알", "미니 옥수수", "옥수수", "황금 옥수수", "전설 옥수수"]],
];
const SKILL_BOOK_TITLES: Array<[string, string]> = [
  ["active_heavy", "한짝의 일격"], ["active_dot", "마! 쫄이나"], ["active_haste", "잘게 더 잘게!"],
  ["active_basic_amp", "화력 최대로!"], ["passive_critical", "회심의 간"], ["passive_all_damage", "오늘의 특선"],
];
const SKILL_BOOK_GRADE_NAMES: Array<[string, string]> = [["normal", "노말"], ["rare", "희귀"], ["epic", "영웅"], ["legendary", "전설"]];
const GEM_OPTIONS: Array<[string, string, number[]]> = [
  ["flat_attack", "고정 공격력", [0, 3, 7, 15, 32, 70, 150, 320]],
  ["flat_hp", "고정 최대 HP", [0, 30, 70, 150, 320, 700, 1500, 3200]],
  ["attack_percent", "공격력%", [0, 1500, 1500, 1500, 1500, 1500, 800, 1500]],
  ["flat_penetration", "고정 방어 관통", [0, 120, 120, 120, 120, 120, 60, 120]],
  ["critical_chance", "치명타 확률", [0, 1200, 1200, 1200, 1200, 1200, 1200, 1200]],
  ["attack_speed", "공격속도", [0, 1200, 1200, 1200, 1200, 1200, 1200, 1200]],
];

/** 서버가 돌려주는 거래 품목 목록. 매물이 없어도 목록에는 늘 들어 있다. */
function previewMarketCatalog() {
  const catalog: Array<Record<string, unknown>> = [];
  const add = (canonicalKey: string, itemId: string, displayName: string, category: string, attributes: Record<string, string>) => catalog.push({
    instrumentId: `preview-${canonicalKey.replace(/[:]/g, "-")}`, canonicalKey, itemId, displayName, category, attributes,
    status: "ACTIVE", bestBidUnitPrice: null, bestAskUnitPrice: null, lastTradeUnitPrice: null, marketRevision: 1,
  });
  for (const [family, names] of MATERIAL_FAMILIES) for (let generation = 1; generation <= 5; generation += 1) {
    const itemId = `${family}_M${generation}`;
    add(`material:${itemId.toLowerCase()}`, itemId, names[generation - 1], "MATERIAL", { itemId });
  }
  for (const [skillId, title] of SKILL_BOOK_TITLES) for (const [gradeId, gradeName] of SKILL_BOOK_GRADE_NAMES) {
    add(`skillbook:${skillId}:${gradeId}`, `skillbook:${skillId}:${gradeId}`, `${gradeName} ${title} 비법서`, "SKILL_BOOK", { skillId, grade: gradeId });
  }
  for (let level = 1; level <= 7; level += 1) for (const [option, optionName, values] of GEM_OPTIONS) {
    const value = values[level];
    add(`gem:${level}:${option}:${value}`, `gem:${level}:${option}`, `${level}레벨 ${optionName} 보석`, "GEM", { level: String(level), option, value: String(value) });
  }
  /* 시세가 붙어 있는 하나는 그대로 둔다. 사고파는 흐름을 미리보기에서 눌러 볼 수 있어야 한다. */
  return catalog.map(item => item.itemId === previewMarketInstrument.itemId ? previewMarketInstrument : item);
}

/* 메시지함은 운영자가 보낸 것만 담는다. 거래소 정산은 거래소 받기 칸이 맡는다. */
const previewMails: MailMessage[] = [
  { mailId: "mail-1", type: "ADMIN_GIFT", riceAmount: 12_400, rewardStatus: "PENDING", createdAt: "2026-09-13T09:20:00Z", claimedAt: null, title: "복귀 감사 선물", body: "다시 찾아 주셔서 고맙습니다.", senderName: "한짝 운영팀", readAt: null, rewards: [] },
  { mailId: "mail-2", type: "ADMIN_GIFT", riceAmount: 3_150, rewardStatus: "PENDING", createdAt: "2026-09-12T18:05:00Z", claimedAt: null, title: "9월 점검 보상", body: "점검이 길어져 죄송합니다. 작은 보상을 함께 보냅니다.", senderName: "한짝 운영팀", readAt: null, rewards: [{ kind: "ITEM", quantity: 10, itemId: "POTATO_M3", displayName: "감자" }] },
  { mailId: "mail-3", type: "ADMIN_GIFT", riceAmount: 880, rewardStatus: "CLAIMED", createdAt: "2026-09-11T07:40:00Z", claimedAt: "2026-09-11T08:00:00Z", title: "지난 이벤트 보상", body: "받아 가셨습니다.", senderName: "한짝 운영팀", readAt: "2026-09-11T08:00:00Z", rewards: [] },
];
const previewNotices: Notice[] = [
  { noticeId: "notice-1", title: "9월 15일 점검 안내", body: "오전 4시부터 6시까지 점검이 있습니다.", senderName: "한짝 운영팀", publishedAt: "2026-09-14T09:00:00Z", expiresAt: null, readAt: null },
];
const previewMailDataSource: MailDataSource = {
  list: async () => ({ items: previewMails, nextCursor: null, totalItems: previewMails.length }),
  claim: async (mailId: string) => ({ commandId: "preview", idempotencyKey: "preview", status: "SUCCEEDED", result: { mailId, riceAmount: 0, claimedAt: "", walletBalance: 0, rewards: [] } }),
  claimAll: async () => ({ commandId: "preview", idempotencyKey: "preview", status: "SUCCEEDED", result: { claimedMailIds: [], totalRiceAmount: 0, walletBalance: 0, rewards: [] } }),
  read: async (mailId: string) => {
    const readAt = "2026-09-15T00:00:00Z";
    const mail = previewMails.find((item) => item.mailId === mailId);
    if (mail) mail.readAt = readAt;
    return { mailId, readAt };
  },
  remove: async (mailId: string) => ({ mailId, deletedAt: "2026-09-15T00:00:00Z" }),
};
const previewNoticeDataSource: NoticeDataSource = {
  list: async () => ({ items: previewNotices, unreadCount: previewNotices.filter((notice) => notice.readAt == null).length }),
  read: async (noticeId: string) => {
    const readAt = "2026-09-15T00:00:00Z";
    const notice = previewNotices.find((item) => item.noticeId === noticeId);
    if (notice) notice.readAt = readAt;
    return { noticeId, readAt };
  },
  remove: async (noticeId: string) => ({ noticeId, deletedAt: "2026-09-15T00:00:00Z" }),
};

const previewAccount = { accountId: "preview", characterId: "preview", email: "player@example.com", nickname: "한짝", level: 24, experience: 18_720, rice: 15_820 };
const previewInventorySeeds: Array<[string, string, number]> = [
  ["POTATO_M1", "감자 한 조각", 530],
  ["POTATO_M2", "미니 감자", 999],
  ["POTATO_M3", "감자", 430],
  ["POTATO_M4", "황금 감자", 88],
  ["POTATO_M5", "전설 감자", 12],
  ["SWEET_POTATO_M1", "고구마 한 조각", 777],
  ["SWEET_POTATO_M2", "미니 고구마", 999],
  ["SWEET_POTATO_M3", "고구마", 412],
  ["SWEET_POTATO_M4", "황금 고구마", 71],
  ["SWEET_POTATO_M5", "전설 고구마", 9],
  ["CORN_M1", "옥수수 한 알", 650],
  ["CORN_M2", "미니 옥수수", 265],
  ["CORN_M3", "옥수수", 321],
  ["CORN_M4", "황금 옥수수", 54],
  ["CORN_M5", "전설 옥수수", 7],
];
const previewMaterialItems: InventoryItem[] = previewInventorySeeds.map(([itemId, name, quantity], index) => {
  const generation = Number(itemId.match(/_M([1-5])$/)?.[1] ?? 1);
  return {
    itemId,
    instanceId: null,
    slotId: `stack:${itemId}:0`,
    members: [],
    acquiredSequence: previewInventorySeeds.length - index,
    name,
    icon: "",
    category: "MATERIAL",
    description: `장비 제작과 강화에 사용하는 ${generation}세대 재료`,
    acquisitionSources: ["자동 파밍"],
    usages: ["장비 제작", "장비 강화"],
    tradeable: true,
    totalQuantity: quantity,
    reservedQuantity: 0,
    availableQuantity: quantity,
  };
});
const previewSkillBookSeeds: Array<[string, string]> = [
  ["active_heavy", "한짝의 일격"],
  ["active_dot", "마! 쫄이나"],
  ["active_haste", "잘게 더 잘게!"],
  ["active_basic_amp", "화력 최대로!"],
  ["passive_critical", "회심의 간"],
  ["passive_all_damage", "오늘의 특선"],
];
const previewSkillBookItems: InventoryItem[] = previewSkillBookSeeds.map(([skillId, name], index) => ({
  itemId: `skillbook:${skillId}:normal`,
  instanceId: null,
  slotId: `stack:skillbook:${skillId}:normal:0`,
  members: [],
  acquiredSequence: 100 - index,
  name: `노말 ${name} 비법서`,
  icon: "",
  category: "SKILL_BOOK",
  description: `${name} 스킬의 노말 등급 성장에 사용하는 전용 스킬북입니다.`,
  acquisitionSources: ["자동 파밍"],
  usages: ["스킬 강화"],
  tradeable: true,
  totalQuantity: 10 + index,
  reservedQuantity: 0,
  availableQuantity: 10 + index,
}));
const previewCosmeticBox: InventoryItem = {
  itemId: "cosmetic-selector-box-01", instanceId: null, slotId: "stack:cosmetic-selector-box-01:0", members: [], acquiredSequence: 200,
  name: "치장 선택권 박스", icon: "", category: "COSMETIC_BOX",
  description: "열어서 전설 치장 하나를 직접 골라 받는 상자입니다.", acquisitionSources: ["치장 뽑기 마일스톤 수령"], usages: ["치장 선택 상자 개봉"], tradeable: false,
  totalQuantity: 2, reservedQuantity: 0, availableQuantity: 2,
};
const previewInventoryItems = [previewCosmeticBox, ...previewSkillBookItems, ...previewMaterialItems];
const previewInventorySort = (items: InventoryItem[], sort: InventorySort) => [...items].sort((left, right) => {
  if (sort === "NAME_ASC") return left.name.localeCompare(right.name, "ko");
  if (sort === "NAME_DESC") return right.name.localeCompare(left.name, "ko");
  if (sort === "QUANTITY_ASC") return left.totalQuantity - right.totalQuantity;
  if (sort === "QUANTITY_DESC") return right.totalQuantity - left.totalQuantity;
  return right.acquiredSequence - left.acquiredSequence;
});
const previewInventoryDataSource: InventoryDataSource = {
  list: async (category, sort, cursor) => {
    const offset = Number(cursor ?? 0);
    const filtered = previewInventoryItems.filter((item) => category === "ALL" || item.category === category);
    const sorted = previewInventorySort(filtered, sort);
    return {
      items: sorted.slice(offset, offset + 12),
      usedSlots: previewInventoryItems.length,
      maxSlots: 200,
      isFull: false,
      nextCursor: offset + 12 < sorted.length ? String(offset + 12) : null,
    };
  },
  detail: async (itemId) => {
    const item = previewInventoryItems.find((entry) => entry.itemId === itemId);
    if (!item) throw new Error("PREVIEW_INVENTORY_ITEM_NOT_FOUND");
    return { ...item, slotId: null };
  },
};
/* 칸마다 보여 줄 그림은 "젓가락이 그 부위를 착용한 전신"이 아니라 부위 아이콘이다.
   전신 그림을 넣으면 여섯 칸이 전부 비슷해져서 무엇을 고르는지 알 수 없었다.
   실제 화면이 쓰는 `public/cosmetics/item-icons` 를 그대로 가리킨다. */
const previewItemIcon = (slug: string, suffix: string) => `/cosmetics/item-icons/${slug}-${suffix}.png`;
const PREVIEW_SLOT_SUFFIX: Record<string, string> = { HEAD: "head", TOP: "top", BOTTOM: "bottom", GLOVES: "gloves", SHOES: "shoes", CAPE: "cape" };

type AppliedCosmeticContent = {
  contentVersion: string;
  starThresholdsByGrade: Record<string, number[]>;
  cosmetics: Array<{ cosmeticId: string; displayName: string | null; imageUrl: string | null; grade: string; slot: string; setId: string | null }>;
  sets: Array<{ setId: string; displayName: string | null; grade: string; members: Record<string, string>; effects: Array<{ star: number; effects: Array<{ statId: string; value: number; unit: string }> }> }>;
};
const appliedCosmeticContent = appliedCosmeticContentJson as AppliedCosmeticContent;
/** 실제 적용 카탈로그 190종을 모두 보유한 계정으로 검수한다. */
const previewCosmetics: CosmeticCatalog["cosmetics"] = appliedCosmeticContent.cosmetics.map((item) => ({ ...item }));
const previewCosmeticCatalog: CosmeticCatalog = {
  contentVersion: appliedCosmeticContent.contentVersion,
  cosmetics: previewCosmetics,
  sets: appliedCosmeticContent.sets.map((set) => ({
    setId: set.setId,
    displayName: set.displayName,
    previewImageUrl: previewItemIcon(SET_ART_SLUGS[set.setId], "top"),
    grade: set.grade,
    members: set.members,
    effects: Object.fromEntries(set.effects.map((row) => [row.star, row.effects])),
  })),
};
const previewCosmeticCollection: CharacterCollection = {
  contentVersion: appliedCosmeticContent.contentVersion,
  states: previewCosmetics.map((item) => {
    const star = 1;
    const thresholds = appliedCosmeticContent.starThresholdsByGrade[item.grade]!;
    const registered = thresholds[0]!;
    const nextThreshold = item.slot === "FACE" ? null : thresholds[1] ?? null;
    const needed = nextThreshold == null ? null : nextThreshold - registered;
    const spare = 0;
    return {
      ...item,
      registeredQuantity: registered,
      unregisteredQuantity: spare,
      reservedQuantity: 0,
      availableUnregisteredQuantity: spare,
      cosmeticStar: star,
      nextStarThreshold: nextThreshold,
      neededForNextStar: needed,
      canUpgrade: needed != null && spare >= needed,
      upgradeDisabledReason: needed != null && spare >= needed ? null : "INSUFFICIENT_DUPLICATES",
    };
  }),
  color: null, equipment: { HEAD: "cosmetic-075", TOP: "cosmetic-076", BOTTOM: "cosmetic-077", GLOVES: "cosmetic-078", SHOES: "cosmetic-079", CAPE: "cosmetic-080", FACE: null },
  uniqueRegisteredCount: previewCosmetics.length,
  setStars: Object.fromEntries(previewCosmeticCatalog.sets.map(set => [set.setId, 1])),
  setEffects: Object.fromEntries(previewCosmeticCatalog.sets.map(set => [set.setId, set.effects[1] ?? []])),
  totalEffects: ["attackPercent", "maxHpPercent", "defensePenetrationPercent"].map(statId => ({
    statId,
    value: previewCosmeticCatalog.sets.reduce((sum, set) => sum + ((set.effects[1] ?? []).find(effect => effect.statId === statId)?.value ?? 0), 0),
    unit: "BASIS_POINTS",
  })),
};
const previewCharacterStat = (statId: string, label: string, total: number, unit = "FLAT"): CharacterStats["stats"][number] => ({
  statId, label, total, unit, base: total, additional: 0, calculation: `${label} ${total}`,
  sources: [{ sourceId: "preview", label: "미리보기", category: "BASE", value: total, unit, applied: true, reason: null }],
});
const previewCharacterStats: CharacterStats = {
  nickname: "한짝", level: 24, experience: 290_976, combatPower: 15_820,
  cosmeticsUnlocked: true, contentVersion: "preview-cosmetics-v1",
  stats: [
    previewCharacterStat("maxHp", "최대 HP", 3_680),
    previewCharacterStat("attack", "공격력", 151),
    previewCharacterStat("penetration", "관통력", 45),
    previewCharacterStat("criticalChance", "치명타 확률", 500, "BASIS_POINTS"),
    previewCharacterStat("basicAttackDamage", "기본공격 피해", 20_000, "BASIS_POINTS"),
    previewCharacterStat("allDamage", "피해량 증가", 0, "BASIS_POINTS"),
    previewCharacterStat("attackSpeed", "공격속도", 100, "BASIS_POINTS"),
    previewCharacterStat("buffDuration", "버프 지속시간", 0, "SECONDS"),
  ],
};
const previewCharacterData = { stats: previewCharacterStats, collection: previewCosmeticCollection, catalog: previewCosmeticCatalog };
const previewCosmeticBanner: CosmeticBanner = {
  bannerId: "cosmetic-banner-01",
  setId: "cosmetic-set-01",
  displayName: "거북이 수호자 세트",
  singleRiceCost: 5_000,
  ticketBalance: 4,
  riceBalance: 50_000,
  oneDraw: { ticketCost: 1, riceCost: 0, executable: true },
  tenDraw: { ticketCost: 4, riceCost: 30_000, executable: true },
  milestone: { totalSuccessfulDraws: 199, claimedBoxCount: 0, claimableBoxCount: 0, drawsUntilNextBox: 1, boxItemId: "cosmetic-selector-box-01", ownedBoxQuantity: 0 },
};
/* 최신 메시지가 앞에 온다. 화면은 이 목록을 뒤집어 아래로 쌓는다.
   내 계정(previewAccount)의 accountId 가 "preview" 라서 그 줄만 닉네임이 커지고,
   gameMaster 가 붙은 줄에만 무지개 GM 칩이 달린다. */
const previewChat: ChatPage = {
  items: [
    { messageId: "preview-chat-11", accountId: "preview-corn", nickname: "옥수수왕", primaryMaterialType: "CORN", body: "반가워요 :)", createdAt: "2026-09-10T10:04:00+09:00", eventId: "preview-chat-event-11" },
    { messageId: "preview-chat-10", accountId: "preview", nickname: "한짝", primaryMaterialType: "POTATO", body: "저도 낄게요! 재료는 넉넉합니다", createdAt: "2026-09-10T10:03:30+09:00", eventId: "preview-chat-event-10" },
    { messageId: "preview-chat-9", accountId: "preview-mill", nickname: "방앗간막내", primaryMaterialType: "CORN", body: "4-7 보스 같이 도실 분 두 분만 더요", createdAt: "2026-09-10T10:03:00+09:00", eventId: "preview-chat-event-9" },
    { messageId: "preview-chat-8", accountId: "preview-gm-2", nickname: "운영자밥풀", body: "10분이면 끝납니다. 전투 중이시면 정리하고 기다려 주세요.", createdAt: "2026-09-10T10:02:30+09:00", eventId: "preview-chat-event-8", gameMaster: true },
    { messageId: "preview-chat-7", accountId: "preview-sweet", nickname: "달콤고구마", primaryMaterialType: "SWEET_POTATO", body: "점검 얼마나 걸리나요?", createdAt: "2026-09-10T10:02:00+09:00", eventId: "preview-chat-event-7" },
    { messageId: "preview-chat-6", accountId: "preview-gm-1", nickname: "한짝지기", body: "오늘 23시에 잠깐 점검이 있어요.", createdAt: "2026-09-10T10:01:30+09:00", eventId: "preview-chat-event-6", gameMaster: true },
    { messageId: "preview-chat-5", accountId: "preview-potato", nickname: "고구마한테그러지마", primaryMaterialType: "POTATO", body: "오늘도 끝까지 화이팅!", createdAt: "2026-09-10T10:01:00+09:00", eventId: "preview-chat-event-5" },
    { messageId: "preview-chat-4", accountId: "preview-farm", nickname: "감자대장", primaryMaterialType: "POTATO", body: "황금 감자 3개 850에 팝니다", createdAt: "2026-09-10T10:00:30+09:00", eventId: "preview-chat-event-4" },
    { messageId: "preview-chat-3", accountId: "preview", nickname: "한짝", primaryMaterialType: "POTATO", body: "안녕하세요!", createdAt: "2026-09-10T10:00:00+09:00", eventId: "preview-chat-event-3" },
    { messageId: "preview-chat-2", accountId: "preview-bread", nickname: "빵굽는날", primaryMaterialType: "CORN", body: "다들 좋은 아침!", createdAt: "2026-09-10T09:59:00+09:00", eventId: "preview-chat-event-2" },
    { messageId: "preview-chat-1", accountId: "preview-rice", nickname: "쌀한톨", primaryMaterialType: "SWEET_POTATO", body: "보스 잡으러 갑니다", createdAt: "2026-09-10T09:58:00+09:00", eventId: "preview-chat-event-1" },
    { messageId: "preview-chat-0", accountId: "preview-night", nickname: "야식당번", primaryMaterialType: "SWEET_POTATO", body: "새 스테이지 열렸어요", createdAt: "2026-09-10T09:57:00+09:00", eventId: "preview-chat-event-0" },
  ],
  nextCursor: null,
  unreadCount: 0,
};
const previewBattleHistory: BattleHistoryEvent[] = [
  {
    eventId: "preview-victory",
    type: "STAGE_CLEARED",
    occurredAt: "2026-09-10T03:14:52Z",
    stageId: "stage.01-06",
    dungeonId: null,
    resultCode: "STAGE_CLEARED",
    messageKey: "battle.history.stage.cleared",
    contentVersion: null,
    combatSnapshot: {
      attack: 277,
      maxHp: 3_680,
      penetration: 48,
      stageEnteredAt: "2026-09-10T03:14:18Z",
      remainingHp: 2_680,
      defeatedNormals: 20,
      lastEnemyRemainingHp: 0,
      elapsedTicks: 340,
      experienceGained: 1_120,
      riceGained: 640,
      rewards: [
        { itemId: "POTATO_M1", displayName: "감자 M1", quantity: 7 },
        { itemId: "SWEET_POTATO_M1", displayName: "고구마 M1", quantity: 12 },
      ],
    },
  },
  {
    eventId: "preview-defeat",
    type: "STAGE_FAILED",
    occurredAt: "2026-09-10T03:12:20Z",
    stageId: "stage.01-07",
    dungeonId: null,
    resultCode: "PLAYER_DEFEATED",
    messageKey: "battle.history.player.defeated",
    contentVersion: "enemy-v1-applied",
    combatSnapshot: {
      attack: 277,
      maxHp: 3_680,
      penetration: 48,
      stageEnteredAt: "2026-09-10T03:11:55Z",
      remainingHp: 0,
      defeatedNormals: 17,
      lastEnemyRemainingHp: 382,
      elapsedTicks: 250,
      experienceGained: 816,
      riceGained: 408,
      rewards: [{ itemId: "CORN_M1", displayName: "옥수수 M1", quantity: 3 }],
    },
  },
];

type PreviewRoute = "battle" | Extract<BattleHudRoute, "equipment" | "inventory" | "skills" | "gems" | "dungeon" | "market" | "mail" | "ranking" | "settings" | "cosmetics" | "liveops">;

const PREVIEW_LIVEOPS_STATE: LiveopsState = {
  eventId: "hunt-ticket-gacha-2026-09",
  displayName: "사냥 이벤트 뽑기",
  startsAt: "2026-09-21T00:00:00+09:00",
  endsAt: "2026-09-28T00:00:00+09:00",
  open: true,
  halted: false,
  ticketBalance: 12,
  grantedToday: 27,
  dailyCap: 100,
  secondsPerTicket: 180,
  outcomes: [
    { kind: "PRIZE", prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", millionths: 200, probabilityDisplay: "0.02%", quantity: null, minQuantity: null, maxQuantity: null },
    { kind: "GEM_BOX", prizeId: null, displayName: null, millionths: 100_000, probabilityDisplay: "10%", quantity: 1, minQuantity: null, maxQuantity: null },
    { kind: "COSMETIC_TICKET", prizeId: null, displayName: null, millionths: 100_000, probabilityDisplay: "10%", quantity: 1, minQuantity: null, maxQuantity: null },
    { kind: "RICE", prizeId: null, displayName: null, millionths: 799_800, probabilityDisplay: "79.98%", quantity: null, minQuantity: 10, maxQuantity: 100 },
  ],
  prizes: [{ prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", total: 5, claimed: 1, remaining: 4, alreadyWon: false }],
};


const previewAppearance: RankingAppearance = { head: null, face: null, top: null, bottom: null, gloves: null, shoes: null, cape: null, color: null };
const previewStageId = (globalIndex: number) =>
  `stage.${String(Math.floor((globalIndex - 1) / 10) + 1).padStart(2, "0")}-${String(((globalIndex - 1) % 10) + 1).padStart(2, "0")}`;
const previewRankingEntry = (overallRank: number, rank: number, nickname: string, materialType: MaterialType, combatPower: number, level: number, appearance = previewAppearance): RankingEntry => ({
  overallRank,
  rank,
  /* 미리보기에서는 전투력 순서를 스테이지 순서로도 그대로 쓴다. */
  stageOverallRank: overallRank,
  stageRank: rank,
  nickname,
  materialType,
  combatPower,
  level,
  displayName: materialType === "POTATO" ? "감자 전문" : materialType === "SWEET_POTATO" ? "고구마 전문" : "옥수수 전문",
  highestClearedStageId: previewStageId(42 - overallRank * 4),
  highestClearedAt: "2026-09-10T09:00:00Z",
  appearance,
  updatedAt: "2026-09-10T09:00:00Z",
});
const previewRankingEntries = [
  previewRankingEntry(1, 1, "고구마한테그러지마", "SWEET_POTATO", 219_999, 52, { head: "cosmetic-105", face: null, top: "cosmetic-106", bottom: "cosmetic-107", gloves: "cosmetic-108", shoes: "cosmetic-109", cape: "cosmetic-110", color: null }),
  previewRankingEntry(2, 1, "감자만세", "POTATO", 198_240, 49, { head: "cosmetic-117", face: null, top: "cosmetic-118", bottom: "cosmetic-119", gloves: "cosmetic-120", shoes: "cosmetic-121", cape: "cosmetic-122", color: null }),
  previewRankingEntry(3, 1, "옥수수기사단", "CORN", 186_810, 47, { head: "cosmetic-141", face: null, top: "cosmetic-142", bottom: "cosmetic-143", gloves: "cosmetic-144", shoes: "cosmetic-145", cape: "cosmetic-146", color: null }),
  previewRankingEntry(4, 2, "버터감자", "POTATO", 174_500, 45),
  previewRankingEntry(5, 2, "군고구마", "SWEET_POTATO", 163_900, 43),
  previewRankingEntry(6, 2, "소금옥수수", "CORN", 152_300, 41),
  previewRankingEntry(7, 3, "마스터감자", "POTATO", 141_220, 38),
  previewRankingEntry(8, 3, "왕고구마", "SWEET_POTATO", 133_700, 36),
  previewRankingEntry(9, 3, "옥수수수염", "CORN", 125_610, 33),
  previewRankingEntry(10, 4, "한짝", "POTATO", 118_200, 24),
];
const previewCombatPowerRanking: CombatPowerRanking = {
  formulaVersion: "combat-power-v1",
  generatedAt: "2026-09-10T09:00:00Z",
  sourceStateVersion: 1,
  overallTop: previewRankingEntries,
  specializations: (["POTATO", "SWEET_POTATO", "CORN"] as MaterialType[]).map((materialType) => ({
    materialType,
    displayName: previewRankingEntries.find((entry) => entry.materialType === materialType)!.displayName,
    entries: previewRankingEntries.filter((entry) => entry.materialType === materialType).map((entry, index) => ({ ...entry, rank: index + 1 })),
  })),
  myEntry: previewRankingEntries.at(-1)!,
};

const previewEquipmentRows: Array<{ slot: EquipmentSlot; slotName: string; attack: number; maxHp: number; penetration: number }> = [
  { slot: "WEAPON", slotName: "무기", attack: 52, maxHp: 0, penetration: 0 },
  { slot: "GLOVES", slotName: "장갑", attack: 31, maxHp: 0, penetration: 0 },
  { slot: "ARMOR", slotName: "갑옷", attack: 0, maxHp: 427, penetration: 0 },
  { slot: "HELMET", slotName: "투구", attack: 0, maxHp: 285, penetration: 0 },
  { slot: "CAPE", slotName: "망토", attack: 0, maxHp: 0, penetration: 25 },
  { slot: "SHOES", slotName: "신발", attack: 0, maxHp: 0, penetration: 17 },
];

const previewEquipmentState: EquipmentState = {
  riceBalance: 2_000,
  slots: previewEquipmentRows.map((row, index) => {
    const enhancementLevel = index === 0 ? 30 : index < 2 ? 15 : 7;
    const statIncrease = { attack: row.attack ? 1 : 0, maxHp: row.maxHp ? 11 : 0, penetration: row.penetration ? 2 : 0 };
    const materials = [
      { itemId: "POTATO_M1", displayName: "감자 M1", requiredQuantity: 125, availableQuantity: 116 },
      { itemId: "SWEET_POTATO_M1", displayName: "고구마 M1", requiredQuantity: 125, availableQuantity: 925 },
      { itemId: "CORN_M1", displayName: "옥수수 M1", requiredQuantity: 125, availableQuantity: 391 },
    ];
    return {
      slot: row.slot,
      slotName: row.slotName,
      unlocked: true,
      current: { grade: "NORMAL", gradeName: "노말", enhancementLevel, q: enhancementLevel, stats: { attack: row.attack, maxHp: row.maxHp, penetration: row.penetration } },
      unlock: null,
      enhance: index === 0 ? null : {
        cost: { riceCost: 210 + index * 60, materials },
        result: { grade: "NORMAL", gradeName: "노말", enhancementLevel: enhancementLevel + 1, q: enhancementLevel + 1, stats: { attack: row.attack + statIncrease.attack, maxHp: row.maxHp + statIncrease.maxHp, penetration: row.penetration + statIncrease.penetration } },
        statIncrease,
        executable: true,
        disabledReason: null,
        maxExecutableCount: 4,
      },
      /* 아직 조건이 안 찬 승급도 눈으로 보려고, 1번 칸만 준비된 상태로 둔다.
         0번 칸은 강화를 눌러 보는 자리라 건드리지 않는다. */
      promote: {
        requiredStageId: "stage.01-10",
        /* 1번 칸은 +30강을 찍었지만 스테이지가 남은 상태로 둬, 잠긴 문구를 눈으로 본다. */
        chapterCleared: false,
        maxEnhancementReached: index === 1,
        cost: { riceCost: 1_000, materials },
        result: { grade: "RARE", gradeName: "희귀", enhancementLevel: 1, q: 40, stats: { attack: 96, maxHp: 0, penetration: 0 } },
        executable: false,
        disabledReason: index === 1 ? "EQUIPMENT_CHAPTER_NOT_CLEARED" : "EQUIPMENT_MAX_ENHANCEMENT_REQUIRED",
      },
      growthComplete: false,
    };
  }),
};

previewEquipmentState.slots[0].current = { grade: "RARE", gradeName: "희귀", enhancementLevel: 1, q: 40, stats: { attack: 96, maxHp: 0, penetration: 0 } };
previewEquipmentState.slots[0].enhance = {
  cost: {
    riceCost: 930,
    materials: [
      { itemId: "POTATO_M1", displayName: "감자 한 조각", requiredQuantity: 500, availableQuantity: 520 },
      { itemId: "SWEET_POTATO_M1", displayName: "고구마 한 조각", requiredQuantity: 500, availableQuantity: 500 },
      { itemId: "CORN_M1", displayName: "옥수수 한 알", requiredQuantity: 500, availableQuantity: 500 },
      { itemId: "POTATO_M2", displayName: "미니 감자", requiredQuantity: 100, availableQuantity: 100 },
      { itemId: "SWEET_POTATO_M2", displayName: "미니 고구마", requiredQuantity: 100, availableQuantity: 100 },
      { itemId: "CORN_M2", displayName: "미니 옥수수", requiredQuantity: 100, availableQuantity: 100 },
    ],
  },
  result: { grade: "RARE", gradeName: "희귀", enhancementLevel: 2, q: 41, stats: { attack: 98, maxHp: 0, penetration: 0 } },
  statIncrease: { attack: 2, maxHp: 0, penetration: 0 },
  executable: true,
  disabledReason: null,
  maxExecutableCount: 6,
};

function executePreviewEquipmentCommand(command: { kind: "unlock" | "enhance" | "promote"; slot: EquipmentSlot }, currentState: EquipmentState) {
  const selected = currentState.slots.find((slot) => slot.slot === command.slot);
  const growth = command.kind === "enhance" ? selected?.enhance : command.kind === "promote" ? selected?.promote : selected?.unlock;
  if (!selected || !growth) return { state: currentState, powerIncrease: 0 };
  const nextCurrent = growth.result;
  const nextEnhance = command.kind === "enhance" && selected.enhance ? {
    ...selected.enhance,
    result: {
      ...selected.enhance.result,
      enhancementLevel: nextCurrent.enhancementLevel + 1,
      q: nextCurrent.q + 1,
      stats: {
        attack: nextCurrent.stats.attack + selected.enhance.statIncrease.attack,
        maxHp: nextCurrent.stats.maxHp + selected.enhance.statIncrease.maxHp,
        penetration: nextCurrent.stats.penetration + selected.enhance.statIncrease.penetration,
      },
    },
  } : selected.enhance;
  return {
    state: {
      ...currentState,
      riceBalance: Math.max(0, currentState.riceBalance - growth.cost.riceCost),
      slots: currentState.slots.map((slot) => slot.slot === command.slot ? { ...slot, current: nextCurrent, enhance: nextEnhance } : slot),
    },
    powerIncrease: 5,
  };
}

function CosmeticsPreviewScreen({ tutorialRewardId, onOpenInventory }: { tutorialRewardId?: string; onOpenInventory: () => void }) {
  const [drawResult, setDrawResult] = useState<CosmeticDrawResponse | null>(null);
  const [banner, setBanner] = useState(previewCosmeticBanner);
  const [revealSequence, setRevealSequence] = useState(0);
  const [milestoneClaimed, setMilestoneClaimed] = useState(false);
  const [claimedBoxCount, setClaimedBoxCount] = useState(0);
  const previewDraw = (count: 1 | 10) => {
    const tutorialReward = tutorialRewardId
      ? previewCosmeticCatalog.cosmetics.find((item) => item.cosmeticId === tutorialRewardId)
      : undefined;
    const items = Array.from({ length: count }, (_, index) => count === 1 && tutorialReward
      ? tutorialReward
      : previewCosmeticCatalog.cosmetics[index % previewCosmeticCatalog.cosmetics.length]);
    const cost = count === 1 ? banner.oneDraw : banner.tenDraw;
    const totalSuccessfulDraws = banner.milestone.totalSuccessfulDraws + count;
    const claimableBoxCount = Math.floor(totalSuccessfulDraws / 200) - banner.milestone.claimedBoxCount;
    const nextTicketBalance = Math.max(0, banner.ticketBalance - cost.ticketCost);
    const nextRiceBalance = Math.max(0, banner.riceBalance - cost.riceCost);
    const costFor = (nextCount: 1 | 10) => {
      const ticketCost = Math.min(nextTicketBalance, nextCount);
      const riceCost = (nextCount - ticketCost) * banner.singleRiceCost;
      return { ticketCost, riceCost, executable: nextRiceBalance >= riceCost };
    };
    setBanner((current) => ({
      ...current,
      ticketBalance: nextTicketBalance,
      riceBalance: nextRiceBalance,
      oneDraw: costFor(1),
      tenDraw: costFor(10),
      milestone: { ...current.milestone, totalSuccessfulDraws, claimableBoxCount, drawsUntilNextBox: claimableBoxCount > 0 ? 0 : 200 - (totalSuccessfulDraws % 200 || 200) },
    }));
    setMilestoneClaimed(false);
    setRevealSequence((current) => current + 1);
    setDrawResult({
      bannerId: banner.bannerId,
      ticketCost: cost.ticketCost,
      riceCost: cost.riceCost,
      results: items.map((item, index) => ({ cosmeticId: item.cosmeticId, grade: item.grade, isNew: index % 3 !== 2 })),
      collection: previewCosmeticCollection as GachaCollection,
    });
  };
  const claimMilestone = () => {
    // 실제 화면과 같이 밀려 있는 상자를 한 번에 받는다. 남은 나머지는 다음 게이지에 그대로 둔다.
    setBanner((current) => {
      const claiming = current.milestone.claimableBoxCount;
      return { ...current, milestone: { ...current.milestone, claimedBoxCount: current.milestone.claimedBoxCount + claiming, claimableBoxCount: 0, drawsUntilNextBox: 200 - (current.milestone.totalSuccessfulDraws % 200), ownedBoxQuantity: current.milestone.ownedBoxQuantity + claiming } };
    });
    setMilestoneClaimed(true);
    setClaimedBoxCount(banner.milestone.claimableBoxCount);
  };
  // 실제 화면과 같은 화면 전환을 써야 프리뷰에서 엉뚱한 개봉 화면을 정상 동작으로 오인하지 않는다.
  const claimedDialog = claimedBoxCount > 0
    ? <CosmeticBoxClaimedDialog count={claimedBoxCount} onGoToInventory={() => { setClaimedBoxCount(0); onOpenInventory(); }} onClose={() => setClaimedBoxCount(0)} />
    : null;
  if (drawResult) return <section key="preview-reveal" className="cosmetic-screen cosmetic-reveal-screen" aria-label="치장 뽑기 결과 화면">
    <CosmeticDrawReveal key={revealSequence} draw={drawResult} catalog={previewCosmeticCatalog as GachaCatalog} banner={banner} milestoneClaimed={milestoneClaimed} onRedraw={previewDraw} onClaimMilestone={banner.milestone.claimableBoxCount ? claimMilestone : undefined} onContinue={() => { setDrawResult(null); setMilestoneClaimed(false); }} />
    {claimedDialog}
  </section>;
  return <section key="preview-main" className="cosmetic-screen battle-preview-cosmetics" aria-labelledby="cosmetics-preview-title">
    <header className="cosmetic-screen-heading">
      <button type="button" className="cosmetic-odds-button"><i aria-hidden="true" />등급별 확률</button>
      <h2 id="cosmetics-preview-title">치장 뽑기</h2>
      <CosmeticWalletBalance banner={banner} />
    </header>
    <CosmeticGachaBoard
      banners={[banner]}
      showcase={{ version: 1, sets: [{ setId: "sushi", displayName: "스시야 세트", imageUrl: "/assets/cosmetics/showcase/legendary-sushi-final.jpg" }] }}
      claimedBannerId={milestoneClaimed ? banner.bannerId : null}
      onDraw={(_, count) => previewDraw(count)}
      onCommand={(command) => { if (command.kind === "claim") claimMilestone(); }}
    />
    {claimedDialog}
  </section>;
}

export function BattleHudPreview() {
  useHudScale();
  const client = useQueryClient();
  const previewParams = new URLSearchParams(globalThis.location.search);
  const requestedRoute = previewParams.get("route");
  const tutorialPreviewMode = previewParams.get("tutorial");
  const requestedTutorialChapter = TUTORIAL_PREVIEW_CHAPTERS.find((chapter) => chapter.id === tutorialPreviewMode)
    ?? TUTORIAL_PREVIEW_CHAPTERS[0];
  const tutorialPreviewEnabled = tutorialPreviewMode !== null;
  const requestedCharacterTab = previewParams.get("character-tab") === "gallery" ? "gallery" : previewParams.get("character-tab") === "cosmetics" ? "cosmetics" : "stats";
  const initialRoute: PreviewRoute = requestedRoute === "equipment" || requestedRoute === "inventory" || requestedRoute === "skills" || requestedRoute === "gems" || requestedRoute === "dungeon" || requestedRoute === "market" || requestedRoute === "mail" || requestedRoute === "ranking" || requestedRoute === "settings" || requestedRoute === "cosmetics" || requestedRoute === "liveops" ? requestedRoute : "battle";
  const [activeRoute, setActiveRoute] = useState<PreviewRoute>(initialRoute);
  const liveopsDataSource = useMemo<LiveopsDataSource>(() => {
    let ticketBalance = PREVIEW_LIVEOPS_STATE.ticketBalance;
    return {
      state: async () => ({ ...PREVIEW_LIVEOPS_STATE, ticketBalance }),
      draw: async (count) => {
        ticketBalance = Math.max(0, ticketBalance - count);
        const lines: LiveopsDrawResult["lines"] = Array.from({ length: count }, (_, index) => {
          if (index === 0) return { kind: "COSMETIC_TICKET", prizeId: null, prizeDisplayName: null, quantity: 1 };
          if (index === 1) return { kind: "GEM_BOX", prizeId: null, prizeDisplayName: null, quantity: 1 };
          return { kind: "RICE", prizeId: null, prizeDisplayName: null, quantity: 10 + index * 7 };
        });
        return {
          eventId: PREVIEW_LIVEOPS_STATE.eventId,
          ticketCost: count,
          riceGained: lines.filter((line) => line.kind === "RICE").reduce((sum, line) => sum + line.quantity, 0),
          cosmeticTicketsGained: lines.filter((line) => line.kind === "COSMETIC_TICKET").reduce((sum, line) => sum + line.quantity, 0),
          gemBoxesGained: lines.filter((line) => line.kind === "GEM_BOX").reduce((sum, line) => sum + line.quantity, 0),
          ticketBalance,
          lines,
        };
      },
    };
  }, []);
  const [globalOverlay, setGlobalOverlay] = useState<"market" | "mail" | null>(requestedRoute === "market" || requestedRoute === "mail" ? requestedRoute : null);
  const [characterOpen, setCharacterOpen] = useState(requestedRoute === "character");
  const [characterInitialTab, setCharacterInitialTab] = useState<"stats" | "cosmetics" | "gallery">(requestedCharacterTab);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<ProfileTab>("profile");
  const [tutorialVisible, setTutorialVisible] = useState(tutorialPreviewEnabled);
  const [tutorialChapterId, setTutorialChapterId] = useState(requestedTutorialChapter.id);
  const [tutorialMenuOpen, setTutorialMenuOpen] = useState(tutorialPreviewMode === "all");
  const [cosmeticTutorialView, setCosmeticTutorialView] = useState<"gacha" | "wardrobe" | "gallery">("gacha");
  const [previewCollection, setPreviewCollection] = useState<CharacterCollection>(previewCosmeticCollection);
  const [previewProfileAccount, setPreviewProfileAccount] = useState(previewAccount);
  const [marketInitialMode, setMarketInitialMode] = useState<MarketMode>("buy");
  const tutorialInitialized = useRef(false);
  const bossWarningMode = previewParams.get("boss-warning");
  const skillVfxMode = previewParams.get("skill-vfx");
  const expiringVfxPreview = previewParams.get("expiring") === "1";
  const liveWarningPreview = previewParams.get("animate") === "1";
  const bossFightPreview = previewParams.get("boss-fight") === "1";
  const finalBossPreview = bossWarningMode === "final";
  const bossWarningPreview = finalBossPreview || bossWarningMode === "regular";
  const bossPreview = bossWarningPreview || bossFightPreview;
  const [warningVisible, setWarningVisible] = useState(bossWarningPreview);
  const [previewIdleMode, setPreviewIdleMode] = useState<"AUTO_PROGRESS" | "REPEAT_STAGE">("AUTO_PROGRESS");
  const [previewDefeatedNormals, setPreviewDefeatedNormals] = useState(bossPreview ? 20 : 7);
  const [previewBossPhase, setPreviewBossPhase] = useState(bossPreview);
  const [previewBossHp, setPreviewBossHp] = useState(517);
  const [previewRemainingSeconds, setPreviewRemainingSeconds] = useState<number | null>(21);
  const [previewTimerRunning, setPreviewTimerRunning] = useState(false);
  const [previewRewardRice, setPreviewRewardRice] = useState(INITIAL_PREVIEW_REWARD_RICE);
  const [previewRewards, setPreviewRewards] = useState<RewardLine[]>(INITIAL_PREVIEW_REWARDS);
  const [rewardPanelRevision, setRewardPanelRevision] = useState(0);
  const [previewPlayerStatus, setPreviewPlayerStatus] = useState({ level: 24, hp: 2_680, maxHp: 3_680, experience: 14_976, experienceRequired: 24_000 });
  const requestedStageId = previewParams.get("stage");
  const initialPreviewStageId = /^stage\.(0[1-9]|1[0-5])-(0[1-9]|10)$/.test(requestedStageId ?? "")
    ? requestedStageId!
    : finalBossPreview ? "stage.01-10" : "stage.01-07";
  const [previewStageId, setPreviewStageId] = useState(initialPreviewStageId);
  const finalStageOnly = previewStageId.endsWith("-10");
  const previewIsBoss = bossPreview || finalStageOnly;
  const previewVisual = stageVisual(previewStageId);
  const previewMonsterId: ChapterOneMonsterId = previewIsBoss || previewVisual.normals.length === 0 ? previewVisual.boss : previewVisual.normals[0];
  const previewCasterVfx: SkillVfx[] = [
    ...(skillVfxMode === "buffs" || skillVfxMode === "all" ? [
      { kind: "haste-caster" as const, frame: 0, frameCount: 8, loop: true, expiring: expiringVfxPreview },
      { kind: "basic-amp-caster" as const, frame: 0, frameCount: 8, loop: true, expiring: expiringVfxPreview },
    ] : []),
  ];
  const previewTargetVfx: SkillVfx[] = [
    ...(skillVfxMode === "heavy" || skillVfxMode === "all" ? [{ kind: "heavy-target" as const, frame: 0, frameCount: 8 }] : []),
    ...(skillVfxMode === "dot" || skillVfxMode === "all" ? [{ kind: "dot-target" as const, frame: 0, frameCount: 8, loop: true }] : []),
  ];
  useEffect(() => {
    if (!previewTimerRunning || warningVisible || previewRemainingSeconds === null || previewRemainingSeconds <= 0) return;
    const timer = window.setInterval(() => setPreviewRemainingSeconds((current) => current === null ? null : Math.max(0, current - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [previewRemainingSeconds, previewTimerRunning, warningVisible]);
  const tutorialChapter = TUTORIAL_PREVIEW_CHAPTERS.find((chapter) => chapter.id === tutorialChapterId)
    ?? TUTORIAL_PREVIEW_CHAPTERS[0];
  const applyPreviewCosmeticCommand = (command: { kind: "equip"; slot: string; cosmeticId: string | null } | { kind: "register"; cosmeticId: string } | { kind: "bulkRegister" } | { kind: "color"; color: string | null }) => {
    if (command.kind === "register") return;
    setPreviewCollection((current) => {
      const next = command.kind === "bulkRegister"
        ? { ...current, states: current.states.map(state => state.canUpgrade && state.neededForNextStar != null
          ? { ...state, registeredQuantity: state.registeredQuantity + state.neededForNextStar, unregisteredQuantity: state.unregisteredQuantity - state.neededForNextStar, availableUnregisteredQuantity: state.availableUnregisteredQuantity - state.neededForNextStar, cosmeticStar: state.cosmeticStar + 1, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" }
          : state) }
        : command.kind === "color"
        ? { ...current, color: command.color }
        : { ...current, equipment: { ...current.equipment, [command.slot]: command.cosmeticId } };
      client.setQueryData(["cosmetic-collection"], next);
      return next;
    });
  };
  const executePreviewCharacterCommands = (commands: readonly CharacterCommand[], current: CharacterCollection) => {
    let upgradedCount = 0;
    const next = commands.reduce<CharacterCollection>((state, command) => {
      if (command.kind === "register") return state;
      if (command.kind === "bulkRegister") {
        const states = state.states.map(item => {
          if (!item.canUpgrade || item.neededForNextStar == null) return item;
          upgradedCount += 1;
          return { ...item, registeredQuantity: item.registeredQuantity + item.neededForNextStar, unregisteredQuantity: item.unregisteredQuantity - item.neededForNextStar, availableUnregisteredQuantity: item.availableUnregisteredQuantity - item.neededForNextStar, cosmeticStar: item.cosmeticStar + 1, canUpgrade: false, upgradeDisabledReason: "INSUFFICIENT_DUPLICATES" };
        });
        return { ...state, states };
      }
      return command.kind === "color"
        ? { ...state, color: command.color }
        : { ...state, equipment: { ...state.equipment, [command.slot]: command.cosmeticId } };
    }, current);
    setPreviewCollection(next);
    return upgradedCount > 0 ? { upgradedCount, collection: next } : next;
  };
  const executePreviewGemFusion = async (mode: GemFusionMode, gemIds: string[], _options?: { targetLevel: number; allowedOptions: GemOption[] }): Promise<GemFusionResult> => {
    const current = client.getQueryData<GemState>(["gems"]) ?? previewTutorialGemState;
    const consumed = current.gems.filter((gem) => gemIds.includes(gem.gemId));
    const source = consumed[0];
    if (!source || gemIds.length !== 3) throw new Error("연습용 보석 세 개를 선택해 주세요.");
    const granted = previewGem(`tutorial-fusion-result-${mode.toLowerCase()}`, source.level + 1, source.option);
    const nextState = { ...current, gems: [...current.gems.filter((gem) => !gemIds.includes(gem.gemId)), granted] };
    client.setQueryData(["gems"], nextState);
    return { consumedGemIds: gemIds, granted: [granted], state: nextState };
  };
  function presentTutorialStep(step: TutorialPreviewStep) {
    globalThis.scrollTo(0, 0);
    setCharacterOpen(false);
    setProfileOpen(false);
    setGlobalOverlay(null);
    if (step.surface !== "cosmetics" && step.surface !== "character-cosmetics" && step.surface !== "character-gallery") {
      setCosmeticTutorialView("gacha");
    }
    switch (step.surface) {
      case "battle": setActiveRoute("battle"); break;
      case "inventory": setActiveRoute("inventory"); break;
      case "equipment": setActiveRoute("equipment"); break;
      case "skills": setActiveRoute("skills"); break;
      case "dungeon": setActiveRoute("dungeon"); break;
      case "gems": setActiveRoute("gems"); break;
      case "gems-fusion":
        setActiveRoute("gems");
        globalThis.setTimeout(() => document.querySelector<HTMLButtonElement>(".gem-management-tabs button:nth-of-type(2)")?.click(), 0);
        break;
      case "cosmetics":
        setCosmeticTutorialView("gacha");
        setActiveRoute("cosmetics");
        break;
      case "character-cosmetics":
        setCosmeticTutorialView("wardrobe");
        setActiveRoute("cosmetics");
        break;
      case "character-gallery":
        setCosmeticTutorialView("gallery");
        setActiveRoute("cosmetics");
        break;
      case "market-buy":
        setMarketInitialMode("buy");
        setGlobalOverlay("market");
        break;
      case "market-sell":
        setMarketInitialMode("sell");
        setGlobalOverlay("market");
        break;
      case "market-history":
        setMarketInitialMode("history");
        setGlobalOverlay("market");
        break;
      case "ranking": setActiveRoute("ranking"); break;
      case "settings":
        setProfileInitialTab("settings");
        setActiveRoute("settings");
        break;
    }
  }
  const moveToNextTutorialChapter = () => {
    const currentIndex = TUTORIAL_PREVIEW_CHAPTERS.findIndex((chapter) => chapter.id === tutorialChapter.id);
    const nextChapter = TUTORIAL_PREVIEW_CHAPTERS[(currentIndex + 1) % TUTORIAL_PREVIEW_CHAPTERS.length];
    setTutorialChapterId(nextChapter.id);
    presentTutorialStep(nextChapter.steps[0]);
    setTutorialVisible(true);
  };
  useEffect(() => {
    if (!tutorialPreviewEnabled || tutorialInitialized.current) return;
    tutorialInitialized.current = true;
    presentTutorialStep(requestedTutorialChapter.steps[0]);
  }, [requestedTutorialChapter, tutorialPreviewEnabled]);
  useEffect(() => {
    client.setQueryDefaults(["equipment"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
    client.setQueryDefaults(["battle-history"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
    client.setQueryDefaults(["combat-power-ranking"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
    client.setQueryDefaults(["liveops-state"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
    /* 미리보기에는 로그인이 없다. 세션을 다시 물어보면 랭킹이 로그인 안내로 덮인다. */
    client.setQueryDefaults(["auth", "session"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
    if (!client.getQueryData(["equipment"])) client.setQueryData(["equipment"], previewEquipmentState);
    if (!client.getQueryData(["battle-history"])) client.setQueryData(["battle-history"], previewBattleHistory);
    if (!client.getQueryData(["combat-power-ranking"])) client.setQueryData(["combat-power-ranking"], previewCombatPowerRanking);
    // 캐릭터 탭의 전투력 줄은 한 명치만 따로 받는다. 미리보기에서도 같은 값이 보이게 둔다.
    client.setQueryDefaults(["combat-power", "me"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
    if (!client.getQueryData(["combat-power", "me"])) client.setQueryData(["combat-power", "me"], previewCombatPowerRanking);
    client.setQueryData(["auth", "session"], { authenticated: true, account: previewProfileAccount });
    // 미리보기에서도 착용한 치장이 전투·던전 캐릭터에 그대로 올라가야 한다.
    if (!client.getQueryData(["cosmetic-collection"])) client.setQueryData(["cosmetic-collection"], previewCosmeticCollection);
    if (!client.getQueryData(["cosmetic-catalog"])) client.setQueryData(["cosmetic-catalog"], previewCosmeticCatalog);
    if (!client.getQueryData(["gems"])) client.setQueryData(["gems"], previewTutorialGemState);
    if (!client.getQueryData(["liveops-state"])) client.setQueryData(["liveops-state"], PREVIEW_LIVEOPS_STATE);
  }, [client, previewProfileAccount]);
  useEffect(() => {
    if (activeRoute !== "equipment") return;
    const modal = previewParams.get("equipment-modal");
    if (modal !== "bulk" && modal !== "market") return;
    const timer = window.setTimeout(() => {
      if (modal === "bulk") {
        (document.querySelector(".equipment-bulk-enhance-open") as HTMLButtonElement | null)?.click();
        return;
      }
      (document.querySelector('[aria-label^="신발 "]') as HTMLButtonElement | null)?.click();
      window.setTimeout(() => (document.querySelector(".equipment-material-market") as HTMLButtonElement | null)?.click(), 60);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeRoute]);
  useEffect(() => {
    setWarningVisible(bossWarningPreview);
    if (!bossWarningPreview || !liveWarningPreview) return;
    const timer = globalThis.setTimeout(() => setWarningVisible(false), finalBossPreview ? 4_200 : 2_800);
    return () => globalThis.clearTimeout(timer);
  }, [bossWarningPreview, finalBossPreview, liveWarningPreview]);
  const navigate = (route: BattleHudRoute) => {
    if (route === "character") {
      setCharacterOpen(true);
      return;
    }
    if (route === "settings") {
      setProfileInitialTab("settings");
      setProfileOpen(true);
      return;
    }
    if (route === "market" || route === "mail") {
      if (route === "market") setMarketInitialMode("buy");
      setGlobalOverlay(route);
      return;
    }
    if (route === "battle" || route === "equipment" || route === "inventory" || route === "skills" || route === "gems" || route === "dungeon" || route === "ranking" || route === "cosmetics" || route === "liveops") {
      setGlobalOverlay(null);
      setActiveRoute(route);
    }
  };

  const characterWindow = <CharacterWindow open={characterOpen} initialTab={characterInitialTab} previewData={{ ...previewCharacterData, collection: previewCollection }} previewCommand={executePreviewCharacterCommands} onClose={() => setCharacterOpen(false)} onGacha={() => { setCharacterOpen(false); setActiveRoute("cosmetics"); }} />;
  const profileWindow = <ProfileScreen
    open={profileOpen}
    initialTab={profileInitialTab}
    updateNicknameRequest={async ({ nickname }) => {
      const updated = { ...previewProfileAccount, nickname };
      setPreviewProfileAccount(updated);
      return updated;
    }}
    onClose={() => setProfileOpen(false)}
  />;
  /* 실제 게임과 같은 화면별 다시 보기 단추를 검수 화면에서도 그대로 보여 준다. */
  const previewReplaySurface: TutorialRuntimeSurface | null =
    globalOverlay === "market" ? "market"
      : activeRoute === "equipment" || activeRoute === "skills" || activeRoute === "gems"
      || activeRoute === "dungeon" ? activeRoute
      : activeRoute === "cosmetics" && cosmeticTutorialView === "gacha" ? "cosmetics"
      : null;
  /* 종이 한 장에 보상이 몇 줄까지 들어가는지 눈으로 보려고 ?first-clear=1 로 띄운다.
     줄 수를 바꿔 가며 볼 수 있게 개수를 물음표 뒤에서 받는다. */
  const firstClearPreview = previewParams.get("first-clear");
  const firstClearLines = Number(previewParams.get("first-clear-lines") ?? 8);
  const firstClearWindow = firstClearPreview === "1" ? <FirstClearRewardNotice
    reward={{
      rewardId: "preview", stageId: "stage.01-08", rewardVersion: "progression-rebalance-v1",
      firstClear: true, riceGranted: 11_136, ticketsGranted: 0,
      grantedItems: Array.from({ length: Math.max(0, firstClearLines - 1) }, (_, index) => ({
        itemId: ["POTATO_M1", "SWEET_POTATO_M1", "CORN_M1", "POTATO_M2", "SWEET_POTATO_M2", "CORN_M2", "POTATO_M3"][index % 7]!,
        displayName: ["감자 한 조각", "고구마 한 조각", "옥수수 한 알", "감자 한 줌", "고구마 한 줌", "옥수수 한 줌", "잘 여문 감자"][index % 7]!,
        quantity: 1_422,
      })),
      pendingItems: [], unlockedSkillId: "active_heavy", itemStatus: "CLAIMED",
      requiredSlots: 1, availableSlots: 187, missingSlots: 0,
    }}
    onClose={() => undefined}
  /> : null;
  const tutorialControls = <>
    {tutorialPreviewEnabled && <nav className={`tutorial-preview-navigator ${tutorialMenuOpen ? "is-open" : "is-collapsed"}`} aria-label="튜토리얼 장 미리보기">
      <button type="button" className="tutorial-preview-menu-toggle" onClick={() => setTutorialMenuOpen((current) => !current)}>
        {tutorialMenuOpen ? "튜토리얼 목록 접기" : `${tutorialChapter.shortLabel} · 목록`}
      </button>
      {tutorialMenuOpen && <>
        <strong>튜토리얼 전체 보기</strong>
        <div>
          {TUTORIAL_PREVIEW_CHAPTERS.map((chapter) => <button
            key={chapter.id}
            type="button"
            className={chapter.id === tutorialChapter.id ? "active" : ""}
            aria-pressed={chapter.id === tutorialChapter.id}
            onClick={() => {
              setTutorialChapterId(chapter.id);
              presentTutorialStep(chapter.steps[0]);
              setTutorialVisible(true);
              setTutorialMenuOpen(false);
            }}
          >{chapter.shortLabel}</button>)}
        </div>
        <button type="button" className="tutorial-preview-toggle" onClick={() => setTutorialVisible((current) => !current)}>
          {tutorialVisible ? "대화 숨기기" : "대화 다시 보기"}
        </button>
      </>}
    </nav>}
    {tutorialVisible && <TutorialDialogue
      key={tutorialChapter.id}
      chapterLabel={tutorialChapter.label}
      characterSrc={tutorialChapter.characterSrc}
      characterAlt={tutorialChapter.characterAlt}
      characterSprite={{ columns: 3, rows: 2, frames: [0, 1, 2, 5] }}
      steps={tutorialChapter.steps}
      isTargetAction={(step) => (step as TutorialPreviewStep).advanceMode === "target"}
      onStepChange={(step, index) => {
        presentTutorialStep(step as TutorialPreviewStep);
        if (index > 0) setTutorialMenuOpen(false);
      }}
      onComplete={moveToNextTutorialChapter}
      onDismiss={() => setTutorialVisible(false)}
    />}
  </>;

  const usesPreviewWindowStage = activeRoute === "equipment" || activeRoute === "inventory" || activeRoute === "skills" || activeRoute === "gems" || activeRoute === "settings";
  const usesWindowSurface = activeRoute === "equipment" || activeRoute === "inventory" || activeRoute === "skills" || activeRoute === "gems" || activeRoute === "settings" || activeRoute === "liveops";
  const usesManagementPage = activeRoute !== "battle" && !usesWindowSurface;
  /* 본 앱과 같은 자리를 쓴다. 아래 창이 열린 채 남으므로 같은 top layer 에 올려야
     인벤토리 뒤로 깔리지 않는다. */
  const globalOverlayWindow = <>
    {globalOverlay === "market" && <GlobalOverlayWindow labelledBy="market-plaza-title" onClose={() => setGlobalOverlay(null)}><MarketPlaza key={marketInitialMode} initialMode={marketInitialMode} pollingEnabled={false} onClose={() => setGlobalOverlay(null)} /></GlobalOverlayWindow>}
    {globalOverlay === "mail" && <GlobalOverlayWindow labelledBy="mail-title" onClose={() => setGlobalOverlay(null)}><MailScreen dataSource={previewMailDataSource} notices={previewNoticeDataSource} onClose={() => setGlobalOverlay(null)} /></GlobalOverlayWindow>}
  </>;
  if (usesManagementPage) return <>
    <main className={`battle-hud-preview game-shell cozy-management-shell${activeRoute === "ranking" ? " cozy-ranking-shell" : ""}${activeRoute === "cosmetics" ? " cozy-cosmetics-shell" : ""}`}>
      <CozySharedNavigation account={previewProfileAccount} activeRoute={activeRoute} onOpenProfile={() => {
        setProfileInitialTab("profile");
        setProfileOpen(true);
      }} onNavigate={navigate} gemContentUnlocked cosmeticContentUnlocked={previewCharacterStats.cosmeticsUnlocked} topBarOnly={activeRoute === "ranking" || activeRoute === "cosmetics" || activeRoute === "dungeon"} />
      {activeRoute === "ranking" && <RankingScreen />}
      {activeRoute === "cosmetics" && cosmeticTutorialView === "gacha" && <CosmeticsPreviewScreen tutorialRewardId={tutorialChapterId === "stylist" ? "cosmetic-081" : undefined} onOpenInventory={() => setActiveRoute("inventory")} />}
      {activeRoute === "cosmetics" && cosmeticTutorialView === "wardrobe" && <div className="tutorial-character-content"><CostumePanel collection={previewCollection} catalog={previewCharacterData.catalog} pending={false} send={applyPreviewCosmeticCommand} sendBatch={(commands) => commands.forEach(applyPreviewCosmeticCommand)} onGacha={() => setCosmeticTutorialView("gacha")} /></div>}
      {activeRoute === "cosmetics" && cosmeticTutorialView === "gallery" && <div className="tutorial-character-content"><GalleryPanel collection={previewCollection} catalog={previewCharacterData.catalog} pending={false} send={applyPreviewCosmeticCommand} /></div>}
      {activeRoute === "dungeon" && <GemsScreen mode="dungeon" onClose={() => setActiveRoute("battle")} previewStartChallenge={createDungeonPreviewChallenge} />}
      {characterWindow}
      {profileWindow}
      {firstClearWindow}
    </main>
    {globalOverlayWindow}
    {tutorialControls}
  </>;

  return <>
  {/* 실제 앱(main.tsx)의 껍데기를 그대로 흉내낸다. HUD 확정 배치는 무대 폭이
      1600px 로 잠긴 상태를 전제로 잰 값인데, 그 상한은
      `.game-shell:has(.battle-screen-live)` 규칙에서만 걸린다. 미리보기가
      `game-shell` 도 `battle-screen-live` 도 달지 않았던 동안에는 무대가 창 폭을
      그대로 먹어서, 창 크기에 따라 패널이 커 보이거나 작아 보였다.
      PIP 도 `.game-shell > .picture-in-picture-compact` 로만 왼쪽에 붙으므로
      실제 앱과 같이 main 의 직계 자식으로 둔다. */}
  <main className={`battle-hud-preview game-shell ${liveWarningPreview ? "is-live-warning-preview" : ""}`}>
    <PictureInPictureController />
    <section className="battle-screen battle-screen-live" aria-label="전투 화면 미리보기">
    <div
      className="battle-scene-backdrop"
      aria-hidden="true"
      style={{ "--battle-background": `url(${backgroundAsset(null, previewStageId)})` } as React.CSSProperties}
    />
    <section className="battle-stage-shell cozy-battle-stage-shell">
      <BattleProfileSummary account={previewProfileAccount} onOpen={() => {
        setProfileInitialTab("profile");
        setProfileOpen(true);
      }} />
      <TutorialLauncher />
      <div className="cozy-stage-panel-group">
        <BattleStageProgress stages={stages} selectedStageId={previewStageId} remainingSeconds={previewRemainingSeconds} defeatedNormals={finalStageOnly ? 0 : previewDefeatedNormals} bossOnly={finalStageOnly} bossPhase={previewBossPhase || finalStageOnly} stageComplete={false} idleMode={previewIdleMode} idleModeSaving={false} repeatEligible={!finalStageOnly} bossHealth={(previewBossPhase || finalStageOnly) && !warningVisible ? { name: MONSTER_NAMES[previewMonsterId], hp: previewBossHp, maxHp: 782 } : null} onSelectStage={setPreviewStageId} onChangeMode={setPreviewIdleMode} />
        <BattleHistoryPopover />
        <BattleStageRestartButton />
      </div>
      <BattleUtilityNavigation onNavigate={navigate} gemContentUnlocked cosmeticContentUnlocked={previewCharacterStats.cosmeticsUnlocked} />
      <div className={`battle-kitchen ${warningVisible ? "has-boss-warning" : ""}`} style={{ "--battle-background": `url(${backgroundAsset(null, previewStageId)})` } as React.CSSProperties}>
        <div className="kitchen-backdrop" aria-hidden="true" />
        <div className="battle-floor is-engaged" aria-label="자동전투 장면 미리보기">
          <div className="hero-position"><PlayerBattleCharacter appearance={previewCollection} catalog={previewCosmeticCatalog} motion="rest" skillVfx={previewCasterVfx} /></div>
          <div className="monster-party"><ChapterOneMonster id={previewMonsterId} motion="idle" boss={previewIsBoss} hp={bossFightPreview ? 517 : 782} maxHp={782} skillVfx={previewTargetVfx} /></div>
        </div>
        <BattleRewards key={rewardPanelRevision} stageId={previewStageId} rice={previewRewardRice} rewards={previewRewards} />
        <BattlePlayerStatus
          level={previewPlayerStatus.level}
          hp={previewPlayerStatus.hp}
          maxHp={previewPlayerStatus.maxHp}
          experience={previewPlayerStatus.experience}
          experienceRequired={previewPlayerStatus.experienceRequired}
          experiencePercent={Number((previewPlayerStatus.experience / Math.max(1, previewPlayerStatus.experienceRequired) * 100).toFixed(1))}
        />
        <BattleGrowthNavigation onNavigate={navigate} gemContentUnlocked />
      </div>
      <ChatPanel previewMode />
      {warningVisible && <BossArrivalWarning monsterId={previewMonsterId} stageId={previewStageId} finalBoss={finalBossPreview} />}
      <details className="stage-panel-preview-controls">
        <summary>패널 테스트</summary>
        <div>
          <button type="button" onClick={() => {
            setPreviewDefeatedNormals((current) => Math.min(20, current + 1));
            setPreviewPlayerStatus((current) => {
              let level = current.level;
              let experience = current.experience + 1_120;
              let experienceRequired = current.experienceRequired;
              while (level < 500 && experience >= experienceRequired) {
                experience -= experienceRequired;
                level += 1;
                experienceRequired += 1_000;
              }
              return { ...current, level, experience, experienceRequired };
            });
            const riceGained = 15 + Math.floor(Math.random() * 21);
            setPreviewRewardRice((current) => current + riceGained);
            setPreviewProfileAccount((current) => ({ ...current, rice: current.rice + riceGained }));
            const roll = Math.random();
            const droppedItemId = roll < .35 ? "POTATO_M1"
              : roll < .60 ? "CORN_M1"
                : roll < .75 ? "SWEET_POTATO_M1"
                  : roll < .82 ? "skillbook:active_dot:normal"
                    : null;
            if (droppedItemId) setPreviewRewards((current) => {
              const existing = current.find((reward) => reward.itemId === droppedItemId);
              if (!existing) return [...current, { itemId: droppedItemId, requestedQuantity: 1, grantedQuantity: 1, discardedQuantity: 0 }];
              return current.map((reward) => reward.itemId === droppedItemId ? {
                ...reward,
                requestedQuantity: reward.requestedQuantity + 1,
                grantedQuantity: reward.grantedQuantity + 1,
              } : reward);
            });
          }}>몬스터 1마리 처치 (확률 보상)</button>
          <button type="button" onClick={() => setPreviewPlayerStatus((current) => ({ ...current, hp: Math.max(0, current.hp - 500) }))}>플레이어 HP -500</button>
          <button type="button" onClick={() => {
            setPreviewStageId((current) => {
              const index = stages.findIndex((stage) => stage.stageId === current);
              return index >= 0 && index < stages.length - 1 ? stages[index + 1].stageId : stages[0]?.stageId ?? current;
            });
            setPreviewPlayerStatus((current) => ({ ...current, hp: current.maxHp }));
          }}>다음 스테이지 진입 (HP 회복)</button>
          <button type="button" onClick={() => setPreviewPlayerStatus((current) => ({ ...current, experience: Math.max(0, current.experienceRequired - 500) }))}>레벨업 직전 EXP</button>
          <button type="button" onClick={() => setPreviewBossPhase((current) => !current)}>{previewBossPhase ? "일반 진행" : "보스 등장"}</button>
          <button type="button" onClick={() => setPreviewBossHp((current) => Math.max(0, current - 100))}>보스 HP -100</button>
          <button type="button" onClick={() => setPreviewRemainingSeconds((current) => current === null ? 42 : null)}>{previewRemainingSeconds === null ? "제한시간 표시" : "제한시간 없음"}</button>
          <button type="button" onClick={() => setPreviewTimerRunning((current) => !current)} disabled={previewRemainingSeconds === null}>{previewTimerRunning ? "시간 정지" : "시간 재생"}</button>
          <button type="button" onClick={() => {
            const sequence = Date.now();
            window.dispatchEvent(new CustomEvent("hanjjak:preview-chat", { detail: {
              messageId: `preview-chat-${sequence}`,
              accountId: "preview-newcomer",
              nickname: "새싹농부",
              primaryMaterialType: "CORN",
              body: "패널 테스트에서 추가한 새 채팅이에요!",
              createdAt: new Date().toISOString(),
              eventId: `preview-chat-event-${sequence}`,
            } }));
          }}>새 채팅 1개 추가</button>
          <button type="button" onClick={() => {
            setPreviewDefeatedNormals(7);
            setPreviewBossPhase(false);
            setPreviewBossHp(517);
            setPreviewRemainingSeconds(21);
            setPreviewTimerRunning(false);
            setPreviewRewardRice(INITIAL_PREVIEW_REWARD_RICE);
            setPreviewRewards(INITIAL_PREVIEW_REWARDS.map((reward) => ({ ...reward })));
            setPreviewProfileAccount((current) => ({ ...current, rice: 15_820 }));
            setPreviewPlayerStatus({ level: 24, hp: 2_680, maxHp: 3_680, experience: 14_976, experienceRequired: 24_000 });
            client.setQueryData(["chat", "messages"], { ...previewChat, items: previewChat.items.map((message) => ({ ...message })), unreadCount: 0 });
            client.setQueryData(["chat", "blocks"], []);
            setRewardPanelRevision((current) => current + 1);
          }}>초기화</button>
        </div>
      </details>
    </section>
    </section>
    {/*
      * 거래소·메시지함은 dialog 가 아니라 화면을 덮는 칸이라 이 무대가 필요 없다.
      * 무대를 씌우면 빈 장막만 덮여 창이 열리지 않은 것처럼 보였다.
      */}
    {tutorialPreviewEnabled && usesPreviewWindowStage && <div className="tutorial-preview-window-stage">
      {activeRoute === "equipment" && <div className="equipment-window tutorial-preview-window"><EquipmentScreen previewData={previewEquipmentState} previewCommand={executePreviewEquipmentCommand} /></div>}
      {activeRoute === "inventory" && <div className="inventory-window tutorial-preview-window"><InventoryScreen dataSource={previewInventoryDataSource} /></div>}
      {activeRoute === "skills" && <div className="skills-window tutorial-preview-window"><SkillsScreen /></div>}
      {activeRoute === "gems" && <div className="gem-management-dialog tutorial-preview-window"><GemManagement previewFuse={executePreviewGemFusion} /></div>}
      {activeRoute === "settings" && <div className="tutorial-preview-window"><ProfileScreen open inline initialTab="settings" onClose={() => setActiveRoute("battle")} /></div>}
    </div>}
    {!tutorialPreviewEnabled && activeRoute === "equipment" && <EquipmentWindow open previewData={previewEquipmentState} previewCommand={executePreviewEquipmentCommand} onClose={() => setActiveRoute("battle")} />}
    {!tutorialPreviewEnabled && activeRoute === "inventory" && <InventoryWindow open dataSource={previewInventoryDataSource} onClose={() => setActiveRoute("battle")} onSell={(itemId) => {
      selectMarketItemForSale(window.sessionStorage, itemId);
      setMarketInitialMode("sell");
      setGlobalOverlay("market");
    }} />}
    {!tutorialPreviewEnabled && activeRoute === "skills" && <SkillWindow open onClose={() => setActiveRoute("battle")} />}
    {!tutorialPreviewEnabled && activeRoute === "gems" && <GemsScreen mode="manage" onClose={() => setActiveRoute("battle")} />}
    {activeRoute === "liveops" && <LiveopsScreen dataSource={liveopsDataSource} onClose={() => setActiveRoute("battle")} />}
    {globalOverlayWindow}
    {!tutorialPreviewEnabled && activeRoute === "settings" && <ProfileScreen open initialTab="settings" onClose={() => setActiveRoute("battle")} />}
    {characterWindow}
    {profileWindow}
    {firstClearWindow}
  </main>
  {tutorialControls}
  </>;
}

/*
 * 프리뷰가 쓰는 자료는 전부 아래에서 심어 둔 가짜다. react-query 는 화면을 닫고
 * 5분(gcTime 기본값)이 지나면 이 자료를 치우는데, 그러면 보석·스킬·거래소를 다시 열 때
 * 없는 서버로 진짜 요청이 나가 영영 "불러오는 중"에 머문다. 캐릭터·장비·아이템은
 * 값을 props 로 받아 멀쩡해 보이는 탓에 세 화면만 안 열리는 것처럼 보였다.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: Number.POSITIVE_INFINITY },
    mutations: { retry: false },
  },
});
const dungeonPreviewBattle = new URLSearchParams(globalThis.location.search).get("battle") === "1";
export function createDungeonPreviewChallenge(stage = 5) {
  const dungeonPreviewNow = Date.now();
  return {
  challengeId: "preview-dungeon-berserk",
  boss: "BERSERK" as const,
  stage,
  status: "ACTIVE" as const,
  minimumCompleteAt: new Date(dungeonPreviewNow + 15_000).toISOString(),
  expiresAt: new Date(dungeonPreviewNow + 30_000).toISOString(),
  rewardGemBoxes: 1,
  contentVersion: "preview",
  battle: {
    success: true,
    failureCode: null,
    elapsedTicks: 150,
    remainingPlayerHp: 1_568,
    remainingBossHp: 0,
    events: [
      { sequence: 1, tick: 0, type: "BATTLE_START" as const, skillId: null, amount: 0, playerHp: 2_008, bossHp: 44_308, critical: false },
      { sequence: 2, tick: 0, type: "SKILL_CAST" as const, skillId: "active_haste", amount: 0, playerHp: 2_008, bossHp: 44_308, critical: false },
      { sequence: 3, tick: 4, type: "SKILL_CAST" as const, skillId: "active_dot", amount: 0, playerHp: 2_008, bossHp: 44_308, critical: false },
      { sequence: 4, tick: 8, type: "SKILL_CAST" as const, skillId: "active_basic_amp", amount: 0, playerHp: 2_008, bossHp: 44_308, critical: false },
      { sequence: 5, tick: 12, type: "PLAYER_HIT" as const, skillId: "active_heavy", amount: 5_840, playerHp: 2_008, bossHp: 38_468, critical: true },
      { sequence: 6, tick: 16, type: "PLAYER_HIT" as const, skillId: null, amount: 1_800, playerHp: 2_008, bossHp: 36_668, critical: false },
      { sequence: 7, tick: 20, type: "BOSS_HIT" as const, skillId: null, amount: 220, playerHp: 1_788, bossHp: 36_668, critical: false },
      { sequence: 8, tick: 30, type: "PLAYER_HIT" as const, skillId: null, amount: 1_800, playerHp: 1_788, bossHp: 34_868, critical: false },
      { sequence: 9, tick: 44, type: "PLAYER_HIT" as const, skillId: null, amount: 1_800, playerHp: 1_788, bossHp: 33_068, critical: false },
      { sequence: 10, tick: 58, type: "PLAYER_HIT" as const, skillId: null, amount: 1_800, playerHp: 1_788, bossHp: 31_268, critical: false },
      { sequence: 11, tick: 72, type: "PLAYER_HIT" as const, skillId: null, amount: 1_800, playerHp: 1_788, bossHp: 29_468, critical: false },
      { sequence: 12, tick: 86, type: "PLAYER_HIT" as const, skillId: null, amount: 1_800, playerHp: 1_788, bossHp: 27_668, critical: false },
      { sequence: 13, tick: 100, type: "SKILL_CAST" as const, skillId: "active_haste", amount: 0, playerHp: 1_788, bossHp: 27_668, critical: false },
      { sequence: 14, tick: 104, type: "SKILL_CAST" as const, skillId: "active_dot", amount: 0, playerHp: 1_788, bossHp: 27_668, critical: false },
      { sequence: 15, tick: 108, type: "SKILL_CAST" as const, skillId: "active_basic_amp", amount: 0, playerHp: 1_788, bossHp: 27_668, critical: false },
      { sequence: 16, tick: 112, type: "PLAYER_HIT" as const, skillId: "active_heavy", amount: 5_840, playerHp: 1_788, bossHp: 21_828, critical: true },
      { sequence: 17, tick: 116, type: "PLAYER_HIT" as const, skillId: null, amount: 4_828, playerHp: 1_788, bossHp: 17_000, critical: false },
      { sequence: 18, tick: 128, type: "PLAYER_HIT" as const, skillId: null, amount: 6_000, playerHp: 1_788, bossHp: 11_000, critical: true },
      { sequence: 19, tick: 140, type: "PLAYER_HIT" as const, skillId: null, amount: 11_000, playerHp: 1_788, bossHp: 0, critical: true },
      { sequence: 20, tick: 150, type: "VICTORY" as const, skillId: null, amount: 0, playerHp: 1_568, bossHp: 0, critical: false },
    ],
  },
  };
}
const dungeonPreviewChallenge = dungeonPreviewBattle ? createDungeonPreviewChallenge() : null;
queryClient.setQueryDefaults(["gems"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryData(["gems"], previewTutorialGemState);
queryClient.setQueryDefaults(["gem-dungeons", "today"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryData(["gem-dungeons", "today", undefined], {
  boss: "BERSERK",
  tickets: 3,
  secondsUntilNextTicket: 27_142,
  progress: [{ boss: "SURVIVAL", highestClearedStage: 4 }, { boss: "BERSERK", highestClearedStage: 2 }, { boss: "ARMORED", highestClearedStage: 3 }],
  nextChallengeStage: 5,
  sweepStage: 4,
  nextChallengeRewardGemBoxes: 14,
  sweepRewardGemBoxesPerTicket: 3,
  activeChallenge: dungeonPreviewChallenge,
  testBossSelectionEnabled: false,
  rankings: {
    SURVIVAL: {
      topEntries: [
        { rank: 1, nickname: "우동조아", stage: 30, clearedAt: "2026-09-17T04:12:00+09:00" },
        { rank: 2, nickname: "면사랑", stage: 30, clearedAt: "2026-09-17T04:37:00+09:00" },
        { rank: 3, nickname: "국물요정", stage: 29, clearedAt: "2026-09-17T05:01:00+09:00" },
        { rank: 4, nickname: "면돌이", stage: 28, clearedAt: "2026-09-17T05:21:00+09:00" },
        { rank: 5, nickname: "쫄깃한인생", stage: 28, clearedAt: "2026-09-17T05:44:00+09:00" },
      ],
      myEntry: { rank: 128, nickname: "한짝짱", stage: 4, clearedAt: "2026-09-17T12:37:00+09:00" },
    },
    BERSERK: {
      topEntries: [
        { rank: 1, nickname: "알장인", stage: 27, clearedAt: "2026-09-17T03:58:00+09:00" },
        { rank: 2, nickname: "메추리왕", stage: 26, clearedAt: "2026-09-17T04:26:00+09:00" },
        { rank: 3, nickname: "단짠고수", stage: 25, clearedAt: "2026-09-17T05:13:00+09:00" },
        { rank: 4, nickname: "간장한스푼", stage: 24, clearedAt: "2026-09-17T06:02:00+09:00" },
        { rank: 5, nickname: "밥도둑", stage: 24, clearedAt: "2026-09-17T06:41:00+09:00" },
      ],
      myEntry: { rank: 241, nickname: "한짝짱", stage: 2, clearedAt: "2026-09-17T13:08:00+09:00" },
    },
    ARMORED: {
      topEntries: [
        { rank: 1, nickname: "도토리묵", stage: 25, clearedAt: "2026-09-17T04:04:00+09:00" },
        { rank: 2, nickname: "묵사발", stage: 24, clearedAt: "2026-09-17T04:51:00+09:00" },
        { rank: 3, nickname: "참나무", stage: 23, clearedAt: "2026-09-17T05:22:00+09:00" },
        { rank: 4, nickname: "탱글한묵", stage: 22, clearedAt: "2026-09-17T06:17:00+09:00" },
        { rank: 5, nickname: "도토리수집가", stage: 21, clearedAt: "2026-09-17T07:03:00+09:00" },
      ],
      myEntry: { rank: 196, nickname: "한짝짱", stage: 3, clearedAt: "2026-09-17T12:52:00+09:00" },
    },
  },
});
queryClient.setQueryDefaults(["combat-power-ranking"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryDefaults(["auth", "session"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryData(["auth", "session"], { authenticated: true, account: previewAccount });
queryClient.setQueryData(["combat-power-ranking"], previewCombatPowerRanking);
/* 프로필이 첫 화면에서 바로 구독한다. 렌더 뒤 effect에서 넣으면 그 전에 실제 API가
   시작되어 미리보기인데도 UNAUTHORIZED가 남는다. 루트 렌더 전에 넣어 둔다. */
queryClient.setQueryData(["cosmetic-collection"], previewCosmeticCollection);
queryClient.setQueryData(["cosmetic-catalog"], previewCosmeticCatalog);
queryClient.setQueryDefaults(["chat", "messages"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryData(["chat", "messages"], previewChat);
queryClient.setQueryData(["chat", "blocks"], []);
queryClient.setQueryDefaults(["skills"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryData(["skills"], previewSkillState);
queryClient.setQueryDefaults(["market-instruments"], { staleTime: Number.POSITIVE_INFINITY, retry: false });
queryClient.setQueryData(["market-instruments"], previewMarketCatalog());
queryClient.setQueryData(["equipment-market-best-ask", previewMarketInstrument.instrumentId, 1], {
  instrumentId: previewMarketInstrument.instrumentId,
  requestedQuantity: 1,
  expectedFilledQuantity: 1,
  expectedRemainingQuantity: 0,
  lowestFilledUnitPrice: previewMarketInstrument.bestAskUnitPrice,
  highestFilledUnitPrice: previewMarketInstrument.bestAskUnitPrice,
  weightedAverageUnitPrice: previewMarketInstrument.bestAskUnitPrice,
  totalPrice: previewMarketInstrument.bestAskUnitPrice,
  availableRice: previewEquipmentState.riceBalance,
  marketRevision: 1,
});
queryClient.setQueryData(["equipment-market-quote", previewMarketInstrument.instrumentId, 9, previewMarketInstrument.bestAskUnitPrice], {
  instrumentId: previewMarketInstrument.instrumentId,
  requestedQuantity: 9,
  expectedFilledQuantity: 9,
  expectedRemainingQuantity: 0,
  lowestFilledUnitPrice: previewMarketInstrument.bestAskUnitPrice,
  highestFilledUnitPrice: previewMarketInstrument.bestAskUnitPrice,
  weightedAverageUnitPrice: previewMarketInstrument.bestAskUnitPrice,
  totalPrice: 855,
  availableRice: previewEquipmentState.riceBalance,
  marketRevision: 1,
});
queryClient.setQueryData(["equipment-market-quote", previewMarketInstrument.instrumentId, 9, previewMarketInstrument.bestAskUnitPrice, 1], queryClient.getQueryData(["equipment-market-quote", previewMarketInstrument.instrumentId, 9, previewMarketInstrument.bestAskUnitPrice]));
queryClient.setQueryData(["market-order-book", previewMarketInstrument.instrumentId], {
  instrumentId: previewMarketInstrument.instrumentId,
  marketRevision: 1,
  bids: [{ unitPrice: 90, totalQuantity: 80, myQuantity: 0 }],
  asks: [{ unitPrice: 95, totalQuantity: 120, myQuantity: 0 }],
  bestBidUnitPrice: 90,
  bestAskUnitPrice: 95,
  spread: 5,
  recentTrades: [],
});
queryClient.setQueryData(["inventory", "market", previewMarketInstrument.itemId], { availableQuantity: 530 });
queryClient.setQueryData(["market-orders"], { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 });
queryClient.setQueryData(["market-orders", "active"], { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 });
queryClient.setQueryData(["market-orders", "closed"], { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 });
queryClient.setQueryData(["market-deliveries"], { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 });
queryClient.setQueryData(["market-mails"], { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 });
queryClient.setQueryData(["mails"], { items: previewMails, nextCursor: null, totalItems: previewMails.length });
queryClient.setQueryData(["market-summary"], { activeOrders: 0, closedOrders: 0, recoveryReviewOrders: 0, claimableDeliveries: 0, claimableSettlements: 0, unread: [] });
/* 실제 화면의 이벤트 버튼은 진행 중이거나 남은 티켓이 있을 때만 나타난다.
   정적 HUD 프리뷰에서도 맨 왼쪽 배치를 바로 확인할 수 있게 열린 이벤트를 심는다. */
queryClient.setQueryData(["liveops-state"], PREVIEW_LIVEOPS_STATE);
queryClient.setQueryData(["market-trades", previewMarketInstrument.instrumentId], { items: [], nextCursor: null, totalItems: 0, readThroughSequence: 0 });
queryClient.setQueryData(["market-trades", "me"], []);

const root = document.getElementById("root");
if (root) createRoot(root).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><BattleHudPreview /></QueryClientProvider></React.StrictMode>,
);
