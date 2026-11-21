// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("RankingScreen layout regressions", () => {
  it("anchors podium characters to the podium artwork and renders equipped appearance layers", () => {
    const component = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.css"), "utf8");
    expect(component).toContain("ranking-podium-platform");
    // 색만 돌린 빈 칸이 아니라 치장 탭과 같은 레이어 조합을 쓴다.
    expect(component).toContain("cosmeticEquipmentFromAppearance(entry.appearance)");
    expect(component).toContain('className="ranking-character-layers"');
    expect(component).not.toContain("ranking-cosmetic-layer");
    // 전투용 자동 높이가 순위별 확대와 중복되지 않도록 랭킹은 기존 고정 프레임을 유지한다.
    expect(css).toMatch(/\.ranking-character-wrap \.ranking-character-layers > img\s*\{[^}]*align-self:\s*auto;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;[^}]*object-position:\s*50% 100%;/s);
    expect(css).toContain("aspect-ratio: 1760 / 912");
    expect(css).toContain(".ranking-podium-rank.rank-1 { z-index: 4; left: 50%; bottom: 59%");
    expect(css).toContain(".rank-1 .ranking-character-wrap { transform: translateX(9%) scale(1.98)");
  });

  it("uses only the panel artwork separators and keeps the current-user highlight inside its row", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.css"), "utf8");
    const rowRule = css.match(/\.ranking-list li \{[^}]+\}/)?.[0] ?? "";
    const mineRule = css.match(/\.ranking-list li\.is-mine \{[^}]+\}/)?.[0] ?? "";
    expect(rowRule).not.toContain("border-bottom");
    // 내 줄도 다른 줄과 같은 자리에 선다. 색으로만 구분한다.
    expect(mineRule).toContain("margin: 0");
    expect(mineRule).toContain("background:");
    expect(mineRule).not.toContain("margin-inline: -");
  });

  it("scrolls the list inside the panel without showing a scrollbar over the artwork", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.css"), "utf8");
    const listRule = css.match(/\.ranking-list \{[^}]+\}/)?.[0] ?? "";
    // 판 크기는 그대로 두고 열 칸만 보인다. 나머지는 안에서 굴러간다.
    expect(listRule).toContain("grid-auto-rows: 10%");
    expect(listRule).toContain("overflow-y: auto");
    expect(listRule).not.toContain("grid-template-rows");
    // 막대가 나무판 그림을 가리면 안 된다.
    expect(listRule).toContain("scrollbar-width: none");
    expect(css).toContain(".ranking-list::-webkit-scrollbar { width: 0; height: 0; }");
    // 줄이 늘 괘선 위에 서도록 칸 단위로 멈춘다.
    expect(listRule).toContain("scroll-snap-type: y mandatory");
    expect(css.match(/\.ranking-list li \{[^}]+\}/)?.[0] ?? "").toContain("scroll-snap-align: start");
  });

  it("places the current player in the artwork footer and keeps narrow tabs inside the frame", () => {
    const component = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.css"), "utf8");
    expect(component).not.toContain("<em>나</em>");
    expect(component).toContain('<span className="ranking-row-rank"><span>{myRank}</span></span>');
    expect(css).toContain(".ranking-my-position { position: absolute;");
    expect(css).toContain("width: calc(100% - 24px)");
  });
});
