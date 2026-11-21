// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("RankingScreen current player footer", () => {
  it("always renders the signed-in player's full ranking summary in the panel footer", () => {
    const component = readFileSync(resolve(process.cwd(), "src/features/ranking/RankingScreen.tsx"), "utf8");
    expect(component).toContain("{myEntry && <div className=\"ranking-my-position\"");
    expect(component).toContain("LV. {myEntry.level.toLocaleString()} · {myEntry.displayName}");
    // 내 줄도 목록과 같은 값 칸을 쓴다. 전투력이든 스테이지든 고른 기준이 그대로 따라온다.
    expect(component).toContain("<RankingRowValue entry={myEntry} metric={metric} />");
    expect(component).not.toContain("myEntry && !includesMe");
  });
});
