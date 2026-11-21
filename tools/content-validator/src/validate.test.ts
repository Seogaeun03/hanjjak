import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { compileContentValidators, validateContent, validateLiveopsContent } from "./validate.js";
import { regenerateManifests } from "./buildProgressionRebalance.js";
const contentValidators = compileContentValidators();
async function makeFixtureRoot(prefix: string): Promise<string> {
  const parent = resolve(import.meta.dirname, "../build");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}
async function refreshChecksum(manifestPath: string, file: string, content: string): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.checksums[file] = createHash("sha256").update(content.replaceAll("\r\n", "\n")).digest("hex");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function expectRebalanceDriftRejected(
  prefix: string,
  file: "progression/progression.json" | "equipment/equipment.json",
  mutate: (content: Record<string, any>) => void,
  message: string,
): Promise<void> {
  const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
  const temporaryRoot = await makeFixtureRoot(prefix);
  try {
    await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
    const contentPath = resolve(temporaryRoot, "versions/progression-rebalance-v1", file);
    const content = JSON.parse(await readFile(contentPath, "utf8")) as Record<string, any>;
    mutate(content);
    await writeFile(contentPath, JSON.stringify(content));
    await regenerateManifests(temporaryRoot);
    await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow(message);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

describe("approved progression invariants", () => {
  it("rejects chapter 2 first-clear drift after regenerating the fixture manifest", async () => {
    await expectRebalanceDriftRejected("chapter-2-first-clear-drift-", "progression/progression.json", (content) => {
      content.stages[10].firstClear.rice += 1;
    }, "first-clear schedule mismatch");
  });

  it("generates identical manifest checksums for equivalent LF and CRLF fixtures", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const lfRoot = await makeFixtureRoot("checksum-lf-");
    const crlfRoot = await makeFixtureRoot("checksum-crlf-");
    const jsonFiles = [
      "schema/stages.schema.json", "schema/cosmetics.schema.json", "schema/material-drops.schema.json", "schema/gem-dungeons.schema.json", "schema/skills.schema.json", "schema/raids.schema.json",
      "versions/v1/chapters/chapters.json", "versions/v1/stages/stages.json", "versions/v1/cosmetics/cosmetics.json", "versions/v1/drops/material-drops.json", "versions/v1/gem-dungeons/gem-dungeons.json", "versions/v1/gem-dungeons/gem-dungeons-beta.json", "versions/v1/gem-dungeons/gem-dungeons-v2.json", "versions/v1/skills/skills.json", "versions/v1/raids/raids.json",
    ];
    try {
      await cp(sourceRoot, lfRoot, { recursive: true, force: true });
      await cp(sourceRoot, crlfRoot, { recursive: true, force: true });
      for (const file of jsonFiles) {
        const source = await readFile(resolve(sourceRoot, file), "utf8");
        const lf = source.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
        await writeFile(resolve(lfRoot, file), lf);
        await writeFile(resolve(crlfRoot, file), lf.split(String.fromCharCode(10)).join(String.fromCharCode(13, 10)));
      }
      await expect(validateContent(lfRoot, contentValidators)).resolves.toBeUndefined();
      await expect(validateContent(crlfRoot, contentValidators)).resolves.toBeUndefined();
      const lfManifest = JSON.parse(await readFile(resolve(lfRoot, "versions/v1/manifest.json"), "utf8"));
      const crlfManifest = JSON.parse(await readFile(resolve(crlfRoot, "versions/v1/manifest.json"), "utf8"));
      expect(crlfManifest.checksums).toEqual(lfManifest.checksums);
      expect(lfManifest.files).toContain("gem-dungeons/gem-dungeons-v2.json");
      expect(lfManifest.checksums["gem-dungeons/gem-dungeons-v2.json"]).toMatch(/^[0-9a-f]{64}$/);
      expect(lfManifest.files).toContain("raids/raids.json");
      expect(lfManifest.checksums["raids/raids.json"]).toMatch(/^[0-9a-f]{64}$/);
      expect(lfManifest.files).toContain("cosmetics/cosmetics.json");
      expect(lfManifest.checksums["cosmetics/cosmetics.json"]).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await Promise.all([rm(lfRoot, { recursive: true, force: true }), rm(crlfRoot, { recursive: true, force: true })]);
    }
  });

  it("rejects chapter 4 first-clear drift after regenerating the fixture manifest", async () => {
    await expectRebalanceDriftRejected("chapter-4-first-clear-drift-", "progression/progression.json", (content) => {
      content.stages[30].firstClear.items[0].quantity += 1;
    }, "first-clear schedule mismatch");
  });

  it.each([
    ["RARE", "M1", 28],
    ["EPIC", "M2", 28],
  ])("rejects %s %s per-generation total/row drift", async (grade, generation, index) => {
    await expectRebalanceDriftRejected("equipment-material-drift-", "equipment/equipment.json", (content) => {
      content.enhancementMaterials[grade][generation][index] += 1;
    }, "approved equipment material schedule mismatch");
  });

  it("rejects enhancement rice row drift after regenerating the fixture manifest", async () => {
    await expectRebalanceDriftRejected("enhancement-rice-drift-", "equipment/equipment.json", (content) => {
      content.enhancementRice.EPIC[10] += 1;
    }, "approved enhancement rice schedule mismatch");
  });

  it("rejects promotion material and rice cost drift after regenerating the fixture manifest", async () => {
    await expectRebalanceDriftRejected("promotion-cost-drift-", "equipment/equipment.json", (content) => {
      content.promotion.RARE.materials.M2 += 1;
      content.promotion.RARE.rice += 1;
    }, "approved promotion invariant mismatch");
  });

  it("rejects promotion gate drift after regenerating the fixture manifest", async () => {
    await expectRebalanceDriftRejected("promotion-gate-drift-", "equipment/equipment.json", (content) => {
      content.promotion.EPIC.requiredStageId = "stage.04-10";
    }, "approved promotion invariant mismatch");
  });
});

describe("content package", () => {
  it("has valid schemas, references and checksums", async () => { await expect(validateContent(undefined, contentValidators)).resolves.toBeUndefined(); });
  it("accepts an appended inactive set without changing the active balance ceiling", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("inactive-cosmetic-set-");
    const slots = ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE"];
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      for (const version of ["v1", "progression-rebalance-v1"]) {
        const contentPath = resolve(temporaryRoot, `versions/${version}/cosmetics/cosmetics.json`);
        const manifestPath = resolve(temporaryRoot, `versions/${version}/manifest.json`);
        const content = JSON.parse(await readFile(contentPath, "utf8"));
        const template = content.sets.find((set: any) => set.grade === "RARE" && set.bannerId === null);
        const nextCosmeticNumber = Math.max(...content.cosmetics.map((cosmetic: any) => Number(cosmetic.cosmeticId.split("-").at(-1)))) + 1;
        const nextSetNumber = Math.max(...content.sets.map((set: any) => Number(set.setId.split("-").at(-1)))) + 1;
        const setId = `cosmetic-set-${String(nextSetNumber).padStart(2, "0")}`;
        const members = Object.fromEntries(slots.map((slot, index) => [
          slot,
          `cosmetic-${String(nextCosmeticNumber + index).padStart(3, "0")}`,
        ]));
        content.cosmetics.push(...slots.map((slot, index) => ({
          cosmeticId: members[slot], displayName: null, imageUrl: null, grade: "RARE", slot, setId,
        })));
        content.sets.push({
          ...template, setId, displayName: "준비 세트", active: false,
          bannerId: null, boxItemId: null, members,
        });
        const serialized = `${JSON.stringify(content, null, 2)}\n`;
        await writeFile(contentPath, serialized);
        await refreshChecksum(manifestPath, "cosmetics/cosmetics.json", serialized);
      }
      await expect(validateContent(temporaryRoot, contentValidators)).resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
  it("rejects committed manifest drift without rewriting the manifest", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("manifest-drift-");
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const manifestPath = resolve(temporaryRoot, "versions/progression-rebalance-v1/manifest.json");
      const contentPath = resolve(temporaryRoot, "versions/progression-rebalance-v1/progression/progression.json");
      const before = await readFile(manifestPath, "utf8");
      const content = JSON.parse(await readFile(contentPath, "utf8"));
      content.stages[0].normalRice += 1;
      await writeFile(contentPath, JSON.stringify(content));
      await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow("manifest checksum mismatch");
      await expect(readFile(manifestPath, "utf8")).resolves.toBe(before);
    } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
  });
  it("rejects a first-clear item outside the full material and GEM_BOX catalog", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("unknown-item-");
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const contentPath = resolve(temporaryRoot, "versions/progression-rebalance-v1/progression/progression.json");
      const manifestPath = resolve(temporaryRoot, "versions/progression-rebalance-v1/manifest.json");
      const content = JSON.parse(await readFile(contentPath, "utf8"));
      content.stages[10].firstClear.items[0].itemId = "UNKNOWN_MATERIAL";
      const serialized = JSON.stringify(content);
      await writeFile(contentPath, serialized);
      await refreshChecksum(manifestPath, "progression/progression.json", serialized);
      await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow("unknown first-clear itemId");
    } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
  });
  it("rejects a first-clear direct skill outside the copied skill catalog", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("unknown-skill-");
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const contentPath = resolve(temporaryRoot, "versions/progression-rebalance-v1/progression/progression.json");
      const manifestPath = resolve(temporaryRoot, "versions/progression-rebalance-v1/manifest.json");
      const content = JSON.parse(await readFile(contentPath, "utf8"));
      content.stages[0].firstClear.directSkillId = "unknown_skill";
      const serialized = JSON.stringify(content);
      await writeFile(contentPath, serialized);
      await refreshChecksum(manifestPath, "progression/progression.json", serialized);
      await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow("unknown first-clear directSkillId");
    } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
  });
  it("rejects drift from approved skill tables", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("skill-drift-");
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const path = resolve(temporaryRoot, "versions/v1/skills/skills.json");
      const content = JSON.parse(await readFile(path, "utf8"));
      content.grades.NORMAL.enhancementRiceCoefficient = 91;
      await writeFile(path, JSON.stringify(content));
      await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow("manifest checksum mismatch");
    } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
  });
  it("validates both immutable roots with applied authority", async () => {
    await expect(validateContent(undefined, contentValidators)).resolves.toBeUndefined();
    const root = resolve(import.meta.dirname, "../../../packages/game-content");
    const manifest = JSON.parse(await readFile(resolve(root, "versions/progression-rebalance-v1/manifest.json"), "utf8"));
    expect(manifest.authority).toBe("applied");
    expect(manifest.files).toContain("progression/progression.json");
  });
  it("validates raid rewards and rejects threshold drift", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("raid-content-drift-");
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const contentPath = resolve(temporaryRoot, "versions/v1/raids/raids.json");
      const content = JSON.parse(await readFile(contentPath, "utf8"));
      expect(content.authority).toBe("working");
      expect(content.personalRewards.B).toEqual({ cosmeticTickets: 7, gemBoxes: 4, rice: 7_250 });
      await expect(validateContent(temporaryRoot, contentValidators)).resolves.toBeUndefined();
      content.gradeDamageThresholds.C = content.gradeDamageThresholds.D;
      await writeFile(contentPath, JSON.stringify(content));
      await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow("raid damage thresholds must be strictly increasing");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
  it("rejects a raid with an incorrect seal contribution table", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const temporaryRoot = await makeFixtureRoot("raid-contribution-drift-");
    try {
      await cp(sourceRoot, temporaryRoot, { recursive: true, force: true });
      const contentPath = resolve(temporaryRoot, "versions/v1/raids/raids.json");
      const content = JSON.parse(await readFile(contentPath, "utf8"));
      content.sealContributions.B = 234;
      await writeFile(contentPath, JSON.stringify(content));
      await expect(validateContent(temporaryRoot, contentValidators)).rejects.toThrow("raid seal contributions must match the approved table");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("emits RaidContent as the generated schema root", async () => {
    const sourceRoot = resolve(import.meta.dirname, "../../../packages/game-content");
    const schema = JSON.parse(await readFile(resolve(sourceRoot, "schema/raids.schema.json"), "utf8"));
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("bossInitialAttack");
    expect(schema.properties).toHaveProperty("gradeDamageThresholds");
  });
  it("committed raid schema matches the TypeSpec-generated root artifact", async () => {
    const schemaPath = resolve(import.meta.dirname, "../../../packages/game-content/schema/raids.schema.json");
    const committed = JSON.parse(await readFile(schemaPath, "utf8"));
    expect(committed.type).toBe("object");
    expect(committed.$id).toBe("raids.schema.json");
    expect(committed.required).toContain("bossInitialDefense");
    expect(committed.properties).toHaveProperty("gradeDamageThresholds");
    expect(committed.$defs).toBeDefined();
  });
  it("rejects unknown properties through the self-contained raid root schema", async () => {
    const schema = JSON.parse(await readFile(resolve(import.meta.dirname, "../../../packages/game-content/schema/raids.schema.json"), "utf8"));
    const validate = new Ajv2020.default({ strict: false }).compile(schema);
    const content = JSON.parse(await readFile(resolve(import.meta.dirname, "../../../packages/game-content/versions/v1/raids/raids.json"), "utf8"));
    expect(validate(content)).toBe(true);
    expect(validate({ ...content, unexpected: true })).toBe(false);
    expect(validate({ ...content, gradeDamageThresholds: { ...content.gradeDamageThresholds, unexpected: 1 } })).toBe(false);
  });

});

function baseLiveopsContent(): Record<string, any> {
  return JSON.parse(JSON.stringify({
    authority: "working",
    contentVersion: "hunt-ticket-gacha-v1",
    eventId: "hunt-ticket-gacha-2026-09",
    displayName: "사냥 이벤트 뽑기",
    startsAt: "2026-10-01T00:00:00+09:00",
    endsAt: "2026-10-15T00:00:00+09:00",
    accrual: { secondsPerTicket: 180, dailyCap: 40, maxHeartbeatGapSeconds: 60 },
    outcomes: [
      { kind: "PRIZE", prizeId: "prize.gifticon.cyburger", millionths: 100 },
      { kind: "COSMETIC_TICKET", quantity: 1, millionths: 50_000 },
      { kind: "RICE", minQuantity: 10, maxQuantity: 100, millionths: 949_900 },
    ],
    prizes: [{ prizeId: "prize.gifticon.cyburger", displayName: "싸이버거 기프티콘", stock: 5, perAccountLimit: 1 }],
  }));
}

function expectLiveopsRejected(mutate: (content: Record<string, any>) => void, message: string): void {
  const content = baseLiveopsContent();
  mutate(content);
  expect(() => validateLiveopsContent(content as any)).toThrow(message);
}

describe("validateLiveopsContent", () => {
  it("passes the approved fixture unmutated", () => {
    expect(() => validateLiveopsContent(baseLiveopsContent() as any)).not.toThrow();
  });

  it("rejects millionths that do not sum to exactly 1,000,000", () => {
    expectLiveopsRejected((content) => { content.outcomes[2].millionths += 1; }, "liveops outcome millionths must sum to 1000000 but was 1000001");
  });

  it("rejects a GEM_BOX outcome without a quantity", () => {
    expectLiveopsRejected((content) => {
      // millionths 를 쌀에서 옮겨 와 합계는 1,000,000 으로 유지하고 quantity 만 뺀다.
      content.outcomes[2].millionths -= 100_000;
      content.outcomes.push({ kind: "GEM_BOX", millionths: 100_000 });
    }, "liveops GEM_BOX outcome needs a quantity");
  });

  it("rejects content without exactly one RICE outcome", () => {
    expectLiveopsRejected((content) => {
      // millionths: 0 이므로 합계는 그대로 1,000,000 이고, RICE 개수만 둘이 된다.
      content.outcomes.push({ kind: "RICE", minQuantity: 1, maxQuantity: 5, millionths: 0 });
    }, "liveops content needs exactly one RICE outcome");
  });

  it("rejects more than one PRIZE outcome", () => {
    expectLiveopsRejected((content) => {
      // millionths: 0 이므로 합계는 그대로 1,000,000 이고, PRIZE 개수만 둘이 된다.
      content.outcomes.push({ kind: "PRIZE", prizeId: "prize.gifticon.cyburger", millionths: 0 });
    }, "liveops content allows at most one PRIZE outcome");
  });

  it("rejects a RICE outcome with an inverted minQuantity/maxQuantity range", () => {
    expectLiveopsRejected((content) => { content.outcomes[2].minQuantity = 200; }, "liveops RICE outcome has an invalid range");
  });

  it("rejects a RICE outcome missing minQuantity or maxQuantity", () => {
    expectLiveopsRejected((content) => { delete content.outcomes[2].maxQuantity; }, "liveops RICE outcome has an invalid range");
  });

  it("rejects a COSMETIC_TICKET outcome without a positive quantity", () => {
    expectLiveopsRejected((content) => { content.outcomes[1].quantity = 0; }, "liveops COSMETIC_TICKET outcome needs a quantity");
  });

  it("rejects a PRIZE outcome referencing an undeclared prizeId", () => {
    expectLiveopsRejected((content) => { content.outcomes[0].prizeId = "prize.unknown"; }, "liveops outcome references undeclared prize prize.unknown");
  });

  it("rejects duplicate prizeId values in prizes", () => {
    expectLiveopsRejected((content) => {
      content.prizes.push({ prizeId: "prize.gifticon.cyburger", displayName: "복사본", stock: 1, perAccountLimit: 1 });
    }, "liveops prize ids must be unique");
  });

  it("rejects an event window where startsAt is not before endsAt", () => {
    expectLiveopsRejected((content) => { content.startsAt = "2026-10-20T00:00:00+09:00"; }, "liveops event window is inverted");
  });
});
