import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWeb = createRequire(path.join(repoRoot, "apps", "web", "package.json"));
const sharp = requireFromWeb("sharp");
const sourceRoot = path.join(repoRoot, "apps", "web", "src");
const repositoryPngRoot = path.join(sourceRoot, "shared", "assets", "cozy-hud-v1");
const archivedPngRoot = process.env.HUD_PNG_SOURCE_ROOT
  ? path.resolve(process.env.HUD_PNG_SOURCE_ROOT)
  : path.resolve(repoRoot, "..", "HUD_PNG_ARCHIVE_20260918", "cozy-hud-v1");
const extensions = new Set([".css", ".ts", ".tsx"]);
const assetPattern = /cozy-hud-v1(?:-webp)?\/[A-Za-z0-9_./-]+\.(?:png|webp)/g;
const quality = Math.max(1, Math.min(100, Number(process.env.HUD_WEBP_QUALITY ?? 78)));

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return extensions.has(path.extname(entry.name)) ? [entryPath] : [];
  }));
  return nested.flat();
}

const files = await sourceFiles(sourceRoot);
const references = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const reference of source.match(assetPattern) ?? []) {
    const originalReference = reference
      .replace("cozy-hud-v1-webp/", "cozy-hud-v1/")
      .replace(/\.webp$/i, ".png");
    const relativePngPath = originalReference.replace("cozy-hud-v1/", "").replaceAll("/", path.sep);
    const repositoryAssetPath = path.join(repositoryPngRoot, relativePngPath);
    const archivedAssetPath = path.join(archivedPngRoot, relativePngPath);
    const assetPath = await exists(repositoryAssetPath) ? repositoryAssetPath : archivedAssetPath;
    if (!await exists(assetPath)) throw new Error(`PNG 원본을 찾을 수 없습니다: ${relativePngPath}`);
    const usages = references.get(assetPath) ?? [];
    usages.push(file);
    references.set(assetPath, usages);
  }
}

let pngBytes = 0;
let webpBytes = 0;

for (const [pngPath] of references) {
  const pngSourceRoot = pngPath.startsWith(`${repositoryPngRoot}${path.sep}`)
    ? repositoryPngRoot
    : archivedPngRoot;
  const relativeAssetPath = path.relative(
    pngSourceRoot,
    pngPath,
  );
  const webpPath = path.join(
    sourceRoot,
    "shared",
    "assets",
    "cozy-hud-v1-webp",
    relativeAssetPath.replace(/\.png$/i, ".webp"),
  );
  const pngInfo = await stat(pngPath);
  pngBytes += pngInfo.size;
  await mkdir(path.dirname(webpPath), { recursive: true });
  await sharp(pngPath)
    .webp({ quality, alphaQuality: 100, effort: 6, smartSubsample: false })
    .toFile(webpPath);
  webpBytes += (await stat(webpPath)).size;
}

for (const file of files) {
  const source = await readFile(file, "utf8");
  const updated = source.replace(assetPattern, (reference) => reference
    .replace("cozy-hud-v1/", "cozy-hud-v1-webp/")
    .replace(/\.png$/i, ".webp"));
  if (updated !== source) await writeFile(file, updated);
}

const savedPercent = pngBytes === 0 ? 0 : ((pngBytes - webpBytes) / pngBytes) * 100;
console.log(JSON.stringify({
  converted: references.size,
  quality,
  pngBytes,
  webpBytes,
  savedPercent: Number(savedPercent.toFixed(1)),
}, null, 2));
