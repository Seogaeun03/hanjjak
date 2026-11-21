const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  ART_MAP_PATH,
  GRADES,
  CONTENT_PATHS,
  REGISTRY_PATH,
  SLOTS,
  SOURCE_PATH,
  readJson,
  reconcileRegistry,
  writeAllCatalogOutputs,
  writeJson,
} = require("./build-cosmetics-content.cjs");
const { resolveBaseRef } = require("./validate-cosmetic-identities.cjs");

const ROOT = path.resolve(__dirname, "../..");

function usage() {
  return [
    "사용법:",
    "  pnpm cosmetics:add -- set --slug <영문-slug> --name <이름> --grade <NORMAL|RARE|EPIC|LEGENDARY> --content-version <새 버전>",
    "  pnpm cosmetics:add -- single --slug <영문-slug> --part <영문-part> --name <이름> --grade <등급> --slot <부위> --content-version <새 버전>",
    `  단품 부위: ${SLOTS.join("|")}`,
  ].join("\n");
}

function parseArgs(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [kind, ...rest] = normalized;
  if (!["set", "single"].includes(kind)) throw new Error(usage());
  const values = { kind };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(usage());
    values[flag.slice(2)] = value;
  }
  return values;
}

function requireValue(values, key) {
  if (!values[key]) throw new Error(`--${key} 필수\n${usage()}`);
  return values[key];
}

function validateSlug(value, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label}은 소문자 영문/숫자/하이픈만 허용: ${value}`);
  }
}

function addToSource(source, values) {
  const slug = requireValue(values, "slug");
  const name = requireValue(values, "name");
  const grade = requireValue(values, "grade");
  validateSlug(slug, "slug");
  if (!GRADES.includes(grade)) throw new Error(`잘못된 grade: ${grade}`);

  if (values.kind === "set") {
    if (source.sets.some(item => item.slug === slug)) throw new Error(`이미 존재하는 세트 slug: ${slug}`);
    source.sets.push({ slug, name, grade, active: false });
    return `set:${slug}`;
  }

  const part = requireValue(values, "part");
  const slot = requireValue(values, "slot");
  validateSlug(part, "part");
  if (!SLOTS.includes(slot)) throw new Error(`잘못된 slot: ${slot}`);
  if (grade === "LEGENDARY") throw new Error("전설 단품은 공용 뽑기에서 획득할 수 없어 추가할 수 없습니다. 전설 세트로 추가하세요.");
  if (source.singles.some(item => item.slug === slug && item.part === part)) {
    throw new Error(`이미 존재하는 단품 키: single:${slug}:${part}`);
  }
  if (source.singles.some(item => item.slug === slug && item.slot === slot)) {
    throw new Error(`같은 아트 경로를 쓰는 단품이 이미 존재: ${slug}/${slot}`);
  }
  source.singles.push({ slug, part, name, displayName: name, grade, slot });
  return `single:${slug}:${part}`;
}

function readBaseContentVersion(ref) {
  const repoPath = "packages/game-content/versions/v1/cosmetics/cosmetics.json";
  const text = execFileSync("git", ["show", `${ref}:${repoPath}`], { cwd: ROOT, encoding: "utf8" });
  return JSON.parse(text).contentVersion;
}

function withFileRollback(filePaths, action) {
  const originals = new Map(filePaths.map(filePath => [filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath) : null]));
  try {
    return action();
  } catch (error) {
    for (const [filePath, content] of originals) {
      if (content === null) fs.rmSync(filePath, { force: true });
      else fs.writeFileSync(filePath, content);
    }
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const values = parseArgs(argv);
  const contentVersion = requireValue(values, "content-version");
  const baseRef = resolveBaseRef([]);
  const baseVersion = readBaseContentVersion(baseRef);
  if (contentVersion === baseVersion) throw new Error(`기준 브랜치와 다른 content-version 필요: 현재 ${baseVersion}`);
  const source = readJson(SOURCE_PATH);
  const registry = readJson(REGISTRY_PATH);
  const key = addToSource(source, values);
  reconcileRegistry(source, registry);
  const manifestPaths = CONTENT_PATHS.map(contentPath => path.resolve(path.dirname(contentPath), "../manifest.json"));
  const result = withFileRollback([SOURCE_PATH, REGISTRY_PATH, ...CONTENT_PATHS, ...manifestPaths, ART_MAP_PATH], () => {
    writeJson(SOURCE_PATH, source);
    writeJson(REGISTRY_PATH, registry);
    const generated = writeAllCatalogOutputs({ v1ContentVersion: contentVersion });
    if (process.platform === "win32") {
      execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "corepack pnpm content:validate"], { cwd: ROOT, stdio: "inherit" });
    } else {
      execFileSync("corepack", ["pnpm", "content:validate"], { cwd: ROOT, stdio: "inherit" });
    }
    return generated;
  });
  const identity = values.kind === "set"
    ? result.registry.sets.find(item => item.key === key)
    : result.registry.cosmetics.find(item => item.key === key);
  const state = values.kind === "set" ? " / 비활성 준비 상태" : "";
  console.log(`추가 완료: ${key} -> ${identity.setId ?? identity.cosmeticId} (${values.grade})${state}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { addToSource, main, parseArgs, withFileRollback };
