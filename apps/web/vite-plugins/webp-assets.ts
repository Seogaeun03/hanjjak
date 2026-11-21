import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import sharp from "sharp";
import type { Plugin } from "vite";

// 저장소에는 PNG 원본만 두고 빌드 산출물에서만 WebP 로 바꾼다. `pnpm dev` 는 원본을
// 그대로 쓰므로 개발 반복과 디자인 작업에는 영향이 없다.

type Tier = { readonly name: string; readonly test: RegExp; readonly quality: number };

// 용도별 품질. 표본 14개 실측이 근거다.
//
// - 불투명한 대형 배경·키아트는 q75 가 q82 보다 18~25% 더 작으면서 육안 차이가 없다.
// - 알파 비중이 큰 스프라이트 시트·이펙트·아틀라스·UI 는 알파 채널이 품질값과 무관하게
//   무손실로 저장돼, q75 로 내려도 7~15% 밖에 못 줄이면서 RGB 경계만 더 뭉갠다.
//   `image-rendering: pixelated` 가 그 열화를 확대하므로 q82 에서 멈춘다.
//
// 품질을 조정할 일이 생기면 이 표만 고치면 된다.
const TIERS: readonly Tier[] = [
  { name: "background", test: /(^|\/)backgrounds\/|keyart|-background(-|\.)/, quality: 75 },
  { name: "sprite", test: /sprite-sheet|(^|\/)(hero|atlases|motion|effects)\//, quality: 82 },
];

const FALLBACK_TIER: Tier = { name: "ui", test: /^/, quality: 82 };

// libwebp 탐색 강도. 6은 4보다 10배 느리면서 결과는 3.9% 작을 뿐이고, 그 손해가 알파를 쓰는
// 스프라이트에 몰린다(장당 0.8초 -> 7.5초). 콜드 빌드 시간을 그만큼 쓸 값이 아니다.
const EFFORT = 4;

// 자산 경로를 담고 있어 확장자를 같이 바꿔야 하는 산출물. `.json` 은 런타임이 받아 가는
// 장비 아틀라스 매니페스트가 이미지 파일명을 들고 있어서 포함한다.
const REWRITABLE = new Set([".js", ".css", ".html", ".json"]);

// 인코딩 결과 캐시. 내용 해시로 키를 잡으므로 바뀌지 않은 이미지는 다시 굽지 않는다.
// 컨테이너 빌드는 BuildKit cache mount 를 이 경로에 붙여 커밋 간에 캐시를 이어 간다.
const CACHE_DIR = process.env.WEBP_CACHE_DIR ?? join("node_modules", ".cache", "hanjjak-webp");

function isRewritable(file: string): boolean {
  const dot = file.lastIndexOf(".");
  return dot > 0 && REWRITABLE.has(file.slice(dot));
}

type Converted = { readonly tier: string; readonly before: number; readonly after: number };

export function webpAssets(): Plugin {
  // dist 산출물 이름 -> 원본 소스 경로. src 에서 import 한 자산은 dist 에서 해시 이름으로
  // 평탄화돼 디렉터리가 사라지므로, 용도 판정에 쓸 원본 경로를 여기서 붙잡아 둔다.
  const origins = new Map<string, string>();
  let root = process.cwd();
  let outDir = "dist";
  let building = false;

  return {
    name: "hanjjak:webp-assets",
    // Development serves gallery WebP from originals; closeBundle remains build-only.
    enforce: "post",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!/^\/(cosmetics\/motion\/|assets\/characters\/(angel|yakgwa)\/runtime-equipment-v1\/motion-sheets\/).+\.webp$/.test(pathname)) return next();
        try {
          const decoded = decodeURIComponent(pathname);
          if (decoded.split("/").some((part) => part === ".." || part.includes("\\"))) return next();
          const source = await readFile(join(server.config.publicDir, decoded.replace(/\.webp$/, ".png")));
          await mkdir(isAbsolute(CACHE_DIR) ? CACHE_DIR : join(server.config.root, CACHE_DIR), { recursive: true });
          const encoded = await fromCacheOrEncode(isAbsolute(CACHE_DIR) ? CACHE_DIR : join(server.config.root, CACHE_DIR), source, 82);
          res.setHeader("Content-Type", "image/webp");
          res.end(encoded);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return next();
          next(error as Error);
        }
      });
    },

    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
      building = config.command === "build";
    },

    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "asset" && output.originalFileName) {
          origins.set(normalize(output.fileName), normalize(output.originalFileName));
        }
      }
    },

    async closeBundle() {
      if (!building) return;
      const distDir = join(root, outDir);
      const cacheDir = isAbsolute(CACHE_DIR) ? CACHE_DIR : join(root, CACHE_DIR);
      const files = await walk(distDir);
      const pngs = files.filter((file) => file.endsWith(".png"));
      if (pngs.length === 0) return;

      await mkdir(cacheDir, { recursive: true });
      // sharp 는 자체 스레드풀을 쓴다. 여기서 병렬로 돌릴 것이므로 내부 병렬은 1로 낮춰
      // 코어를 과다 점유하지 않게 한다.
      sharp.concurrency(1);

      const results = new Map<string, Converted>();
      const started = Date.now();

      await inParallel(pngs, availableParallelism(), async (file) => {
        const tier = tierFor(origins.get(file) ?? file);
        const source = await readFile(join(distDir, file));
        const encoded = await fromCacheOrEncode(cacheDir, source, tier.quality);

        await writeFile(join(distDir, file.replace(/\.png$/, ".webp")), encoded);
        await rm(join(distDir, file));
        results.set(file, { tier: tier.name, before: source.byteLength, after: encoded.byteLength });
      });

      const rewritten = await rewriteReferences(distDir, files);
      await verify(distDir);

      report(results, rewritten, Date.now() - started);
    },
  };
}

function normalize(path: string): string {
  return path.split(sep).join("/");
}

function tierFor(path: string): Tier {
  return TIERS.find((tier) => tier.test.test(path)) ?? FALLBACK_TIER;
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(normalize(relative(base, full)));
  }
  return files;
}

async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      await work(items[cursor++]);
    }
  });
  await Promise.all(runners);
}

async function fromCacheOrEncode(cacheDir: string, source: Buffer, quality: number): Promise<Buffer> {
  // 인코딩 설정이 바뀌면 캐시도 무효가 돼야 하므로 키에 같이 넣는다.
  const key = createHash("sha256").update(`${quality}\0${EFFORT}\0`).update(source).digest("hex");
  const cached = join(cacheDir, `${key}.webp`);
  try {
    return await readFile(cached);
  } catch {
    const encoded = await encode(source, quality);
    await writeFile(cached, encoded);
    return encoded;
  }
}

async function encode(source: Buffer, quality: number): Promise<Buffer> {
  // alphaQuality 100 — 알파 경계가 뭉개지면 픽셀아트에서 바로 티가 난다.
  const lossy = await sharp(source).webp({ quality, alphaQuality: 100, effort: EFFORT }).toBuffer();
  if (lossy.byteLength < source.byteLength) return lossy;

  // 작고 단순한 아이콘은 손실 압축이 원본보다 커지기도 한다. 그때만 무손실을 추가로 재본다.
  const lossless = await sharp(source).webp({ lossless: true, effort: EFFORT }).toBuffer();
  return lossless.byteLength < lossy.byteLength ? lossless : lossy;
}

async function rewriteReferences(distDir: string, files: readonly string[]): Promise<number> {
  let count = 0;
  const targets = files.filter(isRewritable);

  await inParallel(targets, availableParallelism(), async (file) => {
    const full = join(distDir, file);
    const text = await readFile(full, "utf8");
    if (!text.includes(".png")) return;
    await writeFile(full, text.replaceAll(".png", ".webp"));
    count += 1;
  });

  return count;
}

async function verify(distDir: string): Promise<void> {
  const files = await walk(distDir);

  const leftovers = files.filter((file) => file.endsWith(".png"));
  if (leftovers.length > 0) {
    throw new Error(`webp-assets: 변환되지 않은 PNG 가 남았다 — ${leftovers.slice(0, 5).join(", ")}`);
  }

  // 확장자만 바꾼 참조가 실제 파일과 어긋나면 런타임 404 로만 드러난다. 여기서 끊는다.
  const present = new Set(files);
  const dangling: string[] = [];
  for (const file of files) {
    if (!isRewritable(file)) continue;
    const text = await readFile(join(distDir, file), "utf8");
    if (text.includes(".png")) {
      throw new Error(`webp-assets: ${file} 에 .png 참조가 남았다`);
    }
    // base 기준 절대 경로만 본다. 상대 경로나 해시 이름 단독은 기준 디렉터리를 알 수 없다.
    for (const reference of text.matchAll(/["'`(](\/[^"'`()\s]+\.webp)/g)) {
      const target = reference[1].slice(1);
      if (!target.includes("${") && !present.has(target)) dangling.push(`${file} -> ${reference[1]}`);
    }
  }

  if (dangling.length > 0) {
    throw new Error(`webp-assets: 없는 파일을 가리키는 참조 ${dangling.length}건 — ${dangling.slice(0, 5).join(", ")}`);
  }
}

function report(results: ReadonlyMap<string, Converted>, rewritten: number, elapsed: number): void {
  const tiers = new Map<string, { count: number; before: number; after: number }>();
  for (const { tier, before, after } of results.values()) {
    const bucket = tiers.get(tier) ?? { count: 0, before: 0, after: 0 };
    bucket.count += 1;
    bucket.before += before;
    bucket.after += after;
    tiers.set(tier, bucket);
  }

  const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
  const cut = (before: number, after: number) => `-${Math.round((1 - after / before) * 100)}%`;

  console.log(`\nwebp-assets: PNG ${results.size}개 변환, 참조 ${rewritten}개 파일 갱신, ${(elapsed / 1000).toFixed(1)}초`);
  for (const [name, { count, before, after }] of [...tiers].sort((a, b) => b[1].before - a[1].before)) {
    const quality = name === FALLBACK_TIER.name ? FALLBACK_TIER.quality : TIERS.find((tier) => tier.name === name)?.quality;
    console.log(`  ${name.padEnd(11)} q${quality}  ${String(count).padStart(5)}개  ${mb(before).padStart(9)} -> ${mb(after).padStart(9)}  ${cut(before, after)}`);
  }

  const before = [...results.values()].reduce((sum, item) => sum + item.before, 0);
  const after = [...results.values()].reduce((sum, item) => sum + item.after, 0);
  console.log(`  ${"합계".padEnd(15)} ${String(results.size).padStart(5)}개  ${mb(before).padStart(9)} -> ${mb(after).padStart(9)}  ${cut(before, after)}\n`);
}
