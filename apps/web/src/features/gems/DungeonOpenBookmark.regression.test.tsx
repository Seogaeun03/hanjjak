// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DungeonSelection } from "./GemsScreen";
import type { GemDungeonToday } from "./api";

afterEach(cleanup);

function today(boss: GemDungeonToday["boss"]): GemDungeonToday {
  return {
    boss,
    tickets: 1,
    secondsUntilNextTicket: 145,
    progress: [{ boss, highestClearedStage: 0 }],
    nextChallengeStage: 1,
    sweepStage: null,
    nextChallengeRewardGemBoxes: 10,
    sweepRewardGemBoxesPerTicket: null,
    activeChallenge: null,
    testBossSelectionEnabled: false,
    rankings: {},
  };
}

function bookmarks() {
  return [...document.querySelectorAll(".dungeon-bookmark")].map((mark) => ({
    label: mark.querySelector("em")?.textContent ?? "",
    classes: mark.className,
  }));
}

/* 지금 들어갈 수 있는 문은 흐리게 두지 않는다. 흐림은 "아직 못 들어간다"는 뜻이라,
   열린 문에 걸면 열려 있다는 사실이 가려진다. */
it("지금 열린 던전만 흐리지 않게 표시한다", () => {
  render(<DungeonSelection dungeon={today("SURVIVAL")} busy={false} now={Date.UTC(2026, 8, 15, 9)} onSelectBoss={vi.fn()} onStart={vi.fn()} onSweep={vi.fn()} />);

  const marks = bookmarks();
  const open = marks.filter((mark) => mark.label === "지금 OPEN");
  const shut = marks.filter((mark) => mark.label !== "지금 OPEN");

  expect(open).toHaveLength(1);
  expect(open[0]!.classes).toContain("opened");
  expect(open[0]!.classes).not.toContain("locked");
  expect(shut).toHaveLength(2);
  for (const mark of shut) {
    expect(mark.classes).toContain("locked");
    expect(mark.classes).not.toContain("opened");
  }
});

/* 오늘의 보스가 바뀌어도 흐리지 않은 문은 언제나 열린 문 하나다. */
it("오늘의 보스가 바뀌면 흐리지 않은 문도 따라 옮겨간다", () => {
  render(<DungeonSelection dungeon={today("ARMORED")} busy={false} now={Date.UTC(2026, 8, 15, 9)} onSelectBoss={vi.fn()} onStart={vi.fn()} onSweep={vi.fn()} />);

  const open = bookmarks().filter((mark) => mark.classes.includes("opened"));
  expect(open).toHaveLength(1);
  expect(open[0]!.label).toBe("지금 OPEN");
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
});

it("닫힌 던전도 내용을 확인할 수 있지만 도전과 소탕은 비활성화한다", () => {
  const onSelectBoss = vi.fn();
  const dungeon = {
    ...today("SURVIVAL"),
    progress: [
      { boss: "SURVIVAL" as const, highestClearedStage: 0 },
      { boss: "BERSERK" as const, highestClearedStage: 2 },
      { boss: "ARMORED" as const, highestClearedStage: 3 },
    ],
    rankings: {
      BERSERK: {
        topEntries: [{ rank: 1, nickname: "메추리왕", stage: 27, clearedAt: "2026-09-17T04:26:00+09:00" }],
        myEntry: null,
      },
    },
  };
  render(<DungeonSelection dungeon={dungeon} busy={false} now={Date.UTC(2026, 8, 15, 9)} onSelectBoss={onSelectBoss} onStart={vi.fn()} onSweep={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: /메추리알 장조림/ }));

  expect(screen.getByText("현재 열리지 않은 던전입니다")).toBeDefined();
  expect(screen.getByText("메추리왕")).toBeDefined();
  expect(screen.getByRole("button", { name: /3단계 도전/ })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "소탕하기" })).toHaveProperty("disabled", true);
  expect(onSelectBoss).not.toHaveBeenCalled();
});

it("서버가 랭킹 스냅샷을 제공하면 단계와 클리어 시각을 표시한다", () => {
  const dungeon: GemDungeonToday = {
    ...today("SURVIVAL"),
    rankings: {
      SURVIVAL: {
        topEntries: [{ rank: 1, nickname: "면사랑", stage: 30, clearedAt: "2026-09-17T04:37:00+09:00" }],
        myEntry: { rank: 128, nickname: "한짝", stage: 4, clearedAt: "2026-09-17T12:37:00+09:00" },
      },
    },
  };
  render(<DungeonSelection dungeon={dungeon} busy={false} onSelectBoss={vi.fn()} onStart={vi.fn()} onSweep={vi.fn()} />);

  expect(screen.getByText("면사랑").parentElement?.textContent).toContain("30단계");
  expect(screen.getByText("면사랑").parentElement?.querySelector("time")?.textContent).toBe("09.17\n04:37");
  expect(screen.getByText("클리어 단계")).toBeTruthy();
  expect(screen.getByText("클리어 시각")).toBeTruthy();
  expect(screen.getByLabelText("내 순위 128위").textContent).toBe("128위");
  expect(document.querySelector(".dungeon-boss-intro > span img")?.getAttribute("src"))
    .toBe(document.querySelector(".dungeon-bookmark.active img")?.getAttribute("src"));
});
