// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RankingScreen } from "./RankingScreen";
import type { MaterialType, RankingEntry } from "./api";

const emptyAppearance = { head: null, face: null, top: null, bottom: null, gloves: null, shoes: null, cape: null, color: null };
type StageFacts = { stageOverallRank: number; stageRank: number; highestClearedStageId: string | null };
const entry = (overallRank: number, rank: number, nickname: string, materialType: MaterialType, combatPower: number, level: number, stage?: StageFacts): RankingEntry => ({
  rank,
  overallRank,
  stageOverallRank: stage?.stageOverallRank ?? overallRank,
  stageRank: stage?.stageRank ?? rank,
  nickname,
  level,
  materialType,
  displayName: materialType === "POTATO" ? "감자 전문" : materialType === "SWEET_POTATO" ? "고구마 전문" : "옥수수 전문",
  combatPower,
  highestClearedStageId: stage === undefined ? "stage.01-01" : stage.highestClearedStageId,
  highestClearedAt: "2026-09-09T00:00:00Z",
  appearance: emptyAppearance,
  updatedAt: "2026-09-09T00:00:00Z",
});

/* 전투력 순서와 스테이지 순서를 일부러 어긋나게 둔다. 버튼이 실제로 줄을 다시 세우는지 본다. */
const overall = [
  entry(1, 1, "고구마장군", "SWEET_POTATO", 150_000, 42, { stageOverallRank: 4, stageRank: 1, highestClearedStageId: null }),
  entry(2, 1, "감자왕", "POTATO", 123_456, 35, { stageOverallRank: 2, stageRank: 1, highestClearedStageId: "stage.02-07" }),
  entry(3, 1, "옥수수대장", "CORN", 110_000, 31, { stageOverallRank: 3, stageRank: 2, highestClearedStageId: "stage.01-09" }),
  entry(10, 9, "옥수수맨", "CORN", 90_000, 26, { stageOverallRank: 1, stageRank: 1, highestClearedStageId: "stage.03-04" }),
];

/* 열 줄 넘게 채워 스크롤 목록이 어디서도 잘리지 않는지 본다. */
const crowd = Array.from({ length: 18 }, (unused, index) => entry(index + 1, index + 1, `랭커${index + 1}`, "POTATO", 200_000 - index * 1_000, 40 - index));

const rankingFixture = {
  formulaVersion: "combat-power-v1",
  generatedAt: "2026-09-09T00:00:00Z",
  sourceStateVersion: 4,
  overallTop: overall,
  specializations: [
    { materialType: "POTATO" as const, displayName: "감자 전문", entries: [overall[1], entry(8, 2, "감자둘", "POTATO", 95_000, 27), entry(11, 3, "감자셋", "POTATO", 88_000, 24)] },
    { materialType: "SWEET_POTATO" as const, displayName: "고구마 전문", entries: [overall[0]] },
    { materialType: "CORN" as const, displayName: "옥수수 전문", entries: [overall[2], overall[3]] },
  ],
  myEntry: overall[3],
};

vi.mock("../auth/api", () => ({ authApi: { session: () => Promise.resolve({ authenticated: true, account: { nickname: "옥수수맨" } }) } }));
vi.mock("./api", () => ({ rankingApi: { combatPower: () => Promise.resolve(rankingFixture) } }));

afterEach(cleanup);

function renderRanking() {
  const client = new QueryClient();
  client.setQueryData(["auth", "session"], { authenticated: true, account: { nickname: "옥수수맨" } });
  client.setQueryData(["combat-power-ranking"], rankingFixture);
  return render(<QueryClientProvider client={client}><RankingScreen /></QueryClientProvider>);
}

describe("RankingScreen", () => {
  it("renders the trophy tabs, a 2-1-3 podium and the ranking board without row thumbnails", () => {
    const view = renderRanking();
    expect(screen.getByRole("tab", { name: "전체" }).getAttribute("aria-selected")).toBe("true");
    const podium = screen.getByLabelText("전체 랭킹 1위부터 3위");
    const podiumArticles = within(podium).getAllByRole("article");
    expect(podiumArticles.map((article) => article.getAttribute("aria-label"))).toEqual(["2위 감자왕", "1위 고구마장군", "3위 옥수수대장"]);
    expect(podium.querySelectorAll(".ranking-place-badge img")).toHaveLength(3);
    // 기본 아트는 판 번호가 붙은 주소로 불러야 예전 노란 막대기가 캐시에서 나오지 않는다.
    expect(within(podium).getByAltText("고구마장군의 젓가락 캐릭터 rest 자세").getAttribute("src"))
      .toBe("/assets/chapters/chapter-04-sushi/hero/rest_01.png?v=basic-wooden-sword-v1-20260911");
    expect(screen.getByRole("heading", { name: "전체 랭킹" })).toBeTruthy();
    expect(view.container.textContent).not.toContain("전투력 기준");
    expect(screen.getByText("150,000")).toBeTruthy();
    const list = view.container.querySelector<HTMLElement>(".ranking-list");
    expect(list).not.toBeNull();
    expect(within(list!).getAllByText("전투력")).toHaveLength(overall.length);
    expect(list!.querySelectorAll(".ranking-row-rank img")).toHaveLength(3);
    expect(view.container.textContent).not.toContain("종합 전투력은 이렇게 계산됩니다");
  });

  it("switches both the podium and list to the selected material ranking", () => {
    renderRanking();
    fireEvent.click(screen.getByRole("tab", { name: "감자" }));
    expect(screen.getByRole("tab", { name: "감자" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("감자 랭킹 1위부터 3위")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "감자 랭킹" })).toBeTruthy();
    expect(screen.getAllByText("감자둘")).toHaveLength(2);
    expect(screen.queryByText("고구마장군")).toBeNull();
  });

  it("reorders the whole board by cleared stage when the stage button is pressed", () => {
    const view = renderRanking();
    const stageButton = screen.getByRole("button", { name: "스테이지" });
    expect(screen.getByRole("button", { name: "전투력" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(stageButton);

    expect(stageButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "전투력" }).getAttribute("aria-pressed")).toBe("false");
    const list = view.container.querySelector<HTMLElement>(".ranking-list")!;
    // 가장 멀리 간 사람이 1위다. 전투력으로는 꼴찌였던 옥수수맨이 올라온다.
    expect([...list.querySelectorAll(".ranking-row-player strong")].map((name) => name.textContent))
      .toEqual(["옥수수맨", "감자왕", "옥수수대장", "고구마장군"]);
    expect(within(list).getAllByText("스테이지")).toHaveLength(overall.length);
    expect(within(list).queryAllByText("전투력")).toHaveLength(0);
    expect(within(list).getByText("3-4")).toBeTruthy();
    expect(within(list).getByText("2-7")).toBeTruthy();
    // 한 판도 못 깬 사람은 맨 아래에 선다.
    expect(within(list).getByText("기록 없음")).toBeTruthy();
    expect(within(screen.getByLabelText("전체 랭킹 1위부터 3위")).getAllByRole("article").map((article) => article.getAttribute("aria-label")))
      .toEqual(["2위 감자왕", "1위 옥수수맨", "3위 옥수수대장"]);
  });

  it("keeps the material filter while ranking by stage", () => {
    const view = renderRanking();
    fireEvent.click(screen.getByRole("tab", { name: "옥수수" }));
    fireEvent.click(screen.getByRole("button", { name: "스테이지" }));

    const list = view.container.querySelector<HTMLElement>(".ranking-list")!;
    expect([...list.querySelectorAll(".ranking-row-player strong")].map((name) => name.textContent))
      .toEqual(["옥수수맨", "옥수수대장"]);
    expect(screen.queryByText("감자왕")).toBeNull();
  });

  it("shows my own row with the stage value once the stage button is pressed", () => {
    const view = renderRanking();
    fireEvent.click(screen.getByRole("button", { name: "스테이지" }));

    const mine = view.container.querySelector<HTMLElement>(".ranking-my-position")!;
    expect(mine.getAttribute("aria-label")).toBe("내 순위 1위");
    expect(within(mine).getByText("스테이지")).toBeTruthy();
    expect(within(mine).getByText("3-4")).toBeTruthy();
  });

  it("renders every ranked player instead of stopping at ten", () => {
    const client = new QueryClient();
    client.setQueryData(["auth", "session"], { authenticated: true, account: { nickname: "옥수수맨" } });
    client.setQueryData(["combat-power-ranking"], { ...rankingFixture, overallTop: crowd, myEntry: crowd.at(-1) });
    const view = render(<QueryClientProvider client={client}><RankingScreen /></QueryClientProvider>);

    const list = view.container.querySelector<HTMLElement>(".ranking-list")!;
    // 열 줄에서 끊기지 않는다. 열여덟 번째 사람까지 남아 판 안에서 굴러간다.
    expect(list.querySelectorAll("li")).toHaveLength(crowd.length);
    expect(within(list).getByText("랭커18")).toBeTruthy();
  });
});
