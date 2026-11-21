import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const fontFace = readFileSync(new URL("./shared/assets/fonts/geekble-malang2.css", import.meta.url), "utf8");

/** unicode-range 선언을 코드포인트 구간 목록으로 읽는다. */
function declaredRanges(): [number, number][] {
  const declaration = /unicode-range:\s*([^;]+);/.exec(fontFace);
  expect(declaration).not.toBeNull();
  return declaration![1].split(",").map((entry) => {
    const [start, end] = entry.trim().replace(/^U\+/i, "").split("-");
    return [parseInt(start, 16), parseInt(end ?? start, 16)];
  });
}

function covered(codePoint: number): boolean {
  return declaredRanges().some(([start, end]) => codePoint >= start && codePoint <= end);
}

describe("global game font", () => {
  it("loads the shared Geekble Malang2 WOFF2 and exposes it through the UI font variable", () => {
    expect(styles).toContain('@import "./shared/assets/fonts/geekble-malang2.css"');
    expect(fontFace).toContain('font-family: "Geekble Malang2"');
    expect(fontFace).toContain("./GeekbleMalang2WOFF2.woff2");
    expect(styles).toContain('--hanjjak-font-ui: "Geekble Malang2", "Malgun Gothic", sans-serif');
    expect(existsSync(new URL("./shared/assets/fonts/GeekbleMalang2WOFF2.woff2", import.meta.url))).toBe(true);
  });

  /**
   * 폰트는 한글 음절 11,172자를 전부 cmap 에 등록해 두고 외곽선은 상용 2,350자 계열에만
   * 넣어 뒀다. cmap 에 항목이 있으면 브라우저가 대체 글꼴로 넘어가지 않아 빈 글리프가 투명한
   * 공백으로 찍힌다. unicode-range 가 외곽선 있는 글자만 맡아야 나머지가 Malgun Gothic 으로
   * 넘어간다. 목록은 tools/font-unicode-range.py 가 폰트에서 뽑는다.
   */
  it("hands the font only the code points it actually draws", () => {
    expect(covered(0xb54c)).toBe(true); // 때 - 외곽선 있음
    expect(covered(0xb3c4)).toBe(true); // 도
    expect(covered(0xac00)).toBe(true); // 가

    expect(covered(0xb584)).toBe(false); // 떄 - 빈 글리프, 2026-09-17 라이브 제보
    expect(covered(0xb568)).toBe(false); // 땨
    expect(covered(0xb680)).toBe(false); // 뚀
    expect(covered(0xb70c)).toBe(false); // 뜌
    expect(covered(0xcb2c)).toBe(false); // 쬬
    expect(covered(0x2605)).toBe(false); // ★ - 채팅 허용 기호지만 빈 글리프
  });

  it("makes native form controls inherit the same font", () => {
    expect(styles).toContain("button, input, select, textarea { font: inherit; }");
    expect(styles).toContain('button[aria-label*="닫기"]');
  });
});
