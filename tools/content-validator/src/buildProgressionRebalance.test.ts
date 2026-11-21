import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLegacyEquipmentContent,
  buildLegacyProgressionContent,
  buildProgressionEquipmentContent,
  buildProgressionRebalanceContent,
  buildRebalanceMaterialDrops,
  writeProgressionPackages,
} from "./buildProgressionRebalance.js";
import { validateContent } from "./validate.js";

async function makeFixtureRoot(): Promise<string> {
  const parent = resolve(import.meta.dirname, "../build");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "generated-content-"));
}

describe("progression content packages", () => {
  it("builds the approved progression rebalance first-clear and drop tables", () => {
    const rebalance = {
      contentVersion: "progression-rebalance-v1",
      progression: buildProgressionRebalanceContent(),
      materialDrops: buildRebalanceMaterialDrops(),
    };
    expect(rebalance.contentVersion).toBe("progression-rebalance-v1");
    expect(rebalance.progression.stages).toHaveLength(150);
    expect(rebalance.progression.stages.find((row) => row.stageId === "stage.01-01")?.firstClear).toEqual({
      rice: 1_392,
      tickets: 0,
      items: [
        { itemId: "POTATO_M1", quantity: 178 },
        { itemId: "SWEET_POTATO_M1", quantity: 178 },
        { itemId: "CORN_M1", quantity: 178 },
      ],
      /* 스킬은 스킬북으로만 연다. 스테이지가 직접 열어 주지 않는다. */
      directSkillId: null,
    });
    expect(rebalance.progression.stages.find((row) => row.stageId === "stage.03-10")?.firstClear?.items).toEqual([
      { itemId: "POTATO_M1", quantity: 206 },
      { itemId: "SWEET_POTATO_M1", quantity: 206 },
      { itemId: "CORN_M1", quantity: 206 },
      { itemId: "POTATO_M2", quantity: 41 },
      { itemId: "SWEET_POTATO_M2", quantity: 41 },
      { itemId: "CORN_M2", quantity: 41 },
      { itemId: "POTATO_M3", quantity: 1 },
      { itemId: "SWEET_POTATO_M3", quantity: 1 },
      { itemId: "CORN_M3", quantity: 1 },
      { itemId: "GEM_BOX", quantity: 30 },
    ]);
    expect(rebalance.materialDrops.chapters["1"]).toEqual({
      mode: "GUARANTEED",
      normalQuantity: 2,
      bossQuantity: 10,
      /* 신화가 M5 를 쓰므로 모든 챕터가 길이 5 로 맞춰진다. 1장은 M2~M5 자리를 0 으로 채운다. */
      generationWeights: [1, 0, 0, 0, 0],
    });
    expect(rebalance.materialDrops.chapters["2"]?.mode).toBe("CHANCE");
    expect(rebalance.materialDrops.chapters["4"]?.generationWeights).toEqual([125, 25, 5, 1, 0]);
  });

  it("hands one active skill book to each of the first four unlock stages", () => {
    const stages = buildProgressionRebalanceContent().stages;
    const booksOf = (stageId: string) =>
      stages.find((row) => row.stageId === stageId)?.firstClear?.items.filter((item) => item.itemId.startsWith("skillbook:")) ?? [];

    expect(booksOf("stage.01-02")).toEqual([{ itemId: "skillbook:active_heavy:normal", quantity: 1 }]);
    expect(booksOf("stage.01-03")).toEqual([{ itemId: "skillbook:active_dot:normal", quantity: 1 }]);
    expect(booksOf("stage.01-04")).toEqual([{ itemId: "skillbook:active_haste:normal", quantity: 1 }]);
    expect(booksOf("stage.01-05")).toEqual([{ itemId: "skillbook:active_basic_amp:normal", quantity: 1 }]);
    for (const stageId of ["stage.01-01", "stage.01-06", "stage.01-10", "stage.02-02"]) expect(booksOf(stageId)).toEqual([]);
    /* 책만 주고 해금은 플레이어가 한다. 스테이지가 스킬을 직접 열어 주면 안 된다. */
    expect(stages.every((row) => (row.firstClear?.directSkillId ?? null) === null)).toBe(true);
  });

  it("uses the approved NORMAL per-slot schedule instead of generic brackets", () => {
    expect(buildProgressionEquipmentContent().enhancementMaterials.NORMAL.M1).toEqual([
      ...Array.from({ length: 10 }, () => 40),
      ...Array.from({ length: 10 }, () => 60),
      ...Array.from({ length: 9 }, () => 74),
    ]);
    expect(buildProgressionEquipmentContent().enhancementMaterials.NORMAL.M1!.reduce((sum, value) => sum + value, 0)).toBe(1_666);
    expect(buildProgressionEquipmentContent().enhancementMaterials.RARE.M1!.reduce((sum, value) => sum + value, 0)).toBe(3_700);
    expect(buildProgressionEquipmentContent().enhancementMaterials.EPIC.M1!.reduce((sum, value) => sum + value, 0)).toBe(10_300);
  });

  it("charges a fifth per material generation from EPIC upward", () => {
    const materials = buildProgressionEquipmentContent().enhancementMaterials;
    const total = (steps: number[] | undefined) => steps!.reduce((sum, value) => sum + value, 0);
    for (const grade of ["EPIC", "LEGENDARY"] as const) {
      const m1 = total(materials[grade].M1);
      for (const [generation, steps] of Object.entries(materials[grade])) {
        const power = Number(generation.slice(1)) - 1;
        expect([grade, generation, total(steps)]).toEqual([grade, generation, Math.round(m1 / 5 ** power)]);
      }
    }
  });

  it("never lets a material cost less after a promotion than before it", () => {
    const materials = buildProgressionEquipmentContent().enhancementMaterials;
    const order = ["NORMAL", "RARE", "EPIC", "LEGENDARY"] as const;
    let compared = 0;
    for (let index = 0; index < order.length - 1; index += 1) {
      const lower = materials[order[index]!];
      const upper = materials[order[index + 1]!];
      for (const [generation, steps] of Object.entries(upper)) {
        const closing = lower[generation]?.at(-1);
        if (closing === undefined) continue;
        compared += 1;
        expect([order[index + 1], generation, steps[0]! >= closing]).toEqual([order[index + 1], generation, true]);
      }
    }
    // M1 + (M1,M2) + (M1,M2,M3). Without this the invariant passes vacuously when a generation vanishes.
    expect(compared).toBe(6);
    expect(materials.EPIC.M2!.reduce((sum, value) => sum + value, 0)).toBe(2_060);
    expect(materials.EPIC.M3!.reduce((sum, value) => sum + value, 0)).toBe(412);
  });

  it("carries each grade's closing M1 step into the next grade as fifty times that step", () => {
    const materials = buildProgressionEquipmentContent().enhancementMaterials;
    const total = (steps: number[]) => steps.reduce((sum, value) => sum + value, 0);
    for (const [lower, upper] of [["NORMAL", "RARE"], ["RARE", "EPIC"]] as const) {
      const closing = materials[lower].M1!.at(-1)!;
      expect([upper, total(materials[upper].M1!)]).toEqual([upper, 50 * closing]);
      expect([upper, materials[upper].M1![0]]).toEqual([upper, closing]);
    }
  });

  it("promotes with one closing step of every generation the grade spends plus one new generation", () => {
    const content = buildProgressionEquipmentContent();
    const unlocked = { NORMAL: "M2", RARE: "M3", EPIC: "M4" } as const;
    for (const grade of ["NORMAL", "RARE", "EPIC"] as const) {
      const steps = content.enhancementMaterials[grade] as Record<string, number[]>;
      expect([grade, Object.keys(steps).includes(unlocked[grade])]).toEqual([grade, false]);
      const expected: Record<string, number> = Object.fromEntries(Object.entries(steps).map(([generation, values]) => [generation, values.at(-1)!]));
      /* 신규 세대는 다음 등급 1강의 10%를 올림해 받는다. 늘 1이던 시절의 값을 박아두면
         사다리를 올릴 때 이 규칙이 아니라 우연을 검사하게 된다. */
      const nextGrade = { NORMAL: "RARE", RARE: "EPIC", EPIC: "LEGENDARY" }[grade] as "RARE" | "EPIC" | "LEGENDARY";
      const opening = (content.enhancementMaterials[nextGrade] as Record<string, number[]>)[unlocked[grade]]![0]!;
      expected[unlocked[grade]] = Math.max(1, Math.ceil(0.1 * opening));
      expect([grade, content.promotion[grade].materials]).toEqual([grade, expected]);
    }
  });

  it("keeps the current legacy generated values and uses immutable rebalance metadata", () => {
    const legacy = buildLegacyProgressionContent();
    expect(legacy.authority).toBe("applied");
    expect(legacy.contentVersion).toBe("v1");
    expect(legacy.levelRange).toBeNull();
    expect(legacy.stages).toHaveLength(40);
    expect(legacy.stages[0]).toMatchObject({ stageId: "stage.01-01", normalExperience: 3, bossExperience: 15, normalRice: 1, bossRice: 10 });
    expect(buildLegacyEquipmentContent().compatibilityOnly).toBe(true);
    expect(buildProgressionEquipmentContent().compatibilityOnly).toBe(false);
    expect(buildProgressionRebalanceContent().authority).toBe("applied");
  });

  it("covers one hundred fifty stages and the level cap of 300", () => {
    const content = buildProgressionRebalanceContent();
    expect(content.stages).toHaveLength(150);
    expect(content.levelRange).toEqual({ min: 1, max: 300 });
    expect(content.stages[99]!.stageId).toBe("stage.10-10");
    expect(content.stages[99]!.bossRice).toBe(1_000);
    expect(content.stages[149]!.stageId).toBe("stage.15-10");
    expect(content.stages[149]!.bossExperience).toBe(content.stages[149]!.normalExperience * 5);
    expect(content.stages[149]!.bossRice).toBe(1_500);
    /* 5장은 4장과 재료를 그대로 쓰되 치장 뽑기권이 붙는다. 예전에는 두 장이 통째로 같았다. */
    expect(content.stages[44]!.firstClear?.items).toEqual(content.stages[34]!.firstClear?.items);
    expect(content.stages[44]!.firstClear?.rice).toBe(content.stages[34]!.firstClear?.rice);
    expect(content.stages[34]!.firstClear?.tickets).toBe(0);
    expect(content.stages[44]!.firstClear?.tickets).toBe(10);
  });

  it("slides the reward window up the material ladder and drops F from chapter four", () => {
    const stages = buildProgressionRebalanceContent().stages;
    const generations = (stageId: string) =>
      stages.find((row) => row.stageId === stageId)?.firstClear?.items
        .filter((item) => item.itemId.startsWith("POTATO_"))
        .map((item) => item.itemId.replace("POTATO_", "")) ?? [];

    expect(generations("stage.03-01")).toEqual(["M1", "M2"]);
    /* 4장부터 F(M1)는 주지 않는다. 드롭이 남아돌고 거래소에서 가장 싸다. */
    expect(generations("stage.04-01")).toEqual(["M2", "M3"]);
    expect(generations("stage.05-09")).toEqual(["M2", "M3"]);
    expect(generations("stage.06-01")).toEqual(["M2", "M3", "M4"]);
    expect(generations("stage.07-09")).toEqual(["M2", "M3", "M4"]);
    expect(generations("stage.08-01")).toEqual(["M3", "M4", "M5"]);
    expect(generations("stage.10-09")).toEqual(["M3", "M4", "M5"]);
    for (const chapter of [4, 5, 6, 7, 8, 9, 10]) {
      const id = `stage.${String(chapter).padStart(2, "0")}-01`;
      expect(generations(id)).not.toContain("M1");
    }
  });

  it("closes M3 from chapter eleven and pays mythic M4·M5 at 10% per chapter", () => {
    const stages = buildProgressionRebalanceContent().stages;
    const firstClearOf = (stageId: string) => stages.find((row) => row.stageId === stageId)!.firstClear!;
    const quantity = (stageId: string, itemId: string) => firstClearOf(stageId).items.find((item) => item.itemId === itemId)?.quantity;

    expect(firstClearOf("stage.10-09").items.map((item) => item.itemId).filter((id) => id.startsWith("POTATO_"))).toEqual(["POTATO_M3", "POTATO_M4", "POTATO_M5"]);
    for (const chapter of [11, 12, 13, 14, 15]) {
      const ids = Array.from({ length: 9 }, (_, index) => `stage.${chapter}-${String(index + 1).padStart(2, "0")}`);
      for (const id of ids) {
        expect(firstClearOf(id).items.map((item) => item.itemId)).toEqual(["POTATO_M4", "SWEET_POTATO_M4", "CORN_M4", "POTATO_M5", "SWEET_POTATO_M5", "CORN_M5"]);
      }
      expect(ids.reduce((sum, id) => sum + quantity(id, "CORN_M4")!, 0)).toBe(720);
      expect(ids.reduce((sum, id) => sum + quantity(id, "CORN_M5")!, 0)).toBe(216);
      expect(firstClearOf(ids[4]!).tickets).toBe(30);
      expect(firstClearOf(`stage.${chapter}-10`)).toEqual({ rice: 0, tickets: 20, items: [], directSkillId: null });
    }
    expect(quantity("stage.11-01", "POTATO_M4")).toBe(16);
    expect(quantity("stage.11-01", "POTATO_M5")).toBe(5);
    expect(quantity("stage.15-09", "POTATO_M5")).toBe(43);
    expect(firstClearOf("stage.11-01").rice).toBe(2_610);
  });

  it("pays cosmetic tickets from chapter five and fills every chapter ending from chapter four", () => {
    const stages = buildProgressionRebalanceContent().stages;
    const ticketsOf = (stageId: string) => stages.find((row) => row.stageId === stageId)?.firstClear?.tickets;

    expect(ticketsOf("stage.04-05")).toBe(0);
    expect(ticketsOf("stage.05-05")).toBe(10);
    expect(ticketsOf("stage.06-05")).toBe(20);
    expect(ticketsOf("stage.07-05")).toBe(20);
    expect(ticketsOf("stage.08-05")).toBe(30);
    expect(ticketsOf("stage.10-05")).toBe(30);
    /* 1~3장 마지막은 승급 스타터와 보석함이 이미 자리를 잡고 있어 뽑기권을 얹지 않는다. */
    for (const stageId of ["stage.01-10", "stage.02-10", "stage.03-10"]) expect(ticketsOf(stageId)).toBe(0);
    /* 4장부터 장 마지막은 비워 두지 않고 뽑기권만 준다. */
    for (const chapter of [4, 5, 6, 7, 8, 9, 10]) {
      const ending = stages.find((row) => row.stageId === `stage.${String(chapter).padStart(2, "0")}-10`)?.firstClear;
      expect(ending).toEqual({ rice: 0, tickets: 20, items: [], directSkillId: null });
    }
    const total = stages
      .filter((row) => Number(row.stageId.slice(6, 8)) >= 4)
      .reduce((sum, row) => sum + (row.firstClear?.tickets ?? 0), 0);
    /* 4~10장 합(1,400)에 11~15장(각 장 9*30+20=290)을 더한 값. 챕터 확장이 총량을 그대로 밀어 올린다. */
    expect(total).toBe(2_850);
  });

  /* Task 3 이전엔 이름 그대로 M1-M4 뿐이었다. 신화가 M5 를 쓰게 되면서 8장부터 다섯 번째
     세대가 열린다 — "M5 드롭 개방" describe 블록이 그 개방 규칙 전체를 검증한다. 여기서는
     챕터 개수와 모드만 계속 확인한다. */
  it("keeps fifteen material-drop chapters with the right modes", () => {
    const drops = buildRebalanceMaterialDrops();
    expect(Object.keys(drops.chapterGenerationWeights)).toHaveLength(15);
    expect(drops.chapterGenerationWeights["10"]).toEqual([625, 125, 25, 5, 1]);
    expect(drops.chapterGenerationWeights["15"]).toEqual([625, 125, 25, 5, 1]);
    expect(drops.chapters["15"]!.mode).toBe("CHANCE");
    expect(drops.chapters["15"]!.normalQuantity).toBe(10);
    expect(drops.chapters["15"]!.bossQuantity).toBe(10);
    expect(drops.chapters["1"]!.mode).toBe("GUARANTEED");
  });
  it("generates exact legacy and rebalance promotion rows", () => {
    expect(buildLegacyEquipmentContent().promotion).toEqual({
      NORMAL: { requiredStageId: "stage.01-10", materials: { M2: 10 }, rice: 1_000, resultGrade: "RARE" },
      RARE: { requiredStageId: "stage.02-10", materials: { M3: 10 }, rice: 5_000, resultGrade: "EPIC" },
      EPIC: { requiredStageId: "stage.03-10", materials: { M4: 10 }, rice: 25_000, resultGrade: "LEGENDARY" },
      LEGENDARY: { requiredStageId: "stage.99-99", materials: {}, rice: 0, resultGrade: "LEGENDARY" },
      /* legacy(v1) 콘텐츠에도 센티넬로 MYTHIC 행이 나온다. Kotlin 쪽 종단 판정이 이 행으로
         legacy 계정의 승급을 닫는다. */
      MYTHIC: { requiredStageId: "stage.99-99", materials: {}, rice: 0, resultGrade: "MYTHIC" },
    });
    expect(buildProgressionEquipmentContent().promotion).toEqual({
      NORMAL: { requiredStageId: "stage.01-10", materials: { M1: 74, M2: 2 }, rice: 870, resultGrade: "RARE" },
      RARE: { requiredStageId: "stage.03-10", materials: { M1: 206, M2: 41, M3: 1 }, rice: 1_770, resultGrade: "EPIC" },
      EPIC: { requiredStageId: "stage.05-10", materials: { M1: 573, M2: 115, M3: 23, M4: 1 }, rice: 2_670, resultGrade: "LEGENDARY" },
      LEGENDARY: { requiredStageId: "stage.07-10", materials: { M1: 1_500, M2: 300, M3: 60, M4: 12, M5: 1 }, rice: 3_570, resultGrade: "MYTHIC" },
      MYTHIC: { requiredStageId: "stage.99-99", materials: {}, rice: 0, resultGrade: "MYTHIC" },
    });
  });

  it("writes both version roots without mutating the committed content package", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot();
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const protectedFiles = [
        "versions/progression-rebalance-v1/stages/stages.json",
        "versions/progression-rebalance-v1/cosmetics/cosmetics.json",
      ] as const;
      const protectedContent = Object.fromEntries(
        await Promise.all(protectedFiles.map(async (file) => [file, await readFile(resolve(temporaryRoot, file), "utf8")] as const)),
      ) as Record<(typeof protectedFiles)[number], string>;
      await writeProgressionPackages(temporaryRoot);
      const required = [
        "versions/v1/progression/progression.json",
        "versions/v1/equipment/equipment.json",
        "versions/progression-rebalance-v1/manifest.json",
        "versions/progression-rebalance-v1/chapters/chapters.json",
        "versions/progression-rebalance-v1/stages/stages.json",
        "versions/progression-rebalance-v1/drops/material-drops.json",
        "versions/progression-rebalance-v1/progression/progression.json",
        "versions/progression-rebalance-v1/equipment/equipment.json",
        "versions/progression-rebalance-v1/skills/skills.json",
        "versions/progression-rebalance-v1/gem-dungeons/gem-dungeons.json",
        "versions/progression-rebalance-v1/cosmetics/cosmetics.json",
      ];
      for (const file of required) await expect(readFile(resolve(temporaryRoot, file), "utf8")).resolves.toMatch(/\S/);
      await expect(validateContent(temporaryRoot)).resolves.toBeUndefined();
      for (const file of protectedFiles) {
        await expect(readFile(resolve(temporaryRoot, file), "utf8")).resolves.toBe(protectedContent[file]);
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  describe("신화 등급", () => {
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

    it("재료는 전설 마지막 단계에서 파생되고 상위 세대일수록 가파르게 오른다", () => {
      const content = buildProgressionEquipmentContent();
      const mythic = content.enhancementMaterials.MYTHIC;

      expect(total(mythic.M1!)).toBe(75_000);
      expect(total(mythic.M2!)).toBe(15_000);
      expect(total(mythic.M3!)).toBe(4_500);
      expect(total(mythic.M4!)).toBe(1_200);
      expect(total(mythic.M5!)).toBe(360);
      expect(total(content.enhancementRice.MYTHIC)).toBe(117_450);
    });

    /* 새 등급 1강은 이전 등급 29강과 같은 비용에서 열려야 한다. M3·M4·M5 는 사다리 값보다
       배수를 얹었으므로 같기만 하면 안 되고 더 커야 한다. */
    it("1강이 전설 29강 아래로 내려가지 않는다", () => {
      const content = buildProgressionEquipmentContent();
      const legendary = content.enhancementMaterials.LEGENDARY;
      const mythic = content.enhancementMaterials.MYTHIC;

      expect(mythic.M1![0]).toBe(legendary.M1!.at(-1));
      expect(mythic.M2![0]).toBe(legendary.M2!.at(-1));
      expect(mythic.M3![0]!).toBeGreaterThanOrEqual(legendary.M3!.at(-1)!);
      expect(mythic.M4![0]!).toBeGreaterThanOrEqual(legendary.M4!.at(-1)!);
    });

    it("전설 승급이 신화를 가리키고 신화가 새 종단이 된다", () => {
      const content = buildProgressionEquipmentContent();

      expect(content.promotion.LEGENDARY).toEqual({
        requiredStageId: "stage.07-10",
        materials: { M1: 1_500, M2: 300, M3: 60, M4: 12, M5: 1 },
        rice: 3_570,
        resultGrade: "MYTHIC",
      });
      expect(content.promotion.MYTHIC).toEqual({
        requiredStageId: "stage.99-99",
        materials: {},
        rice: 0,
        resultGrade: "MYTHIC",
      });
    });

    it("전설 수치는 신화를 붙여도 그대로다", () => {
      const legendary = buildProgressionEquipmentContent().enhancementMaterials.LEGENDARY;

      expect(total(legendary.M1!)).toBe(39_750);
      expect(total(legendary.M4!)).toBe(318);
    });
  });

  describe("M5 드롭 개방", () => {
    it("모든 챕터가 같은 너비고 8장부터 M5 가 열린다", () => {
      const weights = buildRebalanceMaterialDrops().chapterGenerationWeights;

      for (const chapter of Object.keys(weights)) expect(weights[chapter]!.length, `chapter ${chapter}`).toBe(5);
      expect(weights["7"]).toEqual([125, 25, 5, 1, 0]);
      expect(weights["8"]).toEqual([625, 125, 25, 5, 1]);
      expect(weights["10"]).toEqual([625, 125, 25, 5, 1]);
      expect(weights["15"]).toEqual([625, 125, 25, 5, 1]);
    });

    /* DropTable 의 불변식이다. 내부에 0 이 끼면 GENERATION_GAP, 개방 세대가 줄면
       GENERATIONS_MUST_NOT_CLOSE 로 콘텐츠 로딩이 막힌다. */
    it("개방 세대 수가 챕터를 따라 줄지 않고 내부에 구멍이 없다", () => {
      const weights = buildRebalanceMaterialDrops().chapterGenerationWeights;
      let openedBefore = 0;

      for (let chapter = 1; chapter <= 15; chapter += 1) {
        const row = weights[String(chapter)]!;
        const opened = row.reduce((last, value, index) => (value > 0 ? index + 1 : last), 0);
        expect(row.slice(0, opened).every((value) => value > 0), `chapter ${chapter} interior zero`).toBe(true);
        expect(opened, `chapter ${chapter} closed a generation`).toBeGreaterThanOrEqual(openedBefore);
        openedBefore = opened;
      }
    });
  });
});
