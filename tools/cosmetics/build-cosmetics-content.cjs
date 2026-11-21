const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_PATH = path.join(__dirname, "catalog-source.json");
const REGISTRY_PATH = path.join(ROOT, "packages/game-content/catalogs/cosmetic-identities.json");
const CONTENT_PATHS = [
  path.join(ROOT, "packages/game-content/versions/v1/cosmetics/cosmetics.json"),
  path.join(ROOT, "packages/game-content/versions/progression-rebalance-v1/cosmetics/cosmetics.json"),
];
const ART_MAP_PATH = path.join(ROOT, "apps/web/src/features/cosmetics/cosmetic-art-map.ts");
const SET_SLOTS = ["HEAD", "TOP", "BOTTOM", "GLOVES", "SHOES", "CAPE"];
const SLOT_DISPLAY_NAMES = {
  HEAD: "모자",
  FACE: "얼굴",
  TOP: "상의",
  BOTTOM: "무기",
  GLOVES: "장갑",
  SHOES: "신발",
  CAPE: "망토",
};
const GRADES = ["NORMAL", "RARE", "EPIC", "LEGENDARY"];
const SLOTS = [...SET_SLOTS, "FACE"];
const EFFECT_STEP = { NORMAL: 80, RARE: 120, EPIC: 160, LEGENDARY: 220 };
const EFFECT_STATS = ["attackPercent", "maxHpPercent", "defensePenetrationPercent"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function numericSuffix(value) {
  const match = value.match(/(\d+)$/);
  if (!match) throw new Error(`숫자 접미사가 없는 ID: ${value}`);
  return Number(match[1]);
}

function nextId(prefix, width, used) {
  const max = [...used].reduce((current, value) => Math.max(current, numericSuffix(value)), 0);
  if (max + 1 >= 10 ** width) throw new Error(`${prefix} ID 발급 범위 소진`);
  const value = `${prefix}${String(max + 1).padStart(width, "0")}`;
  used.add(value);
  return value;
}

function assertUnique(items, valueOf, label) {
  const seen = new Set();
  for (const item of items) {
    const value = valueOf(item);
    if (seen.has(value)) throw new Error(`${label} 중복: ${value}`);
    seen.add(value);
  }
}

function validateSource(source) {
  if (!source || !Array.isArray(source.sets) || !Array.isArray(source.singles)) {
    throw new Error("catalog-source.json의 sets와 singles는 배열이어야 합니다.");
  }
  assertUnique(source.sets, item => `set:${item.slug}`, "세트 키");
  assertUnique(source.singles, item => `single:${item.slug}:${item.part}`, "단품 키");
  assertUnique(source.singles, item => `single-art:${item.slug}:${item.slot}`, "단품 아트 경로");
  for (const item of [...source.sets, ...source.singles]) {
    if (!item.slug || !item.name || !GRADES.includes(item.grade)) {
      throw new Error(`치장 소스 필드 오류: ${JSON.stringify(item)}`);
    }
  }
  for (const item of source.singles) {
    if (!item.part || !SLOTS.includes(item.slot)) {
      throw new Error(`단품 part/slot 오류: ${JSON.stringify(item)}`);
    }
    if (item.gachaEligible !== undefined && typeof item.gachaEligible !== "boolean") {
      throw new Error(`단품 gachaEligible 오류: ${JSON.stringify(item)}`);
    }
  }
  for (const item of source.sets) {
    if (item.active !== undefined && typeof item.active !== "boolean") {
      throw new Error(`세트 active 오류: ${JSON.stringify(item)}`);
    }
  }
}

function expectedIdentities(source) {
  const sets = source.sets.map(item => ({
    key: `set:${item.slug}`,
    grade: item.grade,
  }));
  const cosmetics = [];
  for (const item of source.sets) {
    const setKey = `set:${item.slug}`;
    for (const slot of SET_SLOTS) {
      cosmetics.push({ key: `${setKey}:${slot}`, grade: item.grade, slot, setKey });
    }
  }
  for (const item of source.singles) {
    cosmetics.push({
      key: `single:${item.slug}:${item.part}`,
      grade: item.grade,
      slot: item.slot,
      setKey: null,
    });
  }
  return { sets, cosmetics };
}

function reconcileRegistry(source, registry, { allowAdditions = true } = {}) {
  validateSource(source);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.sets) || !Array.isArray(registry.cosmetics)) {
    throw new Error("cosmetic-identities.json 형식이 올바르지 않습니다.");
  }
  assertUnique(registry.sets, item => item.key, "레지스트리 세트 키");
  assertUnique(registry.sets, item => item.setId, "레지스트리 세트 ID");
  assertUnique(registry.cosmetics, item => item.key, "레지스트리 치장 키");
  assertUnique(registry.cosmetics, item => item.cosmeticId, "레지스트리 치장 ID");

  const expected = expectedIdentities(source);
  const expectedSetKeys = new Set(expected.sets.map(item => item.key));
  const expectedCosmeticKeys = new Set(expected.cosmetics.map(item => item.key));
  for (const item of registry.sets) {
    if (!expectedSetKeys.has(item.key)) throw new Error(`기존 세트 삭제 금지: ${item.key}`);
  }
  for (const item of registry.cosmetics) {
    if (!expectedCosmeticKeys.has(item.key)) throw new Error(`기존 치장 삭제 금지: ${item.key}`);
  }

  const usedSetIds = new Set(registry.sets.map(item => item.setId));
  const usedCosmeticIds = new Set(registry.cosmetics.map(item => item.cosmeticId));
  const setByKey = new Map(registry.sets.map(item => [item.key, item]));
  const cosmeticByKey = new Map(registry.cosmetics.map(item => [item.key, item]));

  for (const item of expected.sets) {
    const current = setByKey.get(item.key);
    if (current) {
      if (current.grade !== item.grade) {
        throw new Error(`기존 세트 등급 변경 금지: ${item.key} (${current.grade} -> ${item.grade})`);
      }
      continue;
    }
    if (!allowAdditions) throw new Error(`레지스트리에 없는 새 세트: ${item.key}`);
    const added = { ...item, setId: nextId("cosmetic-set-", 2, usedSetIds) };
    registry.sets.push({ key: added.key, setId: added.setId, grade: added.grade });
    setByKey.set(added.key, added);
  }

  for (const item of expected.cosmetics) {
    const current = cosmeticByKey.get(item.key);
    if (current) {
      for (const field of ["grade", "slot", "setKey"]) {
        if (current[field] !== item[field]) {
          throw new Error(`기존 치장 ${field} 변경 금지: ${item.key} (${current[field]} -> ${item[field]})`);
        }
      }
      continue;
    }
    if (!allowAdditions) throw new Error(`레지스트리에 없는 새 치장: ${item.key}`);
    const added = { ...item, cosmeticId: nextId("cosmetic-", 3, usedCosmeticIds) };
    registry.cosmetics.push({
      key: added.key,
      cosmeticId: added.cosmeticId,
      grade: added.grade,
      slot: added.slot,
      setKey: added.setKey,
    });
    cosmeticByKey.set(added.key, added);
  }

  registry.sets.sort((a, b) => numericSuffix(a.setId) - numericSuffix(b.setId));
  registry.cosmetics.sort((a, b) => numericSuffix(a.cosmeticId) - numericSuffix(b.cosmeticId));
  return registry;
}

function build(source = readJson(SOURCE_PATH), registry = readJson(REGISTRY_PATH)) {
  reconcileRegistry(source, registry, { allowAdditions: false });
  const setSourceByKey = new Map(source.sets.map(item => [`set:${item.slug}`, item]));
  const setRegistryByKey = new Map(registry.sets.map(item => [item.key, item]));
  const singleSourceByKey = new Map(source.singles.map(item => [`single:${item.slug}:${item.part}`, item]));
  const cosmetics = registry.cosmetics.map(identity => {
    const setSource = identity.setKey ? setSourceByKey.get(identity.setKey) : null;
    const singleSource = identity.setKey ? null : singleSourceByKey.get(identity.key);
    const result = {
      cosmeticId: identity.cosmeticId,
      displayName: setSource
        ? (setSource.memberDisplayNames?.[identity.slot] ?? `${setSource.name} ${SLOT_DISPLAY_NAMES[identity.slot]}`)
        : (singleSource?.displayName ?? singleSource?.name ?? null),
      imageUrl: setSource?.memberImageUrls?.[identity.slot] ?? singleSource?.imageUrl ?? null,
      grade: identity.grade,
      slot: identity.slot,
      setId: identity.setKey ? setRegistryByKey.get(identity.setKey).setId : null,
    };
    if (singleSource?.gachaEligible === false) result.gachaEligible = false;
    return result;
  });
  const sets = registry.sets.map(identity => {
    const sourceItem = setSourceByKey.get(identity.key);
    const members = {};
    for (const slot of SET_SLOTS) {
      const member = registry.cosmetics.find(item => item.key === `${identity.key}:${slot}`);
      if (!member) throw new Error(`세트 부위 누락: ${identity.key}:${slot}`);
      members[slot] = member.cosmeticId;
    }
    const step = EFFECT_STEP[identity.grade];
    const bannerId = source.legendaryBanners?.[sourceItem.slug] ?? null;
    const result = {
      setId: identity.setId,
      displayName: sourceItem.name,
      grade: identity.grade,
      colors: sourceItem.colors ?? null,
      bannerId,
      boxItemId: bannerId ? "cosmetic-selector-box-01" : null,
      members,
      effects: [1, 2, 3, 4, 5].map(star => ({
        star,
        effects: EFFECT_STATS.map(statId => ({ statId, value: step * star, unit: "BASIS_POINTS" })),
      })),
    };
    if (sourceItem.active === false) result.active = false;
    return result;
  });
  return { cosmetics, sets };
}

function buildArtMap(source = readJson(SOURCE_PATH), registry = readJson(REGISTRY_PATH)) {
  reconcileRegistry(source, registry, { allowAdditions: false });
  const setByKey = new Map(registry.sets.map(item => [item.key, item]));
  const cosmeticByKey = new Map(registry.cosmetics.map(item => [item.key, item]));
  const setSlugs = {};
  const setNames = {};
  const colorSets = {};
  for (const item of source.sets) {
    const identity = setByKey.get(`set:${item.slug}`);
    setSlugs[identity.setId] = item.slug;
    setNames[identity.setId] = item.name;
    if (item.colors) colorSets[identity.setId] = item.colors;
  }
  const looseSlugs = {};
  const looseNames = {};
  for (const item of source.singles) {
    const identity = cosmeticByKey.get(`single:${item.slug}:${item.part}`);
    looseSlugs[identity.cosmeticId] = item.slug;
    looseNames[identity.cosmeticId] = item.name;
  }
  return { setSlugs, setNames, colorSets, looseSlugs, looseNames };
}

function artMapText(source, registry) {
  const { setSlugs, setNames, colorSets, looseSlugs, looseNames } = buildArtMap(source, registry);
  const entries = record => Object.entries(record)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    .join("\n");
  return `// 이 파일은 tools/cosmetics/build-cosmetics-content.cjs가 만든다. 직접 고치지 말 것.
// 안정 키 레지스트리를 사용하므로 새 아이템을 추가해도 기존 ID가 바뀌지 않는다.

/** 세트 번호 -> 아트 폴더 이름. */
export const SET_ART_SLUGS: Record<string, string> = {
${entries(setSlugs)}
};

/** 세트 이름. 서버 displayName이 비었을 때만 사용한다. */
export const SET_ART_NAMES: Record<string, string> = {
${entries(setNames)}
};

/** 색만 다른 세트. 치장 ID에는 접미사를 붙이지 않고 폴더 이름만 컬러-타입이다. */
export const SET_ART_COLORS: Record<string, readonly string[]> = {
${entries(colorSets)}
};

/** 세트에 속하지 않는 치장 ID -> 아트 폴더 이름. */
export const LOOSE_ART_SLUGS: Record<string, string> = {
${entries(looseSlugs)}
};

/** 세트에 속하지 않는 치장의 이름. */
export const LOOSE_ART_NAMES: Record<string, string> = {
${entries(looseNames)}
};
`;
}

function checksum(text) {
  return crypto.createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
}

function updateManifest(contentPath, contentText) {
  const versionDir = path.resolve(path.dirname(contentPath), "..");
  const manifestPath = path.join(versionDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = readJson(manifestPath);
  if (!manifest.checksums || !("cosmetics/cosmetics.json" in manifest.checksums)) return;
  manifest.checksums["cosmetics/cosmetics.json"] = checksum(contentText);
  writeJson(manifestPath, manifest);
}

function writeAllCatalogOutputs({ v1ContentVersion, contentVersion } = {}) {
  const source = readJson(SOURCE_PATH);
  const registry = reconcileRegistry(source, readJson(REGISTRY_PATH));
  writeJson(REGISTRY_PATH, registry);
  const generated = build(source, registry);
  for (const contentPath of CONTENT_PATHS) {
    const previous = readJson(contentPath);
    const content = {
      authority: previous.authority,
      contentVersion: contentPath.includes(`${path.sep}versions${path.sep}v1${path.sep}`)
        ? (contentVersion ?? v1ContentVersion ?? previous.contentVersion)
        : previous.contentVersion,
      singleRiceCost: previous.singleRiceCost,
      gradeProbabilityMillionths: previous.gradeProbabilityMillionths,
      starThresholdsByGrade: previous.starThresholdsByGrade,
      ...generated,
    };
    const serialized = `${JSON.stringify(content, null, 2)}\n`;
    fs.writeFileSync(contentPath, serialized);
    updateManifest(contentPath, serialized);
  }
  fs.writeFileSync(ART_MAP_PATH, artMapText(source, registry));
  return { registry, ...generated };
}

if (require.main === module) {
  const targetPath = process.argv[2];
  if (targetPath) {
    const previous = readJson(targetPath);
    const { cosmetics, sets } = build();
    writeJson(targetPath, {
      authority: previous.authority,
      contentVersion: process.argv[3] ?? previous.contentVersion,
      singleRiceCost: previous.singleRiceCost,
      gradeProbabilityMillionths: previous.gradeProbabilityMillionths,
      starThresholdsByGrade: previous.starThresholdsByGrade,
      cosmetics,
      sets,
    });
    if (process.argv[4]) fs.writeFileSync(process.argv[4], artMapText(readJson(SOURCE_PATH), readJson(REGISTRY_PATH)));
  } else {
    const result = writeAllCatalogOutputs();
    console.log(`치장 ${result.cosmetics.length}개 / 세트 ${result.sets.length}개 생성`);
  }
}

module.exports = {
  ART_MAP_PATH,
  CONTENT_PATHS,
  GRADES,
  REGISTRY_PATH,
  SET_SLOTS,
  SLOTS,
  SOURCE_PATH,
  artMapText,
  build,
  buildArtMap,
  expectedIdentities,
  numericSuffix,
  readJson,
  reconcileRegistry,
  writeAllCatalogOutputs,
  writeJson,
};
