import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

// `public/cosmetics` 는 해시 없는 파일명으로 복사되고, 부위별 레이어를 겹쳐 한 캐릭터를 그린다.
// nginx 가 짧게라도 캐시하면 배포 직후 옛 레이어와 새 레이어가 섞여 그림이 어긋날 수 있다.
// 폴더 내용의 해시를 빌드 상수로 넣어 주소에 `?v=` 로 붙이면, 그림이 바뀐 배포에서만 주소가 바뀐다.
//
// 개발 서버와 테스트에서는 상수를 넣지 않는다. 주소가 원래 경로 그대로 남는다.

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }));
  return nested.flat();
}

export async function hashDirectory(dir: string): Promise<string> {
  const files = (await walk(dir)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(dir, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

export function cosmeticAssetVersion(): Plugin {
  return {
    name: "hanjjak:cosmetic-asset-version",
    apply: "build",
    async config(config) {
      const root = config.root ?? process.cwd();
      const version = await hashDirectory(join(root, "public", "cosmetics"));
      return { define: { __COSMETIC_ASSET_VERSION__: JSON.stringify(version) } };
    },
  };
}
