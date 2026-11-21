import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BATTLE_BACKGROUND_HINT_KEY,
  isBattleBackgroundHint,
  readBattleBackgroundHint,
  rememberBattleBackground,
  resolveBattleBackground,
} from "./battleBackgroundHint";
import { backgroundAsset } from "./battleVisuals";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(value); values.set(key, value); },
  };
}

describe("battle background hint", () => {
  it("accepts only same-origin asset image paths", () => {
    expect(isBattleBackgroundHint("/assets/chapters/chapter-04-sushi/backgrounds/morning.webp")).toBe(true);
    expect(isBattleBackgroundHint("/assets/chapters/chapter-01-fruit/backgrounds/melon-glasshouse.png")).toBe(true);
    expect(isBattleBackgroundHint("https://evil.example/a.webp")).toBe(false);
    expect(isBattleBackgroundHint("//evil.example/assets/a.webp")).toBe(false);
    expect(isBattleBackgroundHint("/assets/../api/v1/a.webp")).toBe(false);
    expect(isBattleBackgroundHint("/assets/a.webp\"><script>")).toBe(false);
    expect(isBattleBackgroundHint("/api/v1/stages")).toBe(false);
    expect(isBattleBackgroundHint(null)).toBe(false);
  });

  it("remembers a background once and reads it back", () => {
    const storage = memoryStorage();
    const url = "/assets/chapters/chapter-04-sushi/backgrounds/morning.webp";

    rememberBattleBackground(storage, url);
    rememberBattleBackground(storage, url);
    rememberBattleBackground(storage, "https://evil.example/a.webp");

    expect(storage.writes).toEqual([url]);
    expect(readBattleBackgroundHint(storage)).toBe(url);
  });

  it("ignores tampered values and storage failures", () => {
    expect(readBattleBackgroundHint(memoryStorage({ [BATTLE_BACKGROUND_HINT_KEY]: "javascript:alert(1)" }))).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readBattleBackgroundHint(throwing)).toBeNull();
    expect(() => rememberBattleBackground(throwing, "/assets/a.webp")).not.toThrow();
    expect(readBattleBackgroundHint(null)).toBeNull();
  });

  it("does not fall back to the chapter one background before runtime restore", () => {
    const hint = "/assets/chapters/chapter-04-sushi/backgrounds/morning.webp";

    expect(resolveBattleBackground(false, null, undefined, "stage.01-01")).toBeNull();
    expect(resolveBattleBackground(false, hint, undefined, "stage.01-01")).toBe(hint);
    expect(resolveBattleBackground(true, hint, undefined, "stage.01-01")).toBe(backgroundAsset(undefined, "stage.01-01"));
  });

  it("keeps the index.html preload script in sync with the hint key and pattern", () => {
    const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");

    expect(html).toContain(`localStorage.getItem("${BATTLE_BACKGROUND_HINT_KEY}")`);
    expect(html).toContain(String.raw`/^\/assets\/[A-Za-z0-9\/_.-]+\.(?:webp|png|jpe?g)$/`);
    expect(html).toContain(`hint.indexOf("..") < 0`);
    expect(html).toContain(`setAttribute("fetchpriority", "high")`);
    // 빌드의 webp 변환이 .png 문자열을 일괄 치환하므로 스크립트에 그 문자열이 없어야 패턴이 유지된다.
    expect(html.slice(html.indexOf("<script>"), html.indexOf("</script>"))).not.toContain(".png");
  });
});
