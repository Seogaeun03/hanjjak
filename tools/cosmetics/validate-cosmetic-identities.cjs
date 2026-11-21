const { execFileSync } = require("child_process");
const { readFileSync } = require("fs");
const path = require("path");
const {
  ART_MAP_PATH,
  CONTENT_PATHS,
  REGISTRY_PATH,
  SOURCE_PATH,
  artMapText,
  build,
  readJson,
  reconcileRegistry,
} = require("./build-cosmetics-content.cjs");

const ROOT = path.resolve(__dirname, "../..");
const REGISTRY_REPO_PATH = "packages/game-content/catalogs/cosmetic-identities.json";

function maxId(items, field) {
  return items.reduce((max, item) => Math.max(max, Number(item[field].match(/(\d+)$/)?.[1] ?? 0)), 0);
}

function assertAppendOnly(base, current) {
  for (const [list, idField] of [["sets", "setId"], ["cosmetics", "cosmeticId"]]) {
    const currentByKey = new Map(current[list].map(item => [item.key, item]));
    const baseMax = maxId(base[list], idField);
    const baseKeys = new Set(base[list].map(item => item.key));
    for (const previous of base[list]) {
      const next = currentByKey.get(previous.key);
      if (!next) throw new Error(`기존 ${list} 삭제 금지: ${previous.key}`);
      const immutableFields = list === "sets" ? ["key", "setId", "grade"] : ["key", "cosmeticId", "grade", "slot", "setKey"];
      if (immutableFields.some(field => next[field] !== previous[field])) {
        throw new Error(`기존 ${list} ID/등급/부위 변경 금지: ${previous.key}`);
      }
    }
    for (const added of current[list].filter(item => !baseKeys.has(item.key))) {
      const id = maxId([added], idField);
      if (id <= baseMax) throw new Error(`새 ${list} ID는 기존 최댓값보다 커야 함: ${added[idField]}`);
    }
  }
}

function readBaseRegistry(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`기준 git ref 확인 실패: ${ref}`);
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${REGISTRY_REPO_PATH}`], { cwd: ROOT, stdio: "ignore" });
  } catch {
    return null;
  }
  const text = execFileSync("git", ["show", `${ref}:${REGISTRY_REPO_PATH}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(text);
}

function resolveBaseRef(argv, env = process.env) {
  const index = argv.indexOf("--base");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  if (env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA) return env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA;
  if (env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME) return `origin/${env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME}`;
  const onDefaultBranch = env.CI_COMMIT_BRANCH && env.CI_COMMIT_BRANCH === env.CI_DEFAULT_BRANCH;
  const beforeSha = env.CI_COMMIT_BEFORE_SHA;
  if (onDefaultBranch && beforeSha && !/^0+$/.test(beforeSha)) return beforeSha;
  if (onDefaultBranch) return "HEAD^";
  return `origin/${env.CI_DEFAULT_BRANCH || "main"}`;
}

function main(argv = process.argv.slice(2)) {
  const source = readJson(SOURCE_PATH);
  const current = readJson(REGISTRY_PATH);
  reconcileRegistry(source, structuredClone(current), { allowAdditions: false });
  const generated = build(source, structuredClone(current));
  for (const contentPath of CONTENT_PATHS) {
    const content = readJson(contentPath);
    if (JSON.stringify(content.cosmetics) !== JSON.stringify(generated.cosmetics) || JSON.stringify(content.sets) !== JSON.stringify(generated.sets)) {
      throw new Error(`생성 원본과 콘텐츠 불일치: ${path.relative(ROOT, contentPath)}`);
    }
  }
  const expectedArtMap = artMapText(source, current).replaceAll("\r\n", "\n");
  const actualArtMap = readFileSync(ART_MAP_PATH, "utf8").replaceAll("\r\n", "\n");
  if (actualArtMap !== expectedArtMap) throw new Error(`생성 원본과 아트 매핑 불일치: ${path.relative(ROOT, ART_MAP_PATH)}`);
  const baseRef = resolveBaseRef(argv);
  const base = readBaseRegistry(baseRef);
  if (base) assertAppendOnly(base, current);
  console.log(`치장 ID 검증 완료: ${current.cosmetics.length}개 / 세트 ${current.sets.length}개${base ? ` / 기준 ${baseRef}` : " / 최초 레지스트리"}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { assertAppendOnly, main, resolveBaseRef };
