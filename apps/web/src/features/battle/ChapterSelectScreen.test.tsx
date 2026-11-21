// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChapterSelectScreen, chapterStates } from "./ChapterSelectScreen";
import { CHAPTER_SHOP_WIDTH_PERCENT, CHAPTERS, chapterOfStage, chapterShopPlacement } from "./chapterCatalog";
import { chapterMaterialDrops, chapterSkillBookDrops } from "./chapterMaterialDrops";
import type { StageSummary } from "./api";

function stage(stageId: string, unlocked: boolean, clearCount: number): StageSummary {
  return {
    stageId, unlocked, clearCount, contentVersion: "test", isCurrent: false, isRepeatTarget: false,
    repeatEligible: true, normalMonsterIds: [], bossMonsterId: null, backgroundId: null, bossOnly: false,
  };
}

const chapterStage = (chapter: number, number: number, unlocked: boolean, cleared: boolean) =>
  stage(`stage.${String(chapter).padStart(2, "0")}-${String(number).padStart(2, "0")}`, unlocked, cleared ? 2 : 0);

afterEach(cleanup);

const stages = [
  ...Array.from({ length: 10 }, (_, index) => chapterStage(1, index + 1, true, true)),
  ...Array.from({ length: 10 }, (_, index) => chapterStage(2, index + 1, index < 4, index < 2)),
];

describe("chapterOfStage", () => {
  it("reads the chapter out of the stage id", () => {
    expect(chapterOfStage("stage.01-07")).toBe(1);
    expect(chapterOfStage("stage.04-10")).toBe(4);
  });
});

describe("chapterMaterialDrops", () => {
  it("adds one material generation per chapter until chapter four", () => {
    expect(chapterMaterialDrops(1).flatMap((drop) => drop.items.map((item) => item.name))).toEqual([
      "감자 한 조각", "고구마 한 조각", "옥수수 한 알",
    ]);
    expect(chapterMaterialDrops(2)).toHaveLength(2);
    expect(chapterMaterialDrops(3)).toHaveLength(3);
    expect(chapterMaterialDrops(4)).toHaveLength(4);
    expect(chapterMaterialDrops(10)).toHaveLength(4);
    expect(chapterMaterialDrops(4).map((drop) => drop.label)).toEqual(["F등급", "D등급", "C등급", "B등급"]);
  });

  it("opens the skill-book grades at the chapter boundaries", () => {
    expect(chapterSkillBookDrops(1).map((drop) => drop.label)).toEqual(["노말"]);
    expect(chapterSkillBookDrops(2).map((drop) => drop.label)).toEqual(["노말", "희귀"]);
    expect(chapterSkillBookDrops(4).map((drop) => drop.label)).toEqual(["노말", "희귀", "영웅"]);
    expect(chapterSkillBookDrops(5).map((drop) => drop.label)).toEqual(["노말", "희귀", "영웅"]);
    expect(chapterSkillBookDrops(6).map((drop) => drop.label)).toEqual(["노말", "희귀", "영웅", "전설"]);
    expect(chapterSkillBookDrops(10).map((drop) => drop.label)).toEqual(["노말", "희귀", "영웅", "전설"]);
  });

  /* 11~15장은 서버가 8~10장과 같은 드롭표를 쓴다(전설 스킬북 포함). */
  it("keeps chapter 10's drop preview for chapters 11-15", () => {
    for (let chapter = 11; chapter <= 15; chapter += 1) {
      expect(chapterMaterialDrops(chapter)).not.toHaveLength(0);
      expect(chapterMaterialDrops(chapter)).toEqual(chapterMaterialDrops(10));
      expect(chapterSkillBookDrops(chapter)).not.toHaveLength(0);
      expect(chapterSkillBookDrops(chapter)).toEqual(chapterSkillBookDrops(10));
    }
  });
});

describe("CHAPTERS catalog", () => {
  /* 11~15장은 전용 아트가 생기기 전까지 10장(싸피) 이름·가게·선택 그림을 그대로 쓴다. */
  it("reuses chapter 10's name and art for chapters 11-15", () => {
    const chapterTen = CHAPTERS.find((entry) => entry.chapter === 10);
    for (let chapter = 11; chapter <= 15; chapter += 1) {
      const entry = CHAPTERS.find((candidate) => candidate.chapter === chapter);
      expect(entry?.name).toBe("싸피");
      expect(entry?.art).toBe(chapterTen?.art);
      expect(entry?.selectedArt).toBe(chapterTen?.selectedArt);
    }
    expect(CHAPTERS.find((entry) => entry.chapter === 11)?.levelRange).toBe("201~219");
    expect(CHAPTERS.find((entry) => entry.chapter === 12)?.levelRange).toBe("221~239");
    expect(CHAPTERS.find((entry) => entry.chapter === 13)?.levelRange).toBe("241~259");
    expect(CHAPTERS.find((entry) => entry.chapter === 14)?.levelRange).toBe("261~279");
    expect(CHAPTERS.find((entry) => entry.chapter === 15)?.levelRange).toBe("281~299");
  });
});

describe("chapterShopPlacement", () => {
  /* 1~5는 아래층 왼쪽부터, 6~10은 위층 왼쪽부터다. 그림이 정해 준 배치다. */
  it("puts the first five downstairs and the rest upstairs", () => {
    expect(chapterShopPlacement(1).top).toBeCloseTo(chapterShopPlacement(5).top);
    expect(chapterShopPlacement(6).top).toBeCloseTo(chapterShopPlacement(10).top);
    expect(chapterShopPlacement(6).top).toBeLessThan(chapterShopPlacement(1).top);
    expect(chapterShopPlacement(1).left).toBeLessThan(chapterShopPlacement(5).left);
    expect(chapterShopPlacement(1).left).toBeCloseTo(chapterShopPlacement(6).left);
  });

  it("keeps every shop inside the arcade wall", () => {
    for (let chapter = 1; chapter <= 15; chapter += 1) {
      const { left } = chapterShopPlacement(chapter);
      expect(left + CHAPTER_SHOP_WIDTH_PERCENT).toBeLessThanOrEqual(100);
    }
  });

  /* 상가 배경은 칸이 10개뿐이라 11장부터는 같은 칸을 재사용하는 둘째 페이지로
     넘어간다. 1장이 쓰던 자리를 11장이, 5장이 쓰던 자리를 15장이 그대로 쓴다. */
  it("reuses the first page's slots for the second page's chapters", () => {
    expect(chapterShopPlacement(11)).toEqual(chapterShopPlacement(1));
    expect(chapterShopPlacement(15)).toEqual(chapterShopPlacement(5));
  });
});

describe("chapterStates", () => {
  it("opens a chapter when any of its stages is open and clears it only when every stage is cleared", () => {
    const states = chapterStates(stages);
    expect(states[0]).toMatchObject({ unlocked: true, cleared: true, clearedStages: 10 });
    expect(states[1]).toMatchObject({ unlocked: true, cleared: false, clearedStages: 2 });
  });

  it("leaves a chapter without any stage locked", () => {
    expect(chapterStates(stages)[4]).toMatchObject({ unlocked: false, cleared: false });
  });
});

describe("ChapterSelectScreen", () => {
  it("follows the picked chapter in the footer and hands back the stage that was chosen", () => {
    const onSelectStage = vi.fn();
    const onClose = vi.fn();
    render(<ChapterSelectScreen stages={stages} selectedStageId="stage.01-07" onSelectStage={onSelectStage} onClose={onClose} />);

    expect(screen.getByRole("button", { name: "1챕터 과일가게" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "2챕터 음료" }));
    expect(screen.getByText("CHAPTER 2")).toBeTruthy();
    expect(screen.getByText("음료")).toBeTruthy();
    expect(screen.getByRole("img", { name: "감자 한 조각" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "미니 옥수수" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "황금 감자" })).toBeNull();
    expect(screen.getByRole("img", { name: "스킬북: 노말·희귀" })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /스킬북:/ })).toHaveLength(1);
    expect(screen.getByLabelText("획득 가능 등급: 노말, 희귀")).toBeTruthy();
    expect(screen.queryByText("전설")).toBeNull();
    expect(screen.queryByText("권장 레벨")).toBeNull();
    expect(screen.queryByText("2 / 10")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "챕터 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "2-3 클리어 0회" }));
    expect(onSelectStage).toHaveBeenCalledWith("stage.02-03");
    expect(onClose).toHaveBeenCalled();
  });

  /* 이제 10챕터 모두 몹·보스·배경이 있다. 아직 못 간 챕터는 이름을 그대로 두고
     단추만 잠근다. "준비 중"으로 남는 칸은 없다. */
  it("will not let a locked chapter be entered", () => {
    render(<ChapterSelectScreen stages={stages} selectedStageId="stage.01-07" onSelectStage={() => undefined} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "7챕터 중식당 잠김" }));
    expect(screen.getByRole("button", { name: "챕터 이동" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "6챕터 패스트푸드 잠김" }));
    expect(screen.getByRole("button", { name: "챕터 이동" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "준비 중" })).toBeNull();
  });
});

/* 2026-09-27 11-15장 확장: 상가 배경 칸이 10개뿐이라 둘째 페이지로 나눈다. */
describe("ChapterSelectScreen pages", () => {
  it("opens on the first page by default, showing chapters 1-10 but not 11-15", () => {
    render(<ChapterSelectScreen stages={stages} selectedStageId="stage.01-07" onSelectStage={() => undefined} onClose={() => undefined} />);

    expect(screen.getByRole("button", { name: "1챕터 과일가게" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "10챕터 싸피 잠김" }).closest("li")?.hasAttribute("data-threat-tier")).toBe(false);
    expect(screen.queryByRole("button", { name: /11챕터/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /15챕터/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "이전 챕터 페이지" })).toBeNull();
    expect(screen.getByRole("button", { name: "다음 챕터 페이지" })).toBeTruthy();
  });

  it("switches to the second page and back with the page buttons, showing chapters 11-15 but not 1-10", () => {
    render(<ChapterSelectScreen stages={stages} selectedStageId="stage.01-07" onSelectStage={() => undefined} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "다음 챕터 페이지" }));

    expect(screen.getByRole("button", { name: "11챕터 싸피 잠김" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "15챕터 싸피 잠김" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^1챕터/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^10챕터/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "다음 챕터 페이지" })).toBeNull();
    expect(screen.getByRole("button", { name: "이전 챕터 페이지" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "이전 챕터 페이지" }));
    expect(screen.getByRole("button", { name: "1챕터 과일가게" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /11챕터/ })).toBeNull();
  });

  it("opens on the second page and selects the current chapter when the picked stage is in chapter 11+", () => {
    render(<ChapterSelectScreen stages={stages} selectedStageId="stage.12-03" onSelectStage={() => undefined} onClose={() => undefined} />);

    expect(screen.getByRole("button", { name: "12챕터 싸피 잠김" }).getAttribute("aria-pressed")).toBe("true");
    for (let chapter = 11; chapter <= 15; chapter += 1) {
      expect(screen.getByRole("button", { name: `${chapter}챕터 싸피 잠김` }).closest("li")?.getAttribute("data-threat-tier")).toBe(String(chapter - 10));
    }
    expect(screen.queryByRole("button", { name: /^1챕터/ })).toBeNull();
    expect(screen.getByText("CHAPTER 12")).toBeTruthy();
  });

  /* 페이지만 넘기고 선택 챕터는 그대로 두면, 발치말과 "챕터 이동"이 이제 안 보이는
     페이지의 챕터를 계속 가리키고 보이는 가게 중 어느 것도 선택 표시가 없다. */
  it("keeps the footer, selected shop, and enter button in sync with the page after flipping pages", () => {
    render(<ChapterSelectScreen stages={stages} selectedStageId="stage.01-07" onSelectStage={() => undefined} onClose={() => undefined} />);

    expect(screen.getByRole("button", { name: "1챕터 과일가게" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "다음 챕터 페이지" }));

    /* 11-15장은 이 스테이지 목록에 하나도 없어 전부 잠겨 있다 — 그 페이지의 첫
       챕터인 11장이 대신 선택된다. */
    expect(screen.getByText("CHAPTER 11")).toBeTruthy();
    expect(screen.getByRole("button", { name: "11챕터 싸피 잠김" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /^1챕터/ })).toBeNull();
    expect(screen.getByRole("button", { name: "챕터 이동" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "이전 챕터 페이지" }));

    /* 지금 스테이지(1-07)의 챕터가 1페이지에 있으니 그 챕터로 되돌아간다. */
    expect(screen.getByText("CHAPTER 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1챕터 과일가게" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /11챕터/ })).toBeNull();
  });
});
