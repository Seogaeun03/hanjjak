import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashDirectory } from "./cosmetic-asset-version";
import { versionedCosmeticAsset } from "../src/features/cosmetics/cosmetic-art";

const dirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cosmetic-version-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cosmetic asset version", () => {
  it("is stable for the same art and changes when any layer changes", async () => {
    const base = { "motion/body/rest_01.png": "body", "motion/sushi/rest_01-hat.png": "hat" };
    const first = await hashDirectory(await fixture(base));

    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(await hashDirectory(await fixture(base))).toBe(first);
    expect(await hashDirectory(await fixture({ ...base, "motion/sushi/rest_01-hat.png": "new hat" }))).not.toBe(first);
    expect(await hashDirectory(await fixture({ ...base, "motion/sushi/rest_02-hat.png": "hat" }))).not.toBe(first);
  });

  it("appends the build version only when one is defined", () => {
    expect(versionedCosmeticAsset("/cosmetics/motion/body/rest_01.png", "abc123")).toBe("/cosmetics/motion/body/rest_01.png?v=abc123");
    expect(versionedCosmeticAsset("/cosmetics/motion/body/rest_01.png", "")).toBe("/cosmetics/motion/body/rest_01.png");
    // 테스트 환경에는 빌드 상수가 없어 기존 경로가 그대로 나온다.
    expect(versionedCosmeticAsset("/cosmetics/hero-default.png")).toBe("/cosmetics/hero-default.png");
  });
});
