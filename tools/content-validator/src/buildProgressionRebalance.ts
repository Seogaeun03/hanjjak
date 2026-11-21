import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const BALANCE_VERSION = "progression-rebalance-v1" as const;
/** 콘텐츠가 담는 마지막 챕터. 스테이지는 챕터당 10개다. */
export const LAST_CHAPTER = 15;
const LAST_STAGE_INDEX = LAST_CHAPTER * 10;
export const CONTENT_FILES = [
  "chapters/chapters.json",
  "stages/stages.json",
  "drops/material-drops.json",
  "progression/progression.json",
  "equipment/equipment.json",
  "skills/skills.json",
  "gem-dungeons/gem-dungeons.json",
  "cosmetics/cosmetics.json",
] as const;
type Authority = "working" | "applied";
type Grade = "NORMAL" | "RARE" | "EPIC" | "LEGENDARY" | "MYTHIC";
export type RewardItem = { itemId: string; quantity: number };
export type FirstClear = { rice: number; tickets: number; items: RewardItem[]; directSkillId: string | null } | null;
export type ProgressionStage = {
  stageId: string;
  normalExperience: number;
  bossExperience: number;
  normalRice: number;
  bossRice: number;
  firstClear: FirstClear;
};
export type ProgressionContent = {
  authority: Authority;
  contentVersion: string;
  levelRange: { min: 1; max: 300 } | null;
  stages: ProgressionStage[];
};
export type EquipmentBalanceContent = {
  authority: Authority;
  contentVersion: string;
  compatibilityOnly: boolean;
  enhancementMaterials: Record<Grade, Record<string, number[]>>;
  enhancementRice: Record<Grade, number[]>;
  promotion: Record<Grade, { requiredStageId: string; materials: Record<string, number>; rice: number; resultGrade: Grade }>;
};
export type MaterialDropChapter = {
  mode: "GUARANTEED" | "CHANCE";
  normalQuantity: number;
  bossQuantity: number;
  generationWeights: number[];
};
export type MaterialDropsContent = {
  authority: Authority;
  contentVersion: string;
  dropChanceBasisPoints: number;
  quantityPerSuccess: number;
  normalEnemyRolls: number;
  bossRolls: number;
  chapterGenerationWeights: Record<string, number[]>;
  chapters: Record<string, MaterialDropChapter>;
};

const firstClear = {
  chapter1M1: [178, 356, 533, 711, 889, 1_067, 1_244, 1_422, 1_600],
  chapter1Rice: [1_392, 2_784, 4_176, 5_568, 6_960, 8_352, 9_744, 11_136, 12_528],
  chapter2M1: [148, 296, 444, 592, 740, 888, 1_036, 1_184, 1_332],
  chapter2M2: [16, 32, 48, 64, 80, 96, 112, 128, 144],
  chapter2Rice: [1_566, 3_132, 4_698, 6_264, 7_830, 9_396, 10_962, 12_528, 14_094],
  chapter3M1: [99, 197, 296, 395, 493, 592, 691, 789, 888],
  chapter3M2: [11, 21, 32, 43, 53, 64, 75, 85, 96],
  chapter3Rice: [1_044, 2_088, 3_132, 4_176, 5_220, 6_264, 7_308, 8_352, 9_396],
  /* 4장부터 F(M1)는 주지 않는다. 자동 파밍 드롭 가중치가 125:25:5:1 이라 F 는 남아돌고
     거래소에서 가장 싸다. 보상은 병목인 D 이상만 채운다. 4~7장은 영웅 1→30강 비용의
     D 40%·C 40%, 6~7장의 B 는 전설 1→30강 비용의 10% 다. */
  midM2: [110, 220, 330, 439, 549, 659, 769, 879, 989],
  midM3: [22, 44, 66, 88, 110, 132, 154, 176, 197],
  midM4: [4, 9, 13, 17, 21, 25, 30, 34, 38],
  /* 8~10장은 전설 1→30강 비용의 C 20%·B 30%·A 40% 다. A(M5)는 소비처가 아직 없어
     세대 1/5 사다리로 전설 M4 비용을 연장한 382 를 기준값으로 썼다. */
  lateM3: [42, 85, 127, 170, 212, 254, 297, 339, 382],
  lateM4: [13, 25, 38, 51, 64, 76, 89, 102, 114],
  lateM5: [3, 7, 10, 14, 17, 20, 24, 27, 31],
  /* 11장부터는 C(M3)도 닫고 B·A 로 간다. 신화 1→30강 6부위 비용(M4 7,200·M5 2,160)의
     10% 씩을 장마다 1~9스테이지에 k/9 로 나눈다. 다섯 장을 다 깨면 신화 소요의 50% 다.
     나머지는 반복 파밍으로 채워 신화의 M5 단독 병목을 남긴다. */
  mythicM4: [16, 32, 48, 64, 80, 96, 112, 128, 144],
  mythicM5: [5, 10, 14, 19, 24, 29, 34, 38, 43],
  chapter4Rice: [2_610, 5_220, 7_830, 10_440, 13_050, 15_660, 18_270, 20_880, 23_490],
} as const;
/* 치장 뽑기권은 쌀과 같이 지갑으로 들어간다. 가방 칸을 쓰지 않으므로 재료와 달리
   수용량 제약을 받지 않는다. 장마다 1~9스테이지에 이 수량씩 지급한다. */
const firstClearTickets: Record<number, number> = { 5: 10, 6: 20, 7: 20, 8: 30, 9: 30, 10: 30, 11: 30, 12: 30, 13: 30, 14: 30, 15: 30 };
/* 4장부터 장 마지막 스테이지는 뽑기권만 준다. 레이드 보상 정본이 확정되기 전까지
   재료 수치를 만들지 않는다는 방침은 유지하고, 빈 보상만 채운다. */
const CHAPTER_END_TICKETS = 20;
const materialFamilies = ["POTATO", "SWEET_POTATO", "CORN"] as const;
const grades: Grade[] = ["NORMAL", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];
/** legacy(v1) 콘텐츠는 4등급에서 멈춘다. 신화는 리밸런스 표에서만 온다. */
const legacyGrades: Grade[] = ["NORMAL", "RARE", "EPIC", "LEGENDARY"];
/* 스킬은 스킬북으로만 연다. 스테이지를 깼다고 저절로 열리면, 곧 열릴 스킬인 줄
   모르고 귀한 스킬북을 먼저 써 버리는 일이 생긴다. 대신 챕터 1 초반 네 스테이지가
   액티브 네 종의 노말 책을 한 권씩 최초 클리어 보상으로 주어, 드롭 운과 무관하게
   해금을 시작할 수 있게 한다. */
const chapterOneUnlockBooks: Record<number, string> = {
  2: "active_heavy",
  3: "active_dot",
  4: "active_haste",
  5: "active_basic_amp",
};

function stageId(globalIndex: number): string {
  return `stage.${String(Math.floor((globalIndex - 1) / 10) + 1).padStart(2, "0")}-${String(((globalIndex - 1) % 10) + 1).padStart(2, "0")}`;
}
function rewardMaterials(generation: number, quantity: number): RewardItem[] {
  return materialFamilies.map((family) => ({ itemId: `${family}_M${generation}`, quantity }));
}
function firstClearFor(globalIndex: number): FirstClear {
  const chapter = Math.floor((globalIndex - 1) / 10) + 1;
  const number = ((globalIndex - 1) % 10) + 1;
  if (number === 10) {
    // 1-10 은 노말->희귀 승급 비용을 그대로 준다.
    if (chapter === 1) return { rice: 870, tickets: 0, items: [...rewardMaterials(1, 74), ...rewardMaterials(2, 2)], directSkillId: null };
    if (chapter === 2) return { rice: 0, tickets: 0, items: [{ itemId: "GEM_BOX", quantity: 6 }], directSkillId: null };
    // 3-10 은 희귀->영웅 승급 비용을 그대로 준다. 깨자마자 승급할 수 있어야 한다.
    if (chapter === 3) return { rice: 1_770, tickets: 0, items: [...rewardMaterials(1, 206), ...rewardMaterials(2, 41), ...rewardMaterials(3, 1), { itemId: "GEM_BOX", quantity: 30 }], directSkillId: null };
    return { rice: 0, tickets: CHAPTER_END_TICKETS, items: [], directSkillId: null };
  }
  if (chapter === 1) {
    const unlockBook = chapterOneUnlockBooks[number];
    const books: RewardItem[] = unlockBook ? [{ itemId: `skillbook:${unlockBook}:normal`, quantity: 1 }] : [];
    return { rice: firstClear.chapter1Rice[number - 1]!, tickets: 0, items: [...rewardMaterials(1, firstClear.chapter1M1[number - 1]!), ...books], directSkillId: null };
  }
  if (chapter === 2) return { rice: firstClear.chapter2Rice[number - 1]!, tickets: 0, items: [...rewardMaterials(1, firstClear.chapter2M1[number - 1]!), ...rewardMaterials(2, firstClear.chapter2M2[number - 1]!)], directSkillId: null };
  if (chapter === 3) return { rice: firstClear.chapter3Rice[number - 1]!, tickets: 0, items: [...rewardMaterials(1, firstClear.chapter3M1[number - 1]!), ...rewardMaterials(2, firstClear.chapter3M2[number - 1]!), { itemId: "GEM_BOX", quantity: 10 }], directSkillId: null };
  const rice = firstClear.chapter4Rice[number - 1]!;
  const tickets = firstClearTickets[chapter] ?? 0;
  /* 보상 창은 장이 오를수록 세대 사다리를 위로 미끄러진다. 4~5장은 D·C, 6~7장은 B 가 붙고,
     8장부터는 D 를 닫고 C·B·A 로 간다. 11장부터는 C 도 닫고 B·A 만 준다. */
  if (chapter <= 7) {
    const boost = chapter >= 6 ? rewardMaterials(4, firstClear.midM4[number - 1]!) : [];
    return { rice, tickets, items: [...rewardMaterials(2, firstClear.midM2[number - 1]!), ...rewardMaterials(3, firstClear.midM3[number - 1]!), ...boost], directSkillId: null };
  }
  if (chapter <= 10) {
    return { rice, tickets, items: [...rewardMaterials(3, firstClear.lateM3[number - 1]!), ...rewardMaterials(4, firstClear.lateM4[number - 1]!), ...rewardMaterials(5, firstClear.lateM5[number - 1]!)], directSkillId: null };
  }
  return { rice, tickets, items: [...rewardMaterials(4, firstClear.mythicM4[number - 1]!), ...rewardMaterials(5, firstClear.mythicM5[number - 1]!)], directSkillId: null };
}
function buildProgression(authority: Authority, contentVersion: string, rebalance: boolean): ProgressionContent {
  return {
    authority,
    contentVersion,
    levelRange: rebalance ? { min: 1, max: 300 } : null,
    stages: Array.from({ length: rebalance ? LAST_STAGE_INDEX : 40 }, (_, offset) => {
      const globalIndex = offset + 1;
      const referenceLevel = 2 * globalIndex - 1;
      const levelMinutes = rebalance ? 2 + (11 / 90) * (2 * referenceLevel - 1) : 6 + (11 / 30) * (2 * referenceLevel - 1);
      const normalExperience = Math.max(1, Math.round(1_000 * referenceLevel / (50 * levelMinutes)));
      return { stageId: stageId(globalIndex), normalExperience, bossExperience: normalExperience * 5, normalRice: globalIndex, bossRice: globalIndex * 10, firstClear: rebalance ? firstClearFor(globalIndex) : null };
    }),
  };
}
export function buildLegacyProgressionContent(): ProgressionContent { return buildProgression("applied", "v1", false); }
export function buildProgressionRebalanceContent(): ProgressionContent { return buildProgression("applied", BALANCE_VERSION, true); }
const BRACKET_COUNTS = [10, 10, 9];
const BRACKET_SHARES = [0.2, 0.3, 0.5];
function splitBracketTotal(total: number): number[] {
  const counts = BRACKET_COUNTS;
  const shares = BRACKET_SHARES;
  const values: number[] = [];
  for (let bracket = 0; bracket < counts.length; bracket += 1) {
    const count = counts[bracket]!;
    const target = Math.round(total * shares[bracket]!);
    const base = Math.floor(target / count);
    const remainder = target - base * count;
    for (let index = 0; index < count; index += 1) values.push(base + (index >= count - remainder ? 1 : 0));
  }
  const difference = total - values.reduce((sum, value) => sum + value, 0);
  for (let index = values.length - 1; index >= 0 && index >= values.length - difference; index -= 1) values[index]! += 1;
  return values;
}
function normalMaterialSteps(): number[] { return [...Array.from({ length: 10 }, () => 40), ...Array.from({ length: 10 }, () => 60), ...Array.from({ length: 9 }, () => 74)]; }
function legacyMaterialSteps(grade: Grade): Record<string, number[]> {
  const gradeIndex = grades.indexOf(grade);
  const result: Record<string, number[]> = {};
  for (let generation = 1; generation <= gradeIndex + 1; generation += 1) result[`M${generation}`] = Array.from({ length: 29 }, (_, offset) => Math.ceil((gradeIndex * 30 + offset + 1) / 10) * GENERATION_WEIGHTS[generation - 1]!);
  return result;
}
function riceSteps(grade: Grade): number[] { const gradeIndex = grades.indexOf(grade); return Array.from({ length: 29 }, (_, offset) => 30 * (gradeIndex * 30 + offset + 1)); }
/** splitBracketTotal hands this share of a total to each step of its first bracket, so a grade
 *  whose total is the previous grade's closing step divided by it opens exactly where that grade
 *  left off, and no generation ever costs less after a promotion than before it. */
const OPENING_STEP_SHARE = BRACKET_SHARES[0]! / BRACKET_COUNTS[0]!;
function carryOverTotal(previous: number[]): number { return Math.round(previous.at(-1)! / OPENING_STEP_SHARE); }
/** Materials drop at 125:25:5:1 by generation, so each generation costs a fifth of the one before it. */
const GENERATION_RATIO = 5;
const GENERATION_WEIGHTS = [0, 1, 2, 3].map((generation) => 125 / GENERATION_RATIO ** generation);
/** 상위 세대일수록 가파르게. 신화를 상위 재화 싸움으로 만든다. M1·M2 는 사다리 그대로. */
const MYTHIC_GENERATION_MULTIPLIERS = [1, 1, 1.5, 2, 3];
function mythicMaterialSteps(legendary: Record<string, number[]>): Record<string, number[]> {
  const m1Total = carryOverTotal(legendary.M1!);
  const steps: Record<string, number[]> = {};
  for (let generation = 1; generation <= 5; generation += 1) {
    const ladderTotal = Math.round(m1Total / GENERATION_RATIO ** (generation - 1));
    const total = ladderTotal * MYTHIC_GENERATION_MULTIPLIERS[generation - 1]!;
    steps[`M${generation}`] = splitBracketTotal(total);
  }
  return steps;
}
/** 두 불변식(세대 1/5 사다리, 등급 경계 비감소)이 정확히 양립하지 않는 구간에서는 경계를 우선해,
 *  1/5 목표 총량에서 다음 등급의 여는 단계를 넘지 않을 때까지 낮춘 총량을 쓴다. */
function ladderTotalWithin(target: number, nextOpeningStep: number): number {
  let total = target;
  while (total > 1 && splitBracketTotal(total).at(-1)! > nextOpeningStep) total -= 1;
  return total;
}
/* 소비 비율이 드롭 가중치(125:25:5:1)와 어긋나면 플레이어는 모자란 세대를 찾아 앞 챕터로
   돌아간다. 희귀의 M2 를 1/5 사다리에 맞춰 그 유인을 없앤다. */
function rebalanceMaterialSteps(): Record<Grade, Record<string, number[]>> {
  const normalM1 = normalMaterialSteps();
  const rareM1 = splitBracketTotal(carryOverTotal(normalM1));
  const rareTotal = rareM1.reduce((sum, value) => sum + value, 0);
  const epicM1 = splitBracketTotal(carryOverTotal(rareM1));
  const epicTotal = epicM1.reduce((sum, value) => sum + value, 0);
  const epicM2 = splitBracketTotal(Math.round(epicTotal / GENERATION_RATIO));
  const rareM2 = splitBracketTotal(ladderTotalWithin(Math.round(rareTotal / GENERATION_RATIO), epicM2[0]!));
  const legendary = legacyMaterialSteps("LEGENDARY");
  return {
    NORMAL: { M1: normalM1 },
    RARE: { M1: rareM1, M2: rareM2 },
    EPIC: { M1: epicM1, M2: epicM2, M3: splitBracketTotal(Math.round(epicTotal / GENERATION_RATIO ** 2)) },
    LEGENDARY: legendary,
    MYTHIC: mythicMaterialSteps(legendary),
  };
}
/** Promotion costs one closing enhancement step of everything the grade already spends, plus the
 *  SSOT's starter of the generation the next grade unlocks: 10% of that grade's opening step,
 *  always rounded up and never zero. */
const UNLOCKED_STARTER_SHARE = 0.1;
function promotionCost(current: Record<string, number[]>, next: Record<string, number[]>, unlocked: string): Record<string, number> {
  const closing = Object.fromEntries(Object.entries(current).map(([generation, values]) => [generation, values.at(-1)!]));
  const starter = Math.max(1, Math.ceil(UNLOCKED_STARTER_SHARE * next[unlocked]![0]!));
  return { ...closing, [unlocked]: starter };
}
/** `steps` is null on the legacy path, whose promotion rows are frozen literals. Passing the
 *  rebalance schedule in keeps the promotion rows and the materials table one and the same object. */
function promotions(steps: Record<Grade, Record<string, number[]>> | null): EquipmentBalanceContent["promotion"] {
  const closingRice = (grade: Grade) => riceSteps(grade).at(-1)!;
  return {
    NORMAL: { requiredStageId: "stage.01-10", materials: steps ? promotionCost(steps.NORMAL, steps.RARE, "M2") : { M2: 10 }, rice: steps ? closingRice("NORMAL") : 1_000, resultGrade: "RARE" },
    RARE: { requiredStageId: steps ? "stage.03-10" : "stage.02-10", materials: steps ? promotionCost(steps.RARE, steps.EPIC, "M3") : { M3: 10 }, rice: steps ? closingRice("RARE") : 5_000, resultGrade: "EPIC" },
    EPIC: { requiredStageId: steps ? "stage.05-10" : "stage.03-10", materials: steps ? promotionCost(steps.EPIC, steps.LEGENDARY, "M4") : { M4: 10 }, rice: steps ? closingRice("EPIC") : 25_000, resultGrade: "LEGENDARY" },
    LEGENDARY: steps
      ? { requiredStageId: "stage.07-10", materials: promotionCost(steps.LEGENDARY, steps.MYTHIC, "M5"), rice: closingRice("LEGENDARY"), resultGrade: "MYTHIC" }
      : { requiredStageId: "stage.99-99", materials: {}, rice: 0, resultGrade: "LEGENDARY" },
    MYTHIC: { requiredStageId: "stage.99-99", materials: {}, rice: 0, resultGrade: "MYTHIC" },
  };
}
export function buildLegacyEquipmentContent(): EquipmentBalanceContent {
  return { authority: "applied", contentVersion: "v1", compatibilityOnly: true, enhancementMaterials: Object.fromEntries(legacyGrades.map((grade) => [grade, legacyMaterialSteps(grade)])) as EquipmentBalanceContent["enhancementMaterials"], enhancementRice: Object.fromEntries(legacyGrades.map((grade) => [grade, riceSteps(grade)])) as EquipmentBalanceContent["enhancementRice"], promotion: promotions(null) };
}
export function buildProgressionEquipmentContent(): EquipmentBalanceContent {
  const steps = rebalanceMaterialSteps();
  return { authority: "applied", contentVersion: BALANCE_VERSION, compatibilityOnly: false, enhancementMaterials: steps, enhancementRice: Object.fromEntries(grades.map((grade) => [grade, riceSteps(grade)])) as EquipmentBalanceContent["enhancementRice"], promotion: promotions(steps) };
}
export function buildRebalanceMaterialDrops(): MaterialDropsContent {
  /** 신화가 M5 를 쓰므로 8장부터 다섯 번째 세대를 연다. 앞 챕터는 뒤에 0 을 달아 너비만 맞춘다.
   *  DropTable 이 너비를 챕터 1 에서 유도하고 모든 챕터가 같기를 요구한다. */
  const DROP_GENERATION_WEIGHTS = [0, 1, 2, 3, 4].map((generation) => 625 / GENERATION_RATIO ** generation);
  const M5_OPEN_CHAPTER = 8;
  const pad = (weights: number[]): number[] => [...weights, ...Array(DROP_GENERATION_WEIGHTS.length - weights.length).fill(0)];
  const chapterGenerationWeights: Record<string, number[]> = {
    "1": pad([1]),
    "2": pad([5, 1]),
    "3": pad([25, 5, 1]),
    "4": pad([...GENERATION_WEIGHTS]),
  };
  for (let chapter = 5; chapter <= LAST_CHAPTER; chapter += 1) {
    chapterGenerationWeights[String(chapter)] = chapter >= M5_OPEN_CHAPTER ? [...DROP_GENERATION_WEIGHTS] : pad([...GENERATION_WEIGHTS]);
  }
  const chapters: Record<string, MaterialDropChapter> = {
    "1": { mode: "GUARANTEED", normalQuantity: 2, bossQuantity: 10, generationWeights: chapterGenerationWeights["1"]! },
  };
  for (let chapter = 2; chapter <= LAST_CHAPTER; chapter += 1) {
    chapters[String(chapter)] = { mode: "CHANCE", normalQuantity: 10, bossQuantity: 10, generationWeights: chapterGenerationWeights[String(chapter)]! };
  }
  return { authority: "applied", contentVersion: BALANCE_VERSION, dropChanceBasisPoints: 1_500, quantityPerSuccess: 10, normalEnemyRolls: 1, bossRolls: 5, chapterGenerationWeights, chapters };
}
async function writeJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
function stableChecksum(content: string): string { return createHash("sha256").update(content.replaceAll("\r\n", "\n")).digest("hex"); }
export async function regenerateManifests(root: string): Promise<void> {
  const legacyFiles = ["chapters/chapters.json", "stages/stages.json", "cosmetics/cosmetics.json", "drops/material-drops.json", "gem-dungeons/gem-dungeons.json", "gem-dungeons/gem-dungeons-beta.json", "gem-dungeons/gem-dungeons-v2.json", "gem-dungeons/gem-dungeons-v3.json", "skills/skills.json", "raids/raids.json", "liveops/hunt-ticket-gacha.json"] as const;
  for (const [version, files] of [["v1", legacyFiles], [BALANCE_VERSION, CONTENT_FILES]] as const) {
    const versionRoot = resolve(root, "versions", version);
    const checksums: Record<string, string> = {};
    for (const file of files) checksums[file] = stableChecksum(await readFile(resolve(versionRoot, file), "utf8"));
    const authority = version === "v1" ? "working" : "applied";
    await writeJson(resolve(versionRoot, "manifest.json"), { contentVersion: version, schemaVersion: 1, authority, files: [...files], checksums });
  }
}
export async function writeProgressionPackages(root: string): Promise<void> {
  await writeJson(resolve(root, "versions/v1/progression/progression.json"), buildLegacyProgressionContent());
  await writeJson(resolve(root, "versions/v1/equipment/equipment.json"), buildLegacyEquipmentContent());
  const versionRoot = resolve(root, "versions", BALANCE_VERSION);
  // This generator owns progression, equipment, and drop balance only. Preserve the
  // independently approved stage, skill, dungeon, and cosmetic content in this version.
  await writeJson(resolve(versionRoot, "progression/progression.json"), buildProgressionRebalanceContent());
  await writeJson(resolve(versionRoot, "equipment/equipment.json"), buildProgressionEquipmentContent());
  await writeJson(resolve(versionRoot, "drops/material-drops.json"), buildRebalanceMaterialDrops());
  await regenerateManifests(root);
}
