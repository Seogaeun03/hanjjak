const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { build, reconcileRegistry } = require("./build-cosmetics-content.cjs");
const { addToSource, parseArgs, withFileRollback } = require("./add-cosmetic.cjs");
const { assertAppendOnly, resolveBaseRef } = require("./validate-cosmetic-identities.cjs");

const root = join(__dirname, "../..");
const source = JSON.parse(readFileSync(join(__dirname, "catalog-source.json"), "utf8"));
const registry = JSON.parse(readFileSync(join(root, "packages/game-content/catalogs/cosmetic-identities.json"), "utf8"));

test("new cosmetic receives an ID after the existing maximum", () => {
  const changedSource = structuredClone(source);
  const changedRegistry = structuredClone(registry);
  changedSource.singles.push({ slug: "test-mask", part: "face", name: "테스트 가면", grade: "RARE", slot: "FACE" });

  reconcileRegistry(changedSource, changedRegistry);

  const added = changedRegistry.cosmetics.at(-1);
  assert.equal(added.key, "single:test-mask:face");
  assert.equal(added.cosmeticId, "cosmetic-191");
  assert.doesNotThrow(() => assertAppendOnly(registry, changedRegistry));
});

test("new set receives one set ID and six cosmetic IDs with the requested grade", () => {
  const changedSource = structuredClone(source);
  const changedRegistry = structuredClone(registry);
  addToSource(changedSource, { kind: "set", slug: "test-knight", name: "테스트 기사", grade: "RARE" });

  reconcileRegistry(changedSource, changedRegistry);

  const addedSet = changedRegistry.sets.at(-1);
  const members = changedRegistry.cosmetics.filter(item => item.setKey === "set:test-knight");
  assert.deepEqual(addedSet, { key: "set:test-knight", setId: "cosmetic-set-29", grade: "RARE" });
  assert.equal(members.length, 6);
  assert.deepEqual(members.map(item => item.cosmeticId), ["cosmetic-191", "cosmetic-192", "cosmetic-193", "cosmetic-194", "cosmetic-195", "cosmetic-196"]);
  assert.ok(members.every(item => item.grade === "RARE"));
  assert.equal(build(changedSource, changedRegistry).sets.at(-1).active, false);
  assert.doesNotThrow(() => assertAppendOnly(registry, changedRegistry));
});

test("reordering the source never renumbers existing identities", () => {
  const changedSource = structuredClone(source);
  const changedRegistry = structuredClone(registry);
  changedSource.sets.reverse();
  changedSource.singles.reverse();

  reconcileRegistry(changedSource, changedRegistry);

  assert.deepEqual(changedRegistry, registry);
});

test("generated catalog gives every cosmetic an operator-readable name", () => {
  const generated = build(source, registry);
  assert.equal(generated.cosmetics.length, 190);
  assert.ok(generated.cosmetics.every(item => item.displayName));
  assert.equal(generated.cosmetics.find(item => item.cosmeticId === "cosmetic-001").displayName, "가죽경갑 모자");
  assert.equal(generated.cosmetics.find(item => item.cosmeticId === "cosmetic-003").displayName, "가죽경갑 무기");
  assert.equal(generated.cosmetics.find(item => item.cosmeticId === "cosmetic-177").displayName, "긱시크안경");
  assert.equal(generated.cosmetics.find(item => item.cosmeticId === "cosmetic-190").displayName, "싸피 후드집업 하양");
});

test("existing cosmetic grade cannot change", () => {
  const changedSource = structuredClone(source);
  const changedRegistry = structuredClone(registry);
  changedSource.sets[0].grade = "LEGENDARY";

  assert.throws(() => reconcileRegistry(changedSource, changedRegistry), /기존 세트 등급 변경 금지/);
});

test("existing identity cannot be deleted or reassigned", () => {
  const deleted = structuredClone(registry);
  deleted.cosmetics.shift();
  assert.throws(() => assertAppendOnly(registry, deleted), /삭제 금지/);

  const reassigned = structuredClone(registry);
  reassigned.cosmetics[0].cosmeticId = "cosmetic-999";
  assert.throws(() => assertAppendOnly(registry, reassigned), /변경 금지/);
});

test("add command records teammate input and lets the registry assign identity", () => {
  const changedSource = structuredClone(source);
  const key = addToSource(changedSource, {
    kind: "single",
    slug: "leaf-mask",
    part: "face",
    name: "나뭇잎 가면",
    grade: "RARE",
    slot: "FACE",
  });

  assert.equal(key, "single:leaf-mask:face");
  assert.deepEqual(changedSource.singles.at(-1), {
    slug: "leaf-mask",
    part: "face",
    name: "나뭇잎 가면",
    displayName: "나뭇잎 가면",
    grade: "RARE",
    slot: "FACE",
  });
});

test("pnpm argument separator is ignored", () => {
  assert.deepEqual(parseArgs(["--", "set", "--slug", "new-set"]), { kind: "set", slug: "new-set" });
});

test("add command rejects legendary singles and duplicate art paths before writing", () => {
  const changedSource = structuredClone(source);
  assert.throws(() => addToSource(changedSource, {
    kind: "single", slug: "legend", part: "face", name: "전설", grade: "LEGENDARY", slot: "FACE",
  }), /전설 단품/);
  assert.throws(() => addToSource(changedSource, {
    kind: "single", slug: "afro", part: "other-hat", name: "중복", grade: "NORMAL", slot: "HEAD",
  }), /같은 아트 경로/);
});

test("failed multi-file write restores every original file", () => {
  const directory = mkdtempSync(join(tmpdir(), "cosmetic-rollback-"));
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  writeFileSync(first, "before-first");
  writeFileSync(second, "before-second");
  try {
    assert.throws(() => withFileRollback([first, second], () => {
      writeFileSync(first, "after-first");
      writeFileSync(second, "after-second");
      throw new Error("validation failed");
    }), /validation failed/);
    assert.equal(readFileSync(first, "utf8"), "before-first");
    assert.equal(readFileSync(second, "utf8"), "before-second");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CI base resolution prefers target tip and main previous commit", () => {
  assert.equal(resolveBaseRef([], { CI_MERGE_REQUEST_TARGET_BRANCH_SHA: "target-tip" }), "target-tip");
  assert.equal(resolveBaseRef([], { CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main" }), "origin/main");
  assert.equal(resolveBaseRef([], {
    CI_COMMIT_BRANCH: "main", CI_DEFAULT_BRANCH: "main", CI_COMMIT_BEFORE_SHA: "previous-main",
  }), "previous-main");
  assert.equal(resolveBaseRef([], { CI_COMMIT_BRANCH: "main", CI_DEFAULT_BRANCH: "main" }), "HEAD^");
});
