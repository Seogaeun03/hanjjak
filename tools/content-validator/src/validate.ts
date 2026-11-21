import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AjvModule from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { BALANCE_VERSION, CONTENT_FILES } from "./buildProgressionRebalance.js";

type StageContent = { authority: "working" | "applied"; contentVersion: string; stages: Array<{ id: string; chapter: number; number: number }> };
type ProgressionContent = { authority: "working" | "applied"; contentVersion: string; levelRange: { min: number; max: number } | null; stages: Array<{ stageId: string; normalExperience: number; bossExperience: number; normalRice: number; bossRice: number; firstClear: { rice: number; tickets: number; items: Array<{ itemId: string; quantity: number }>; directSkillId: string | null } | null }> };
type EquipmentBalanceContent = { authority: "working" | "applied"; contentVersion: string; compatibilityOnly: boolean; enhancementMaterials: Record<string, Record<string, number[]>>; enhancementRice: Record<string, number[]>; promotion: Record<string, { requiredStageId: string; materials: Record<string, number>; rice: number; resultGrade: string }> };
type CosmeticGrade = "NORMAL" | "RARE" | "EPIC" | "LEGENDARY";
type SkillGrade = "NORMAL" | "RARE" | "EPIC" | "LEGENDARY";
type SkillContent = {
  authority: "applied";
  contentVersion: string;
  mvpMaxGrade: SkillGrade;
  levelRange: { min: number; max: number };
  successRatesBasisPoints: Record<string, number>;
  grades: Record<SkillGrade, { enhancementRiceCoefficient: number; promotionRiceCost: number; bookRequirements: Partial<Record<SkillGrade, number>> }>;
  skills: Array<{ skillId: string; name: string; active: boolean; effects: Record<SkillGrade, { baseValue: number; stepValue: number }> }>;
};
type Cosmetic = { cosmeticId: string; displayName: string | null; imageUrl: string | null; grade: CosmeticGrade; slot: string; setId: string | null };
type Effect = { statId: string; value: number; unit: string };
type CosmeticSet = { setId: string; displayName: string | null; grade: CosmeticGrade; bannerId: string | null; boxItemId: string | null; active?: boolean; members: Record<string, string>; effects: Array<{ star: number; effects: Effect[] }> };
type CosmeticsContent = {
  authority: "working" | "applied";
  contentVersion: string;
  singleRiceCost: number;
  gradeProbabilityMillionths: Record<CosmeticGrade, number>;
  starThresholdsByGrade: Record<CosmeticGrade, number[]>;
  cosmetics: Cosmetic[];
  sets: CosmeticSet[];
};
type MaterialDropsContent = {
  authority: "working" | "applied";
  contentVersion: string;
  dropChanceBasisPoints: number;
  quantityPerSuccess: number;
  normalEnemyRolls: number;
  bossRolls: number;
  chapterGenerationWeights: Record<string, number[]>;
  chapters?: Record<string, { mode: "GUARANTEED" | "CHANCE"; normalQuantity: number; bossQuantity: number; generationWeights: number[] }>;
};
type GemDungeonsContent = {
  authority: "applied" | "beta";
  contentVersion: string;
  durationTicks: number;
  completionWindowSeconds: number;
  bosses: Array<{
    bossType: "SURVIVAL" | "BERSERK" | "ARMORED";
    stages: Array<{ stage: number; bossHp: number; bossAttack: number; defense: number; strikeDamage: number }>;
  }>;
};
type RaidReward = { cosmeticTickets: number; gemBoxes: number; rice: number };
type RaidContent = {
  authority: "working" | "applied";
  contentVersion: string;
  unlockStageId: string;
  settlementTimeZone: "Asia/Seoul";
  settlementLocalTime: "17:30";
  sealTarget: number;
  attemptLimitTicks: number;
  escalationIntervalTicks: number;
  escalationBasisPoints: number;
  bossInitialAttack: number;
  bossInitialDefense: number;
  gradeDamageThresholds: Record<(typeof RAID_GRADES)[number], number>;
  sealContributions: Record<(typeof RAID_REWARD_GRADES)[number], number>;
  personalRewards: Record<string, RaidReward>;
  successfulRankRewards: Record<string, RaidReward>;
  failedRankRewards: Record<string, RaidReward>;
};
type VersionManifest = { contentVersion: string; schemaVersion: number; authority: "working" | "applied"; files: string[]; checksums: Record<string, string> };
type LiveopsOutcomeJson = { kind: "PRIZE" | "COSMETIC_TICKET" | "GEM_BOX" | "RICE"; millionths: number; prizeId?: string; quantity?: number; minQuantity?: number; maxQuantity?: number };
type LiveopsContentJson = {
  authority: "working" | "applied";
  contentVersion: string;
  eventId: string;
  displayName: string;
  startsAt: string;
  endsAt: string;
  accrual: { secondsPerTicket: number; dailyCap: number; maxHeartbeatGapSeconds: number };
  outcomes: LiveopsOutcomeJson[];
  prizes: Array<{ prizeId: string; displayName: string; stock: number; perAccountLimit: number }>;
};

/**
 * 스키마가 못 잡는 관계를 본다. 확률 합이 1이 아니거나 쌀 칸이 없으면 서버가 뜨고 나서야
 * 터지는데, 실물 경품이 걸린 이벤트에서 그 시점은 너무 늦다.
 */
export function validateLiveopsContent(content: LiveopsContentJson): void {
  const total = content.outcomes.reduce((sum, outcome) => sum + outcome.millionths, 0);
  if (total !== 1_000_000) throw new Error(`liveops outcome millionths must sum to 1000000 but was ${total}`);
  const rice = content.outcomes.filter((outcome) => outcome.kind === "RICE");
  if (rice.length !== 1) throw new Error("liveops content needs exactly one RICE outcome");
  // 굴림이 고른 칸과 지급 전 재검사 대상이 어긋나지 않도록 PRIZE 칸은 최대 하나만 허용한다.
  const prizeOutcomes = content.outcomes.filter((outcome) => outcome.kind === "PRIZE");
  if (prizeOutcomes.length > 1) throw new Error("liveops content allows at most one PRIZE outcome");
  const [only] = rice;
  if (only!.minQuantity === undefined || only!.maxQuantity === undefined || only!.minQuantity > only!.maxQuantity) throw new Error("liveops RICE outcome has an invalid range");
  for (const outcome of content.outcomes) {
    if (outcome.kind === "COSMETIC_TICKET" && !(outcome.quantity && outcome.quantity > 0)) throw new Error("liveops COSMETIC_TICKET outcome needs a quantity");
    if (outcome.kind === "GEM_BOX" && !(outcome.quantity && outcome.quantity > 0)) throw new Error("liveops GEM_BOX outcome needs a quantity");
    if (outcome.kind === "PRIZE" && !content.prizes.some((prize) => prize.prizeId === outcome.prizeId)) throw new Error(`liveops outcome references undeclared prize ${outcome.prizeId}`);
  }
  if (new Set(content.prizes.map((prize) => prize.prizeId)).size !== content.prizes.length) throw new Error("liveops prize ids must be unique");
  if (!(Date.parse(content.startsAt) < Date.parse(content.endsAt))) throw new Error("liveops event window is inverted");
}

const RAID_GRADES = ["D", "C", "B", "A", "S", "SS", "SSS"] as const;
const RAID_REWARD_GRADES = ["PARTICIPATION", ...RAID_GRADES] as const;
type ContentValidators = Promise<ValidateFunction[]>;

export function compileContentValidators(): ContentValidators {
  const schemaRoot = resolve(import.meta.dirname, "../../../packages/game-content/schema");
  const schemaNames = ["stages.schema.json", "cosmetics.schema.json", "material-drops.schema.json", "gem-dungeons.schema.json", "skills.schema.json", "progression.schema.json", "equipment-balance.schema.json", "raids.schema.json", "liveops.schema.json"];
  const ajv = new AjvModule.default({ allErrors: true, strict: false });
  return Promise.all(schemaNames.map((name) => readFile(resolve(schemaRoot, name), "utf8")))
    .then((schemas) => schemas.map((schema) => ajv.compile(JSON.parse(schema))));
}
const RAID_RANKS = ["FIRST", "SECOND_TO_TENTH", "ELEVENTH_TO_HUNDREDTH", "REST"] as const;
export async function validateContent(
  root = resolve(import.meta.dirname, "../../../packages/game-content"),
  compiledValidators?: ContentValidators,
): Promise<void> {
  const validators = compiledValidators ? await compiledValidators : await compileContentValidators();
  const roots = [
    { version: "v1" as const, files: ["chapters/chapters.json", "stages/stages.json", "cosmetics/cosmetics.json", "drops/material-drops.json", "gem-dungeons/gem-dungeons.json", "gem-dungeons/gem-dungeons-beta.json", "gem-dungeons/gem-dungeons-v2.json", "gem-dungeons/gem-dungeons-v3.json", "skills/skills.json", "raids/raids.json", "liveops/hunt-ticket-gacha.json"] as const },
    { version: BALANCE_VERSION, files: CONTENT_FILES },
  ];
  for (const { version, files } of roots) {
    const versionRoot = resolve(root, "versions", version);
    const raidText = version === "v1" ? await readFile(resolve(versionRoot, "raids/raids.json"), "utf8") : undefined;
    const manifest = JSON.parse(await readFile(resolve(versionRoot, "manifest.json"), "utf8")) as { contentVersion: string; schemaVersion: number; authority: "working" | "applied"; files: string[]; checksums: Record<string, string> };
    if (manifest.contentVersion !== version) throw new Error(`manifest contentVersion mismatch for ${version}`);
    if (manifest.schemaVersion !== 1) throw new Error(`manifest schemaVersion mismatch for ${version}`);
    if (manifest.files.length !== files.length || manifest.files.some((file, index) => file !== files[index])) throw new Error(`manifest file list mismatch for ${version}`);
    if (Object.keys(manifest.checksums).sort().join(",") !== [...files].sort().join(",")) throw new Error(`manifest checksum map mismatch for ${version}`);
    const entries = await Promise.all(files.map(async (file) => {
      const content = await readFile(resolve(versionRoot, file), "utf8");
      if (!(version === "v1" && file === "raids/raids.json") && manifest.checksums[file] !== stableChecksum(content)) throw new Error(`manifest checksum mismatch: ${version}/${file}`);
      return [file, JSON.parse(content) as Record<string, any>] as const;
    }));
    const values = Object.fromEntries(entries);
    const stage = values["stages/stages.json"] as StageContent;
    const cosmetics = values["cosmetics/cosmetics.json"] as CosmeticsContent;
    const skills = values["skills/skills.json"] as SkillContent;
    const drops = values["drops/material-drops.json"] as MaterialDropsContent;
    const gemDungeons = values["gem-dungeons/gem-dungeons.json"] as GemDungeonsContent;
    const chapters = values["chapters/chapters.json"] as { chapters: Array<{ stageIds: string[] }> };
    const raids = values["raids/raids.json"] as RaidContent | undefined;
    const checks = [validators[0]!(stage), validators[1]!(cosmetics), validators[2]!(drops), validators[3]!(gemDungeons), validators[4]!(skills)];
    /* 승격 전 10단계 콘텐츠와 30단계 v3 가 같은 스키마를 통과해야 롤백 경로가 산다. */
    const appliedGemDungeons = values["gem-dungeons/gem-dungeons-v3.json"] as GemDungeonsContent | undefined;
    if (appliedGemDungeons) {
      checks.push(validators[3]!(appliedGemDungeons));
      validateGemDungeonLadder(appliedGemDungeons);
    }
    if (version === BALANCE_VERSION) checks.push(validators[5]!(values["progression/progression.json"]), validators[6]!(values["equipment/equipment.json"]));
    if (version === "v1" && raids) checks.push(validators[7]!(raids));
    const liveops = values["liveops/hunt-ticket-gacha.json"] as LiveopsContentJson | undefined;
    if (version === "v1" && liveops) {
      checks.push(validators[8]!(liveops));
      validateLiveopsContent(liveops);
    }
    if (checks.some((valid) => !valid)) throw new Error(`content schema invalid for ${version}`);
    validateSkillContent(skills);
    validateCosmeticReferences(cosmetics, version === "v1");
    validateMaterialDropsContent(drops);
    validateGemDungeonsContent(gemDungeons);
    if (version === "v1" && raids) {
      validateRaidContent(raids, stage);
      if (raidText !== undefined && manifest.checksums["raids/raids.json"] !== stableChecksum(raidText)) throw new Error("manifest checksum mismatch: v1/raids/raids.json");
    }
    const stageIds = stage.stages.map((row) => row.id);
    const referencedStages = new Set(chapters.chapters.flatMap((chapter) => chapter.stageIds));
    if (stageIds.some((id) => !referencedStages.has(id)) || referencedStages.size !== stageIds.length) throw new Error("chapter-stage reference mismatch");
    if (version === BALANCE_VERSION) {
      const progression = values["progression/progression.json"] as ProgressionContent;
      const equipment = values["equipment/equipment.json"] as EquipmentBalanceContent;
      if (entries.some(([, content]) => content.contentVersion !== version)) throw new Error(`${version} files must share contentVersion`);
      const expectedStageCount = 150;
      if (progression.stages.length !== expectedStageCount) throw new Error(`${version} progression must contain ${expectedStageCount} stages`);
      /* 최초 클리어 보상이 스킬북을 줄 수 있다. 품목 ID는 스킬 콘텐츠의 스킬과 등급에서 그대로 만들어,
         카탈로그에 없는 책을 보상에 적어 두는 일을 막는다. */
      const skillBookIds = skills.skills.flatMap((skill) => Object.keys(skills.grades).map((grade) => `skillbook:${skill.skillId}:${grade.toLowerCase()}`));
      const allowedItems = new Set([...materialFamilies.flatMap((family) => Array.from({ length: MATERIAL_GENERATIONS }, (_, index) => `${family}_M${index + 1}`)), "GEM_BOX", ...skillBookIds]);
      const allowedSkills = new Set(skills.skills.map((skill) => skill.skillId));
      for (const row of progression.stages) if (row.firstClear) {
        for (const item of row.firstClear.items) if (!allowedItems.has(item.itemId)) throw new Error(`unknown first-clear itemId: ${item.itemId}`);
        if (row.firstClear.directSkillId !== null && !allowedSkills.has(row.firstClear.directSkillId)) throw new Error(`unknown first-clear directSkillId: ${row.firstClear.directSkillId}`);
      }
      for (let index = 0; index < expectedStageCount; index += 1) {
        const row = progression.stages[index]!;
        const expected = `stage.${String(Math.floor(index / 10) + 1).padStart(2, "0")}-${String((index % 10) + 1).padStart(2, "0")}`;
        if (row.stageId !== expected) throw new Error(`unstable progression stage id: ${row.stageId}`);
        if (row.bossExperience !== row.normalExperience * 5 || row.bossRice !== row.normalRice * 10) throw new Error(`invalid progression reward ratio: ${row.stageId}`);
        const globalIndex = index + 1;
        const referenceLevel = 2 * globalIndex - 1;
        const levelMinutes = 2 + (11 / 90) * (2 * referenceLevel - 1);
        const expectedExperience = Math.max(1, Math.round(1_000 * referenceLevel / (50 * levelMinutes)));
        if (row.normalExperience !== expectedExperience) throw new Error(`progression XP schedule mismatch: ${row.stageId}`);
        if (JSON.stringify(row.firstClear) !== JSON.stringify(expectedFirstClear(index))) throw new Error(`first-clear schedule mismatch: ${row.stageId}`);
      }
      const expectedMaterials = approvedMaterialSchedules();
      for (const grade of ["NORMAL", "RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const) {
        if (JSON.stringify(equipment.enhancementMaterials[grade]) !== JSON.stringify(expectedMaterials[grade])) throw new Error(`approved equipment material schedule mismatch: ${grade}`);
        if (JSON.stringify(equipment.enhancementRice[grade]) !== JSON.stringify(approvedRiceSchedule(grade))) throw new Error(`approved enhancement rice schedule mismatch: ${grade}`);
      }
      const expectedPromotions: EquipmentBalanceContent["promotion"] = {
        NORMAL: { requiredStageId: "stage.01-10", materials: { M1: 74, M2: 2 }, rice: 870, resultGrade: "RARE" },
        RARE: { requiredStageId: "stage.03-10", materials: { M1: 206, M2: 41, M3: 1 }, rice: 1_770, resultGrade: "EPIC" },
        EPIC: { requiredStageId: "stage.05-10", materials: { M1: 573, M2: 115, M3: 23, M4: 1 }, rice: 2_670, resultGrade: "LEGENDARY" },
        LEGENDARY: { requiredStageId: "stage.07-10", materials: { M1: 1_500, M2: 300, M3: 60, M4: 12, M5: 1 }, rice: 3_570, resultGrade: "MYTHIC" },
        MYTHIC: { requiredStageId: "stage.99-99", materials: {}, rice: 0, resultGrade: "MYTHIC" },
      };
      for (const grade of ["NORMAL", "RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const) if (JSON.stringify(equipment.promotion[grade]) !== JSON.stringify(expectedPromotions[grade])) throw new Error(`approved promotion invariant mismatch: ${grade}`);
      /* 10스테이지 최초 클리어는 그 챕터가 여는 승급 비용을 그대로 준다. 깨자마자 승급할 수
         있어야 하므로, 재료 사다리를 손댈 때 두 표가 말없이 어긋나면 안 된다. */
      for (const [stageId, grade] of [["stage.01-10", "NORMAL"], ["stage.03-10", "RARE"]] as const) {
        const firstClear = progression.stages.find((row) => row.stageId === stageId)?.firstClear;
        if (!firstClear) throw new Error(`promotion gate stage has no first clear: ${stageId}`);
        for (const [generation, quantity] of Object.entries(equipment.promotion[grade]!.materials as Record<string, number>)) {
          const granted = firstClear.items.find((item) => item.itemId === `POTATO_${generation}`)?.quantity;
          if (granted !== quantity) throw new Error(`first clear must cover the ${grade} promotion cost at ${stageId}: ${generation} ${granted} != ${quantity}`);
        }
      }
    }
  }
}
const materialFamilies = ["POTATO", "SWEET_POTATO", "CORN"] as const;
/** StaticItemCatalog 가 정의한 재료 세대 수. 늘리려면 그쪽 아이템부터 추가해야 한다. */
const MATERIAL_GENERATIONS = 5;
const firstClearTables = {
  chapter1M1: [178, 356, 533, 711, 889, 1_067, 1_244, 1_422, 1_600],
  chapter1Rice: [1_392, 2_784, 4_176, 5_568, 6_960, 8_352, 9_744, 11_136, 12_528],
  chapter2M1: [148, 296, 444, 592, 740, 888, 1_036, 1_184, 1_332],
  chapter2M2: [16, 32, 48, 64, 80, 96, 112, 128, 144],
  chapter2Rice: [1_566, 3_132, 4_698, 6_264, 7_830, 9_396, 10_962, 12_528, 14_094],
  chapter3M1: [99, 197, 296, 395, 493, 592, 691, 789, 888],
  chapter3M2: [11, 21, 32, 43, 53, 64, 75, 85, 96],
  chapter3Rice: [1_044, 2_088, 3_132, 4_176, 5_220, 6_264, 7_308, 8_352, 9_396],
  /* 4장부터 F(M1)는 주지 않는다. 드롭 가중치가 125:25:5:1 이라 F 는 남아돌고 거래소에서
     가장 싸다. 생성기와 같은 표를 여기 독립으로 둔다. */
  midM2: [110, 220, 330, 439, 549, 659, 769, 879, 989],
  midM3: [22, 44, 66, 88, 110, 132, 154, 176, 197],
  midM4: [4, 9, 13, 17, 21, 25, 30, 34, 38],
  lateM3: [42, 85, 127, 170, 212, 254, 297, 339, 382],
  lateM4: [13, 25, 38, 51, 64, 76, 89, 102, 114],
  lateM5: [3, 7, 10, 14, 17, 20, 24, 27, 31],
  /* 11장부터 M3 를 닫는다. 신화 6부위 M4·M5 비용의 10% 씩이다. 생성기와 같은 표를 여기 독립으로 둔다. */
  mythicM4: [16, 32, 48, 64, 80, 96, 112, 128, 144],
  mythicM5: [5, 10, 14, 19, 24, 29, 34, 38, 43],
  chapter4Rice: [2_610, 5_220, 7_830, 10_440, 13_050, 15_660, 18_270, 20_880, 23_490],
} as const;
/** 장마다 1~9스테이지가 주는 치장 뽑기권. 지갑으로 들어가므로 가방 칸을 쓰지 않는다. */
const firstClearTickets: Record<number, number> = { 5: 10, 6: 20, 7: 20, 8: 30, 9: 30, 10: 30, 11: 30, 12: 30, 13: 30, 14: 30, 15: 30 };
/** 4장부터 장 마지막 스테이지가 주는 치장 뽑기권. 재료·쌀은 주지 않는다. */
const CHAPTER_END_TICKETS = 20;
/* 스킬은 스킬북으로만 연다. 스테이지가 직접 열어 주던 표를 거두는 대신, 챕터 1의 2~5스테이지가
   액티브 네 종의 노말 책을 한 권씩 최초 클리어 보상으로 준다. 생성기와 같은 표를 여기 독립으로 둔다. */
const chapterOneUnlockBooks: Record<number, string> = {
  2: "active_heavy",
  3: "active_dot",
  4: "active_haste",
  5: "active_basic_amp",
};
function expectedRewardMaterials(generation: number, quantity: number): Array<{ itemId: string; quantity: number }> {
  return materialFamilies.map((family) => ({ itemId: `${family}_M${generation}`, quantity }));
}
function expectedFirstClear(index: number): ProgressionContent["stages"][number]["firstClear"] {
  const chapter = Math.floor(index / 10) + 1;
  const number = (index % 10) + 1;
  if (number === 10) {
    if (chapter === 1) return { rice: 870, tickets: 0, items: [...expectedRewardMaterials(1, 74), ...expectedRewardMaterials(2, 2)], directSkillId: null };
    if (chapter === 2) return { rice: 0, tickets: 0, items: [{ itemId: "GEM_BOX", quantity: 6 }], directSkillId: null };
    if (chapter === 3) return { rice: 1_770, tickets: 0, items: [...expectedRewardMaterials(1, 206), ...expectedRewardMaterials(2, 41), ...expectedRewardMaterials(3, 1), { itemId: "GEM_BOX", quantity: 30 }], directSkillId: null };
    return { rice: 0, tickets: CHAPTER_END_TICKETS, items: [], directSkillId: null };
  }
  if (chapter === 1) {
    const unlockBook = chapterOneUnlockBooks[number];
    const books = unlockBook ? [{ itemId: `skillbook:${unlockBook}:normal`, quantity: 1 }] : [];
    return { rice: firstClearTables.chapter1Rice[number - 1]!, tickets: 0, items: [...expectedRewardMaterials(1, firstClearTables.chapter1M1[number - 1]!), ...books], directSkillId: null };
  }
  if (chapter === 2) return { rice: firstClearTables.chapter2Rice[number - 1]!, tickets: 0, items: [...expectedRewardMaterials(1, firstClearTables.chapter2M1[number - 1]!), ...expectedRewardMaterials(2, firstClearTables.chapter2M2[number - 1]!)], directSkillId: null };
  if (chapter === 3) return { rice: firstClearTables.chapter3Rice[number - 1]!, tickets: 0, items: [...expectedRewardMaterials(1, firstClearTables.chapter3M1[number - 1]!), ...expectedRewardMaterials(2, firstClearTables.chapter3M2[number - 1]!), { itemId: "GEM_BOX", quantity: 10 }], directSkillId: null };
  const rice = firstClearTables.chapter4Rice[number - 1]!;
  const tickets = firstClearTickets[chapter] ?? 0;
  if (chapter <= 7) {
    const boost = chapter >= 6 ? expectedRewardMaterials(4, firstClearTables.midM4[number - 1]!) : [];
    return { rice, tickets, items: [...expectedRewardMaterials(2, firstClearTables.midM2[number - 1]!), ...expectedRewardMaterials(3, firstClearTables.midM3[number - 1]!), ...boost], directSkillId: null };
  }
  if (chapter <= 10) {
    return { rice, tickets, items: [...expectedRewardMaterials(3, firstClearTables.lateM3[number - 1]!), ...expectedRewardMaterials(4, firstClearTables.lateM4[number - 1]!), ...expectedRewardMaterials(5, firstClearTables.lateM5[number - 1]!)], directSkillId: null };
  }
  return { rice, tickets, items: [...expectedRewardMaterials(4, firstClearTables.mythicM4[number - 1]!), ...expectedRewardMaterials(5, firstClearTables.mythicM5[number - 1]!)], directSkillId: null };
}
function bracketSteps(total: number): number[] {
  const values: number[] = [];
  for (const [count, share] of [[10, 0.2], [10, 0.3], [9, 0.5]] as const) {
    const target = Math.round(total * share);
    const base = Math.floor(target / count);
    const remainder = target - base * count;
    for (let index = 0; index < count; index += 1) values.push(base + (index >= count - remainder ? 1 : 0));
  }
  return values;
}
function approvedMaterialSchedules(): EquipmentBalanceContent["enhancementMaterials"] {
  const legacyLegendary: Record<string, number[]> = {};
  for (const generation of [1, 2, 3, 4]) legacyLegendary[`M${generation}`] = Array.from({ length: 29 }, (_, index) => Math.ceil((90 + index + 1) / 10) * (125 / 5 ** (generation - 1)));
  /* 신화 총량은 전설 마지막 단계 × 50 에서 파생하고 상위 세대일수록 가파르게 오른다
     (M1·M2 ×1, M3 ×1.5, M4 ×2, M5 ×3). 생성기와 따로 적어 두어, 한쪽만 바뀌면 검증이 잡는다. */
  const mythic: Record<string, number[]> = { M1: bracketSteps(75_000), M2: bracketSteps(15_000), M3: bracketSteps(4_500), M4: bracketSteps(1_200), M5: bracketSteps(360) };
  return { NORMAL: { M1: [...Array.from({ length: 10 }, () => 40), ...Array.from({ length: 10 }, () => 60), ...Array.from({ length: 9 }, () => 74)] }, RARE: { M1: bracketSteps(3700), M2: bracketSteps(738) }, EPIC: { M1: bracketSteps(10300), M2: bracketSteps(2060), M3: bracketSteps(412) }, LEGENDARY: legacyLegendary, MYTHIC: mythic };
}
function approvedRiceSchedule(grade: "NORMAL" | "RARE" | "EPIC" | "LEGENDARY" | "MYTHIC"): number[] {
  const gradeIndex = ["NORMAL", "RARE", "EPIC", "LEGENDARY", "MYTHIC"].indexOf(grade);
  return Array.from({ length: 29 }, (_, index) => 30 * (gradeIndex * 30 + index + 1));
}
function validateRaidContent(content: RaidContent, stages: StageContent): void {
  if (content.authority !== "working") throw new Error("raid content must remain working until vertical slice verification");
  if (content.contentVersion !== "raid-mvp-v1-working") throw new Error("raid content version must remain stable");
  if (!stages.stages.some((stage) => stage.id === content.unlockStageId)) throw new Error(`raid unlock stage reference missing: ${content.unlockStageId}`);
  if (content.unlockStageId !== "stage.01-02") throw new Error("raid unlock stage must remain stage.01-02");
  if (content.sealTarget !== 50_000 || content.attemptLimitTicks !== 3_000 || content.escalationIntervalTicks !== 50 || content.escalationBasisPoints !== 500) throw new Error("raid session values must match the approved table");
  if (content.bossInitialAttack <= 0 || content.bossInitialDefense <= 0) throw new Error("raid boss initial stats must be positive");
  const thresholds = RAID_GRADES.map((grade) => content.gradeDamageThresholds[grade]);
  if (thresholds.some((value) => !Number.isInteger(value) || value <= 0) || !strictlyIncreasing(thresholds)) throw new Error("raid damage thresholds must be strictly increasing positive integers");
  const b = content.gradeDamageThresholds.B;
  const expectedMultipliers: Record<(typeof RAID_GRADES)[number], number> = { D: 0.35, C: 0.65, B: 1, A: 1.5, S: 2.2, SS: 3.2, SSS: 4.5 };
  for (const grade of RAID_GRADES) if (content.gradeDamageThresholds[grade] !== Math.floor(b * expectedMultipliers[grade] + 0.5)) throw new Error(`raid threshold multiplier mismatch for ${grade}`);
  const contributions = [content.sealContributions.PARTICIPATION, ...RAID_GRADES.map((grade) => content.sealContributions[grade])];
  if (JSON.stringify(contributions) !== JSON.stringify([0, 100, 167, 233, 300, 367, 433, 500])) throw new Error("raid seal contributions must match the approved table");
  if (contributions.some((value) => !Number.isInteger(value) || value < 0) || contributions[0] !== 0 || !contributions.slice(1).every((value, index) => value > contributions[index]!)) throw new Error("raid seal contributions must be monotonic");
  const expectedPersonal: Record<(typeof RAID_REWARD_GRADES)[number], RaidReward> = {
    PARTICIPATION: { cosmeticTickets: 5, gemBoxes: 3, rice: 5_000 }, D: { cosmeticTickets: 6, gemBoxes: 3, rice: 5_750 }, C: { cosmeticTickets: 7, gemBoxes: 4, rice: 6_500 }, B: { cosmeticTickets: 7, gemBoxes: 4, rice: 7_250 },
    A: { cosmeticTickets: 8, gemBoxes: 5, rice: 8_000 }, S: { cosmeticTickets: 9, gemBoxes: 5, rice: 8_750 }, SS: { cosmeticTickets: 10, gemBoxes: 6, rice: 9_500 }, SSS: { cosmeticTickets: 10, gemBoxes: 6, rice: 10_000 },
  };
  for (const grade of RAID_REWARD_GRADES) if (JSON.stringify(content.personalRewards[grade]) !== JSON.stringify(expectedPersonal[grade])) throw new Error(`raid personal reward table mismatch for ${grade}`);
  const expectedSuccessful: Record<(typeof RAID_RANKS)[number], RaidReward> = {
    FIRST: { cosmeticTickets: 11, gemBoxes: 7, rice: 11_000 }, SECOND_TO_TENTH: { cosmeticTickets: 10, gemBoxes: 6, rice: 10_000 }, ELEVENTH_TO_HUNDREDTH: { cosmeticTickets: 9, gemBoxes: 5, rice: 9_000 }, REST: { cosmeticTickets: 8, gemBoxes: 5, rice: 8_000 },
  };
  for (const rank of RAID_RANKS) {
    const success = content.successfulRankRewards[rank];
    const failure = content.failedRankRewards[rank];
    if (JSON.stringify(success) !== JSON.stringify(expectedSuccessful[rank])) throw new Error(`raid successful rank reward table mismatch for ${rank}`);
    if (!success || !failure) throw new Error(`missing raid rank reward for ${rank}`);
    const expected = (value: number) => Math.floor(value * 0.7 + 0.5);
    if (Object.values(success).some((value) => !Number.isInteger(value) || value < 0) || failure.cosmeticTickets !== expected(success.cosmeticTickets) || failure.gemBoxes !== expected(success.gemBoxes) || failure.rice !== expected(success.rice)) throw new Error(`failed raid rank reward must be the rounded 70% of success reward for ${rank}`);
  }
}

function stableChecksum(content: string): string {
  return createHash("sha256").update(content.replaceAll("\r\n", "\n")).digest("hex");
}

function validateSkillContent(content: SkillContent): void {
  const grades: SkillGrade[] = ["NORMAL", "RARE", "EPIC", "LEGENDARY"];
  if (content.mvpMaxGrade !== "LEGENDARY") throw new Error("skill max grade must be LEGENDARY");
  if (content.levelRange.min !== 1 || content.levelRange.max !== 10) throw new Error("skill level range must be 1 through 10");
  const expectedSuccess: Record<string, number> = { "2": 7000, "3": 6500, "4": 6000, "5": 5000, "6": 4500, "7": 4000, "8": 3000, "9": 2500, "10": 2000 };
  if (JSON.stringify(content.successRatesBasisPoints) !== JSON.stringify(expectedSuccess)) throw new Error("skill success rates must match the approved table");
  const expectedCoefficients: Record<SkillGrade, number> = { NORMAL: 90, RARE: 180, EPIC: 360, LEGENDARY: 720 };
  const expectedPromotion: Record<SkillGrade, number> = { NORMAL: 0, RARE: 4050, EPIC: 8100, LEGENDARY: 16200 };
  const expectedBooks: Record<SkillGrade, Partial<Record<SkillGrade, number>>> = {
    NORMAL: { NORMAL: 1 }, RARE: { NORMAL: 2, RARE: 1 }, EPIC: { NORMAL: 4, RARE: 2, EPIC: 1 }, LEGENDARY: { NORMAL: 8, RARE: 4, EPIC: 2, LEGENDARY: 1 },
  };
  const expectedIds = ["active_heavy", "active_dot", "active_haste", "active_basic_amp", "passive_critical", "passive_all_damage"];
  const expectedActiveById: Record<string, boolean> = { active_heavy: true, active_dot: true, active_haste: true, active_basic_amp: true, passive_critical: false, passive_all_damage: false };
  if (content.skills.map((skill) => skill.skillId).join(",") !== expectedIds.join(",")) throw new Error("skill ids must match the approved catalog");
  if (content.skills.some((skill) => skill.active !== expectedActiveById[skill.skillId])) throw new Error("skill active classification must match the approved catalog");
  for (const grade of grades) {
    if (content.grades[grade].enhancementRiceCoefficient !== expectedCoefficients[grade]) throw new Error("skill enhancement coefficients must match the approved table");
    if (content.grades[grade].promotionRiceCost !== expectedPromotion[grade]) throw new Error("skill promotion costs must match the approved table");
    if (JSON.stringify(content.grades[grade].bookRequirements) !== JSON.stringify(expectedBooks[grade])) throw new Error("skill book requirements must match the approved table");
  }
  const expectedEffects: Record<string, Record<SkillGrade, [number, number]>> = {
    active_heavy: { NORMAL: [200, 10], RARE: [320, 15], EPIC: [480, 20], LEGENDARY: [700, 25] },
    active_dot: { NORMAL: [250, 15], RARE: [420, 20], EPIC: [640, 25], LEGENDARY: [920, 30] },
    active_haste: { NORMAL: [20, 1], RARE: [32, 1], EPIC: [45, 1], LEGENDARY: [60, 1] },
    active_basic_amp: { NORMAL: [20, 1], RARE: [32, 1], EPIC: [45, 1], LEGENDARY: [60, 1] },
    passive_critical: { NORMAL: [5, 1], RARE: [16, 1], EPIC: [28, 1], LEGENDARY: [40, 1] },
    passive_all_damage: { NORMAL: [5, 1], RARE: [16, 1], EPIC: [28, 1], LEGENDARY: [40, 1] },
  };
  for (const skill of content.skills) for (const grade of grades) {
    const actual = skill.effects[grade];
    const expected = expectedEffects[skill.skillId]![grade];
    if (actual.baseValue !== expected[0] || actual.stepValue !== expected[1]) throw new Error("skill effects must match the approved table");
  }
}

function validateGemDungeonsContent(content: GemDungeonsContent): void {
  const expectedBosses = ["SURVIVAL", "BERSERK", "ARMORED"];
  if (content.bosses.map((boss) => boss.bossType).sort().join(",") !== [...expectedBosses].sort().join(",")) throw new Error("gem dungeons must define each boss exactly once");
  for (const boss of content.bosses) {
    if (boss.stages.map((stage) => stage.stage).join(",") !== "1,2,3,4,5,6,7,8,9,10") throw new Error(`invalid gem dungeon stage sequence: ${boss.bossType}`);
    if (boss.bossType === "SURVIVAL" && boss.stages.some((stage) => stage.strikeDamage <= 0 || stage.bossAttack !== 0)) throw new Error("survival boss must use unavoidable strikes only");
    if (boss.bossType !== "SURVIVAL" && boss.stages.some((stage) => stage.strikeDamage !== 0)) throw new Error(`${boss.bossType} cannot use survival strikes`);
  }
}

function validateMaterialDropsContent(content: MaterialDropsContent): void {
  /* 세대 개수는 콘텐츠가 정한다. 챕터와 세대를 1:1로 묶어 두면 "챕터 4부터 3세대" 같은 배치를
     표현할 수 없으므로, 여기서는 배치의 모양만 강제하고 지금 적용된 수치는 아래 표로 따로 못박는다.
     이 표는 생성기를 import 하지 않는 독립 사본이다. 신화가 M5 를 쓰므로 8장부터 다섯 번째
     세대가 열리고, 그 앞 챕터는 폭만 맞추려고 뒤에 0 을 단다(4~7장은 같은 행을 공유). */
  const applied = [[1, 0, 0, 0, 0], [5, 1, 0, 0, 0], [25, 5, 1, 0, 0], [125, 25, 5, 1, 0]];
  const MYTHIC_DROP_OPEN_CHAPTER = 8;
  const mythicOpenedRow = [625, 125, 25, 5, 1];
  const chapters = Object.keys(content.chapterGenerationWeights).map(Number).sort((left, right) => left - right);
  if (chapters.some((chapter, index) => chapter !== index + 1)) throw new Error("material chapters must be a 1..n run");
  const width = content.chapterGenerationWeights["1"]?.length ?? 0;
  if (width < 1 || width > MATERIAL_GENERATIONS) throw new Error(`material generations must be 1..${MATERIAL_GENERATIONS}`);
  let openedBefore = 0;
  for (const chapter of chapters) {
    const weights = content.chapterGenerationWeights[String(chapter)];
    if (!weights) throw new Error(`missing material weights in chapter ${chapter}`);
    if (weights.length !== width) throw new Error(`material weight width mismatch in chapter ${chapter}`);
    if (weights.some((weight) => weight < 0)) throw new Error(`negative material weight in chapter ${chapter}`);
    const opened = weights.reduce((last, weight, index) => (weight > 0 ? index + 1 : last), 0);
    if (opened === 0) throw new Error(`chapter ${chapter} opens no material generation`);
    if (weights.slice(0, opened).some((weight) => weight <= 0)) throw new Error(`material generation gap in chapter ${chapter}`);
    if (opened < openedBefore) throw new Error(`material generation closed in chapter ${chapter}`);
    openedBefore = opened;
    const row = chapter >= MYTHIC_DROP_OPEN_CHAPTER ? mythicOpenedRow : applied[Math.min(chapter, applied.length) - 1]!;
    /* weights 방향만 훑으면 챕터를 통째로 더 좁은 폭으로 손편집했을 때 row 쪽의 남는(0이 아닌)
       꼬리를 아무도 보지 않는다 — 8~10장을 4폭으로 줄이면 M5(mythicOpenedRow 의 다섯 번째 값)가
       조용히 사라져도 통과한다. row 방향도 함께 훑어 양쪽 폭 불일치를 모두 잡는다. */
    if (row.some((weight, index) => weight !== (weights[index] ?? 0))) throw new Error(`material drop generation width mismatch in chapter ${chapter}`);
    if (weights.some((weight, index) => weight !== (row[index] ?? 0))) throw new Error(`unexpected material weights in chapter ${chapter}`);
  }
  if (content.normalEnemyRolls * 20 + content.bossRolls !== 25) throw new Error("material cycle must have 25 independent rolls");
}

function validateCosmeticReferences(content: CosmeticsContent, legacy = false): void {
  const grades: CosmeticGrade[] = ["NORMAL", "RARE", "EPIC", "LEGENDARY"];
  const probabilities = Object.values(content.gradeProbabilityMillionths);
  if (probabilities.reduce((sum, value) => sum + value, 0) !== 1_000_000) throw new Error("cosmetic probabilities must total 1,000,000");
  if (content.singleRiceCost !== 5_000) throw new Error("cosmetic single draw cost must be 5,000");
  const expectedProbabilities: Record<CosmeticGrade, number> = { NORMAL: 500_000, RARE: 350_000, EPIC: 140_000, LEGENDARY: 10_000 };
  if (grades.some((grade) => content.gradeProbabilityMillionths[grade] !== expectedProbabilities[grade])) throw new Error("cosmetic probabilities must match the approved table");
  const expectedThresholds: Record<CosmeticGrade, number[]> = legacy ? {
    NORMAL: [1, 4, 16, 80, 400], RARE: [1, 3, 12, 60, 300], EPIC: [1, 2, 8, 40, 200], LEGENDARY: [1, 2, 3, 5, 10],
  } : {
    NORMAL: [1, 480, 720, 1200, 2400], RARE: [1, 168, 252, 420, 840], EPIC: [1, 134, 202, 336, 672], LEGENDARY: [1, 2, 3, 5, 10],
  };
  for (const grade of grades) {
    const thresholds = content.starThresholdsByGrade[grade];
    if (!thresholds || thresholds.join(",") !== expectedThresholds[grade].join(",")) throw new Error(`invalid ${grade} star thresholds`);
  }
  // 위 표는 버전마다 다시 적는 장부라 순서가 뒤집혀도 통과한다. 요구량이 등급이 희소해질수록
  // 줄어드는지는 따로 검사해야 다음 콘텐츠 버전에서 조용히 되돌아가지 않는다.
  for (let index = 0; index < grades.length - 1; index += 1) {
    const common = content.starThresholdsByGrade[grades[index]!]!;
    const rarer = content.starThresholdsByGrade[grades[index + 1]!]!;
    if (common.some((value, star) => value < rarer[star]!)) throw new Error(`star thresholds must not increase with rarity: ${grades[index]} < ${grades[index + 1]}`);
  }
  const cosmeticIds = content.cosmetics.map((cosmetic) => cosmetic.cosmeticId);
  const expectedIds = Array.from({ length: cosmeticIds.length }, (_, index) => `cosmetic-${String(index + 1).padStart(3, "0")}`);
  if (cosmeticIds.join(",") !== expectedIds.join(",")) throw new Error("cosmetic ids must be unique and contiguous from cosmetic-001");
  const setIds = content.sets.map((set) => set.setId);
  const expectedSetIds = Array.from({ length: setIds.length }, (_, index) => `cosmetic-set-${String(index + 1).padStart(2, "0")}`);
  if (setIds.join(",") !== expectedSetIds.join(",")) throw new Error("cosmetic set ids must be unique and contiguous from cosmetic-set-01");
  const byId = new Map(content.cosmetics.map((cosmetic) => [cosmetic.cosmeticId, cosmetic]));
  const requiredSlots = ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE"];
  const memberIds: string[] = [];
  for (const set of content.sets) {
    if (Object.keys(set.members).sort().join(",") !== [...requiredSlots].sort().join(",")) throw new Error(`invalid set slots: ${set.setId}`);
    const ids = Object.values(set.members);
    if (new Set(ids).size !== 6) throw new Error(`duplicate set member: ${set.setId}`);
    memberIds.push(...ids);
    for (const [slot, cosmeticId] of Object.entries(set.members)) {
      const cosmetic = byId.get(cosmeticId);
      if (!cosmetic || cosmetic.grade !== set.grade || cosmetic.slot !== slot || cosmetic.setId !== set.setId) throw new Error(`invalid set member mapping: ${set.setId}/${slot}`);
    }
    if (set.effects.map((effect) => effect.star).join(",") !== "1,2,3,4,5") throw new Error(`invalid set effect stars: ${set.setId}`);
    validateMonotonicEffects(set.effects, `set ${set.setId}`);
    for (const row of set.effects) for (const effect of row.effects) {
      const expectedUnit = effect.statId === "buffDurationSeconds" ? "SECONDS" : effect.statId === "criticalChancePoint" ? "PERCENTAGE_POINTS" : "BASIS_POINTS";
      if (effect.unit !== expectedUnit) throw new Error(`invalid cosmetic effect unit: ${effect.statId}/${effect.unit}`);
    }
  }
  // 여섯 부위를 다 채우지 못한 치장은 세트가 없다. 세트가 부르는 치장과 setId를 가진 치장이
  // 정확히 같아야 하고, 나머지는 setId가 비어 있어야 도감이 빈 세트를 그리지 않는다.
  const setMemberIds = content.cosmetics.filter((cosmetic) => cosmetic.setId !== null).map((cosmetic) => cosmetic.cosmeticId);
  if ([...memberIds].sort().join(",") !== [...setMemberIds].sort().join(",")) throw new Error("every cosmetic with a setId must belong to that set");
  // 전설은 간판 세트에서만 뽑히므로, 세트 없는 전설은 얻을 길이 없다.
  if (content.cosmetics.some((cosmetic) => cosmetic.setId === null && cosmetic.grade === "LEGENDARY")) throw new Error("a legendary cosmetic outside a set can never be drawn");
  const activeSets = content.sets.filter((set) => set.active !== false);
  const mappedSets = activeSets.filter((set) => set.bannerId !== null || set.boxItemId !== null);
  if (mappedSets.length !== 1 || mappedSets.some((set) => set.grade !== "LEGENDARY" || !set.bannerId || !set.boxItemId)) {
    throw new Error("exactly one active legendary set must map the shared gacha banner and selector box");
  }
  if (legacy) validateCosmeticCeilingCoupling(content);
}

/**
 * 던전 콘텐츠가 세 보스 모두 1..N 연속 단계를 갖는지 본다. 서버 카탈로그가 이 성질로 단계
 * 상한을 읽으므로, 한 보스만 단계가 모자라면 로드 자체가 실패한다.
 */
function validateGemDungeonLadder(content: GemDungeonsContent): void {
  const expected = ["SURVIVAL", "BERSERK", "ARMORED"];
  if (content.bosses.map((boss) => boss.bossType).sort().join(",") !== [...expected].sort().join(",")) {
    throw new Error("gem dungeon content must define all three bosses");
  }
  const counts = new Set(content.bosses.map((boss) => boss.stages.length));
  if (counts.size !== 1) throw new Error("every gem dungeon boss must expose the same stage count");
  const stageCount = [...counts][0]!;
  for (const boss of content.bosses) {
    const stages = boss.stages.map((row) => row.stage).sort((a, b) => a - b);
    if (stages.some((stage, index) => stage !== index + 1)) throw new Error(`gem dungeon stages must run 1..${stageCount}: ${boss.bossType}`);
    const loads = boss.stages.map((row) => (boss.bossType === "SURVIVAL" ? row.strikeDamage : row.bossHp));
    if (loads.some((load, index) => index > 0 && load <= loads[index - 1]!)) throw new Error(`gem dungeon difficulty must increase every stage: ${boss.bossType}`);
  }
}

/**
 * 던전 상한 단계는 활성 치장 세트를 전부 5성까지 올린 빌드로 산출한다. 비활성 세트를 켜거나
 * 세트 효과 수치를 바꾸면 그 상한이 올라가 던전 20단계 기준이 깨지므로 여기서 먼저 막는다.
 *
 * 값은 콘텐츠 기준이다. `docs/60-content/cosmetics/mvp-v1.md` 의 표(노말 5성 +1.00%)는 낡았고
 * 실제 콘텐츠의 등급별 5성 효과를 현재 활성 28세트에 합산하면 축마다 +219%% 다.
 *
 * 되살리는 작업은 이 상수를 고치고 `apps/balance-lab` 의 `dungeonBalance --write` 를 다시
 * 돌려 던전 수치를 재산출해야 한다.
 */
function validateCosmeticCeilingCoupling(content: CosmeticsContent): void {
  /*
   * 서버가 읽는 파일은 versions/v1 쪽이다 (CosmeticsConfiguration 이 /cosmetics/cosmetics.json).
   * progression-rebalance-v1 의 치장 파일은 별개 콘텐츠 버전이고 active 플래그가 없어 합계가
   * 다를 수 있다. 서빙 번들을 바꾸면 이 검사를 그쪽으로 옮기고 던전을 재산출해야 한다.
   */
  const expectedFiveStarTotal = 21_900;
  const axes = ["attackPercent", "maxHpPercent", "defensePenetrationPercent"] as const;
  for (const axis of axes) {
    const total = content.sets
      .filter((set) => set.active !== false)
      .reduce((sum, set) => {
        const fiveStar = set.effects.find((row) => row.star === 5);
        return sum + (fiveStar?.effects.find((effect) => effect.statId === axis)?.value ?? 0);
      }, 0);
    if (total !== expectedFiveStarTotal) {
      throw new Error(
        `active cosmetic sets at five stars must total ${expectedFiveStarTotal} basis points for ${axis}, got ${total}. ` +
          "the gem dungeon ceiling stage is derived from this number -- rerun dungeonBalance --write after changing it",
      );
    }
  }
}

function strictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]!);
}

function validateMonotonicEffects(rows: Array<{ effects: Effect[] }>, label: string): void {
  const previous = new Map<string, number>();
  for (const row of rows) {
    for (const effect of row.effects) {
      const key = `${effect.statId}:${effect.unit}`;
      if (effect.value < (previous.get(key) ?? 0)) throw new Error(`${label} must be cumulative`);
      previous.set(key, effect.value);
    }
  }
}

if (process.argv[1]?.endsWith("validate.ts")) await validateContent();
