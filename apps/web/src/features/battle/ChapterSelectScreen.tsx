import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { StageSummary } from "./api";
import { formatStageId } from "./stageLabel";
import {
  CHAPTERS,
  CHAPTER_PAGE_COUNT,
  CHAPTER_SHOP_HEIGHT_PERCENT,
  CHAPTER_SHOP_WIDTH_PERCENT,
  chapterOfStage,
  chapterPage,
  chapterShopPlacement,
  type ChapterEntry,
} from "./chapterCatalog";
import arcadeBackground from "./assets-chapter-select-v1/arcade-background.png";
import badgeNormal from "./assets-chapter-select-v1/badges/chapter-badge-normal.png";
import badgeSelected from "./assets-chapter-select-v1/badges/chapter-badge-selected.png";
import badgeLocked from "./assets-chapter-select-v1/badges/chapter-badge-locked.png";
import badgeCleared from "./assets-chapter-select-v1/badges/chapter-badge-cleared.png";
import iconCheck from "./assets-chapter-select-v1/icons/icon-check.png";
import iconLock from "./assets-chapter-select-v1/icons/icon-lock.png";
import contentTitlePlaque from "./assets-content-picker-v1/content-title-plaque.png";
import closeButton from "../../shared/assets/cozy-paper-v2/close-button.png";
import contentMoveButton from "./assets-content-picker-v1/move-button.png";
import contentComingSoonButton from "./assets-content-picker-v1/coming-soon-button.png";
import skillBookIcon from "../../shared/assets/cozy-hud-v1-webp/icons/reward-skillbook.webp";
import { chapterMaterialDrops, chapterSkillBookDrops } from "./chapterMaterialDrops";
import "./ChapterSelectScreen.css";

export type ChapterState = {
  entry: ChapterEntry;
  stages: StageSummary[];
  unlocked: boolean;
  cleared: boolean;
  clearedStages: number;
};

/**
 * 챕터 하나가 열렸는지, 다 깼는지는 그 챕터에 속한 스테이지들이 말해 준다.
 * 설계서가 아직 없는 챕터는 스테이지가 하나도 없으므로 늘 잠겨 있다.
 */
export function chapterStates(stages: StageSummary[]): ChapterState[] {
  return CHAPTERS.map((entry) => {
    const owned = stages.filter((stage) => chapterOfStage(stage.stageId) === entry.chapter);
    const clearedStages = owned.filter((stage) => stage.clearCount > 0).length;
    return {
      entry,
      stages: owned,
      unlocked: owned.some((stage) => stage.unlocked),
      cleared: owned.length > 0 && clearedStages === owned.length,
      clearedStages,
    };
  });
}

function badgeArt(state: ChapterState, selected: boolean): string {
  if (!state.unlocked) return badgeLocked;
  if (selected) return badgeSelected;
  return state.cleared ? badgeCleared : badgeNormal;
}

/*
 * 페이지를 넘기면 그 페이지에서 고를 챕터도 같이 정해야 한다 — 안 그러면 화면
 * 아래쪽(발치말·챕터 이동 단추)은 이제 안 보이는 이전 페이지 챕터를 계속 가리키고,
 * 보이는 가게 중 어느 것도 선택 표시가 없는 채로 남는다. 우선순위: 지금 스테이지의
 * 챕터가 그 페이지에 있으면 그걸, 아니면 그 페이지에서 열린 챕터 중 가장 큰 번호,
 * 그마저 없으면 그 페이지의 첫 챕터 — 잠긴 챕터를 고르는 것 자체는 기존 화면도
 * 이미 허용한다(단추만 잠기고 "챕터 이동"이 비활성화된다).
 */
function chapterForPage(page: number, states: ChapterState[], selectedStageId: string): number {
  const onPage = states.filter((state) => chapterPage(state.entry.chapter) === page);
  const stageChapter = chapterOfStage(selectedStageId);
  if (onPage.some((state) => state.entry.chapter === stageChapter)) return stageChapter;
  const highestUnlocked = onPage
    .filter((state) => state.unlocked)
    .reduce((max, state) => Math.max(max, state.entry.chapter), 0);
  if (highestUnlocked > 0) return highestUnlocked;
  return onPage[0]?.entry.chapter ?? 1;
}

export function ChapterSelectScreen({ stages, selectedStageId, onSelectStage, onClose }: {
  stages: StageSummary[];
  selectedStageId: string;
  onSelectStage: (stageId: string) => void;
  onClose: () => void;
}) {
  const states = useMemo(() => chapterStates(stages), [stages]);
  /*
   * `selectedStageId` 가 가리키는 챕터가 카탈로그에 없으면(예: 잘못된 스테이지 id)
   * 1챕터로 되돌린다 — 그래야 아래 `current` 탐색이 항상 성공해 1챕터로 조용히
   * 빠지는 대신 실제로 고를 수 있는 챕터를 선택한 채로 화면이 열린다.
   */
  const [picked, setPicked] = useState(() => {
    const chapter = chapterOfStage(selectedStageId);
    return CHAPTERS.some((entry) => entry.chapter === chapter) ? chapter : 1;
  });
  /* 상가 배경 칸은 10개뿐이라 11챕터부터는 같은 칸을 재사용하는 둘째 페이지에 산다.
     화면은 늘 지금 고른 챕터가 있는 페이지를 열어 준다. */
  const [page, setPage] = useState(() => chapterPage(picked));
  /* 가게를 고르는 화면과 그 안의 스테이지를 고르는 화면은 같은 창의 두 쪽이다. */
  const [stageListOpen, setStageListOpen] = useState(false);
  const current = states.find((state) => state.entry.chapter === picked) ?? states[0];
  const pageStates = states.filter((state) => chapterPage(state.entry.chapter) === page);
  const materialDrops = chapterMaterialDrops(current.entry.chapter);
  const skillBookDrops = chapterSkillBookDrops(current.entry.chapter);

  /* 페이지 전환은 늘 그 페이지에서 고를 챕터도 같이 바꿔서, 발치말·선택 표시가
     이제 안 보이는 페이지를 계속 가리키는 일이 없게 한다. */
  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    setPicked(chapterForPage(nextPage, states, selectedStageId));
  };

  /*
   * 전투 화면의 스테이지 묶음에는 transform 이 걸려 있어, 그 안에서 position:fixed
   * 를 쓰면 화면이 아니라 그 묶음 크기에 갇힌다. 몸통에 직접 띄운다.
   */
  return createPortal(<div className="chapter-select-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="chapter-select" role="dialog" aria-modal="true" aria-labelledby="chapter-select-title">
      <div className="chapter-select-stage" style={{ backgroundImage: `url(${arcadeBackground})` }}>
        <header className="chapter-select-topbar">
          <h2 id="chapter-select-title" style={{ backgroundImage: `url(${contentTitlePlaque})` }}>챕터 선택</h2>
          <button type="button" className="chapter-select-close" aria-label="챕터 선택 닫기" onClick={onClose}>
            <img src={closeButton} alt="" aria-hidden="true" />
          </button>
        </header>

        {page > 0 && <button
          type="button"
          className="chapter-select-page-nav is-prev"
          aria-label="이전 챕터 페이지"
          onClick={() => goToPage(page - 1)}
        >‹</button>}
        {page < CHAPTER_PAGE_COUNT - 1 && <button
          type="button"
          className="chapter-select-page-nav is-next"
          aria-label="다음 챕터 페이지"
          onClick={() => goToPage(page + 1)}
        >›</button>}

        <ul className="chapter-select-shops">{pageStates.map((state) => {
          const { chapter, name } = state.entry;
          const selected = chapter === picked;
          const placement = chapterShopPlacement(chapter);
          const threatTier = chapter >= 11 && chapter <= 15 ? chapter - 10 : 0;
          return <li
            key={chapter}
            className={`chapter-shop${selected ? " is-selected" : ""}${state.unlocked ? "" : " is-locked"}`}
            data-threat-tier={threatTier || undefined}
            style={{
              left: `${placement.left}%`,
              top: `${placement.top}%`,
              width: `${CHAPTER_SHOP_WIDTH_PERCENT}%`,
              height: `${CHAPTER_SHOP_HEIGHT_PERCENT}%`,
            }}
          >
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`${chapter}챕터 ${name}${state.unlocked ? "" : " 잠김"}`}
              onClick={() => setPicked(chapter)}
            >
              <img className="chapter-shop-art" src={selected ? state.entry.selectedArt : state.entry.art} alt="" />
            </button>
            {threatTier > 0 && <span className="chapter-shop-threat" aria-hidden="true" />}
            <span className="chapter-shop-badge" aria-hidden="true">
              <img src={badgeArt(state, selected)} alt="" />
              <b>{chapter}</b>
            </span>
            {!state.unlocked && <img className="chapter-shop-mark is-lock" src={iconLock} alt="" aria-hidden="true" />}
            {state.cleared && <img className="chapter-shop-mark is-check" src={iconCheck} alt="" aria-hidden="true" />}
          </li>;
        })}</ul>

        <footer className="chapter-select-footer">
          <img className="chapter-select-footer-art" src={current.entry.art} alt="" aria-hidden="true" />
          <p className="chapter-select-footer-name">
            <small>CHAPTER {current.entry.chapter}</small>
            <strong>{current.entry.name}</strong>
          </p>
          <section className="chapter-select-footer-drops" aria-label="획득 가능 보상">
            <small>획득 가능 보상</small>
            <div className="chapter-select-reward-groups">
              <div className="chapter-select-reward-group">
                <ul>{materialDrops.map((drop) => <li key={drop.tier}>
                  <span className="chapter-select-drop-icons">
                    {drop.items.map((item) => <span key={item.name} role="img" aria-label={item.name} title={item.name}>
                      <img src={item.icon} alt="" aria-hidden="true" />
                    </span>)}
                  </span>
                  <b>{drop.label}</b>
                </li>)}</ul>
              </div>
              <div className="chapter-select-reward-group is-skillbooks">
                <div className="chapter-select-skillbook-summary">
                  <span className="chapter-select-book-icon" role="img" aria-label={`스킬북: ${skillBookDrops.map((drop) => drop.label).join("·")}`} title={`스킬북 · ${skillBookDrops.map((drop) => drop.label).join("·")}`}>
                    <img src={skillBookIcon} alt="" aria-hidden="true" />
                  </span>
                  <span className="chapter-select-book-grades" aria-label={`획득 가능 등급: ${skillBookDrops.map((drop) => drop.label).join(", ")}`}>
                    {skillBookDrops.map((drop) => <b key={drop.grade} className={`is-${drop.grade}`}>{drop.label}</b>)}
                  </span>
                </div>
              </div>
            </div>
          </section>
          <button
            type="button"
            className="chapter-select-enter"
            style={{ backgroundImage: `url(${current.entry.comingSoon ? contentComingSoonButton : contentMoveButton})` }}
            disabled={!current.unlocked}
            onClick={() => setStageListOpen(true)}
          >{current.entry.comingSoon ? "준비 중" : "챕터 이동"}</button>
        </footer>

        {stageListOpen && <div className="chapter-stage-sheet" role="dialog" aria-label={`${current.entry.name} 스테이지 선택`}>
          <header>
            <strong>CHAPTER {current.entry.chapter} · {current.entry.name}</strong>
            <button type="button" aria-label="스테이지 목록 닫기" onClick={() => setStageListOpen(false)}>×</button>
          </header>
          <ul>{current.stages.map((stage) => <li key={stage.stageId}>
            <button
              type="button"
              className={stage.stageId === selectedStageId ? "is-current" : undefined}
              disabled={!stage.unlocked}
              aria-label={`${formatStageId(stage.stageId)} ${stage.unlocked ? `클리어 ${stage.clearCount}회` : "잠김"}`}
              onClick={() => { onSelectStage(stage.stageId); onClose(); }}
            >
              <b>{formatStageId(stage.stageId)}</b>
              <small>{stage.unlocked ? `클리어 ${stage.clearCount}회` : "잠김"}</small>
            </button>
          </li>)}</ul>
        </div>}
      </div>
    </section>
  </div>, document.body);
}
