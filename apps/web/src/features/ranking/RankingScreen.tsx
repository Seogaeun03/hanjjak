import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { layout, prepare, type PreparedText } from "@chenglou/pretext";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../auth/api";
import placeBadgeArt from "./assets-cozy-pixel-v1/ranking-place-badge-gold-v1.png";
import podiumArt from "./assets-cozy-pixel-v1/ranking-podium-2-1-3-v1.png";
import panelArt from "./assets-cozy-pixel-v1/ranking-list-panel-wide-v2.png";
import tabsArt from "./assets-cozy-pixel-v1/ranking-category-tabs-trophy-v1.png";
import hallBackground from "./assets-cozy-pixel-v1/ranking-hall-background-v1.png";
import { heroFrame } from "../battle/battleVisuals";
import { rankingApi, type MaterialType, type RankingAppearance, type RankingEntry } from "./api";
import { cosmeticsApi } from "../cosmetics/api";
import { CosmeticHero, cosmeticEquipmentFromAppearance } from "../cosmetics/CosmeticHero";
import "./RankingScreen.css";

type RankingCategory = "ALL" | MaterialType;
type RankingMetric = "COMBAT_POWER" | "STAGE";
type RankKey = "overallRank" | "rank" | "stageOverallRank" | "stageRank";

/* 기본 나무검 아트는 주소에 판 번호를 달고 나간다. 여기서만 번호 없이 불러서
   브라우저가 예전 노란 막대기를 그대로 내주고 있었다. */
const REST_CHARACTER = heroFrame("rest", 0);
const CATEGORY_TABS: Array<{ id: RankingCategory; label: string }> = [
  { id: "ALL", label: "전체" },
  { id: "POTATO", label: "감자" },
  { id: "SWEET_POTATO", label: "고구마" },
  { id: "CORN", label: "옥수수" },
];
/* 재료 탭이 누구를 보여줄지 고르고, 이 버튼이 무엇으로 줄 세울지 고른다. */
const METRIC_BUTTONS: Array<{ id: RankingMetric; label: string }> = [
  { id: "COMBAT_POWER", label: "전투력" },
  { id: "STAGE", label: "스테이지" },
];
const PODIUM_ORDER = [2, 1, 3] as const;

function formatPower(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

/* stage.03-04 는 보드에서 3-4 로 읽힌다. */
function formatStage(stageId: string | null): string | null {
  const parsed = stageId?.match(/^stage\.(\d+)-(\d+)$/);
  return parsed ? `${Number(parsed[1])}-${Number(parsed[2])}` : null;
}

function rankKeyFor(category: RankingCategory, metric: RankingMetric): RankKey {
  if (metric === "STAGE") return category === "ALL" ? "stageOverallRank" : "stageRank";
  return category === "ALL" ? "overallRank" : "rank";
}

function usePretextLayout(contentKey: string) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!document.fonts || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void document.fonts.ready.then(() => {
      if (disposed || !root.current) return;
      const prepared = new Map<HTMLElement, PreparedText>();
      root.current.querySelectorAll<HTMLElement>("[data-pretext]").forEach((element) => {
        prepared.set(element, prepare(element.textContent ?? "", getComputedStyle(element).font, { wordBreak: "keep-all" }));
      });
      const relayout = () => prepared.forEach((text, element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 18;
        const measuredHeight = layout(text, Math.max(element.clientWidth, 1), lineHeight).height;
        const maxLines = Number.parseInt(element.dataset.pretextLines ?? "0", 10);
        element.style.minHeight = `${Math.ceil(maxLines > 0 ? Math.min(measuredHeight, lineHeight * maxLines) : measuredHeight)}px`;
      });
      observer = new ResizeObserver(relayout);
      observer.observe(root.current);
      relayout();
    });
    return () => { disposed = true; observer?.disconnect(); };
  }, [contentKey]);
  return root;
}

function appearanceSummary(appearance: RankingAppearance): string {
  const equipped = Object.values(appearance).filter(Boolean).length;
  return equipped > 0 ? `장착 치장 ${equipped}개` : "기본 외형";
}


function categoryTitle(category: RankingCategory): string {
  return CATEGORY_TABS.find((tab) => tab.id === category)?.label ?? "전체";
}

export function RankingScreen() {
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: authApi.session, retry: false });
  /* 보드는 한도 없이 통째로 받는다. 목록이 맨 밑까지 스크롤되어야 하기 때문이다. */
  const ranking = useQuery({ queryKey: ["combat-power-ranking"], queryFn: () => rankingApi.combatPower(), retry: false });
  const [category, setCategory] = useState<RankingCategory>("ALL");
  const [metric, setMetric] = useState<RankingMetric>("COMBAT_POWER");

  if (session.isLoading || ranking.isLoading) return <RankingMessage>랭킹 보드를 불러오는 중입니다.</RankingMessage>;
  if (!session.data?.account) return <RankingMessage error>로그인이 필요합니다.</RankingMessage>;
  if (ranking.isError) return <RankingMessage error><strong>랭킹 보드를 불러오지 못했습니다.</strong><button type="button" onClick={() => void ranking.refetch()}>다시 시도</button></RankingMessage>;
  if (!ranking.data) return <RankingMessage error>랭킹 데이터가 없습니다.</RankingMessage>;

  const entries = category === "ALL"
    ? ranking.data.overallTop
    : ranking.data.specializations.find((rankingGroup) => rankingGroup.materialType === category)?.entries ?? [];

  return <RankingPage
    category={category}
    metric={metric}
    entries={entries}
    myEntry={ranking.data.myEntry}
    selectedTitle={categoryTitle(category)}
    onCategoryChange={setCategory}
    onMetricChange={setMetric}
  />;
}

function RankingPage({ category, metric, entries, myEntry, selectedTitle, onCategoryChange, onMetricChange }: {
  category: RankingCategory;
  metric: RankingMetric;
  entries: RankingEntry[];
  myEntry: RankingEntry | null;
  selectedTitle: string;
  onCategoryChange: (category: RankingCategory) => void;
  onMetricChange: (metric: RankingMetric) => void;
}) {
  const pretextRoot = usePretextLayout(`${category}:${metric}:${entries.map((entry) => entry.nickname).join("|")}`);
  const rankKey = rankKeyFor(category, metric);
  const orderedEntries = useMemo(() => [...entries].sort((a, b) => a[rankKey] - b[rankKey]), [entries, rankKey]);
  const topThree = orderedEntries.slice(0, 3);

  return (
    <section
      ref={pretextRoot}
      className="ranking-screen"
      aria-labelledby="ranking-page-title"
      style={{ "--ranking-hall-background": `url(${hallBackground})` } as CSSProperties}
    >
      <h2 id="ranking-page-title" className="ranking-visually-hidden">종합 전투력 랭킹</h2>
      <CategoryTabs selected={category} onChange={onCategoryChange} />
      <div className="ranking-stage-layout">
        <Podium entries={topThree} rankKey={rankKey} metric={metric} category={selectedTitle} />
        <RankingBoard
          entries={orderedEntries}
          rankKey={rankKey}
          metric={metric}
          category={selectedTitle}
          overall={category === "ALL"}
          myEntry={category === "ALL" || myEntry?.materialType === category ? myEntry : null}
          onMetricChange={onMetricChange}
        />
      </div>
    </section>
  );
}

function CategoryTabs({ selected, onChange }: { selected: RankingCategory; onChange: (category: RankingCategory) => void }) {
  return (
    <nav className="ranking-category-tabs" aria-label="랭킹 분류">
      <img src={tabsArt} alt="" aria-hidden="true" />
      <div role="tablist" aria-label="전체 및 나라별 랭킹">
        {CATEGORY_TABS.map((tab) => <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={selected === tab.id}
          className={selected === tab.id ? "active" : undefined}
          onClick={() => onChange(tab.id)}
        >{tab.label}</button>)}
      </div>
    </nav>
  );
}

function Podium({ entries, rankKey, metric, category }: { entries: RankingEntry[]; rankKey: RankKey; metric: RankingMetric; category: string }) {
  const byRank = new Map(entries.map((entry) => [entry[rankKey], entry]));
  return (
    <section className="ranking-podium" aria-label={`${category} 랭킹 1위부터 3위`}>
      <div className="ranking-podium-scene">
        <div className="ranking-podium-platform">
          {PODIUM_ORDER.map((rank) => <PodiumRank key={rank} rank={rank} entry={byRank.get(rank)} metric={metric} />)}
          <img className="ranking-podium-art" src={podiumArt} alt="" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

/* 예전에는 모두가 같은 기본 그림이고 그 위에 색만 돌린 빈 칸을 얹었다. 이제 각자의
   착용 치장을 치장 탭과 같은 방식으로 겹쳐 그린다. */
function RankingCharacter({ entry }: { entry: RankingEntry }) {
  const catalog = useQuery({ queryKey: ["cosmetic-catalog"], queryFn: cosmeticsApi.catalog, retry: false, staleTime: Number.POSITIVE_INFINITY });
  return <CosmeticHero
    equipment={cosmeticEquipmentFromAppearance(entry.appearance)}
    catalog={catalog.data}
    className="ranking-character-layers"
    // 남의 캐릭터다. 내가 고른 색이 아니라 그 사람이 고른 색으로 그린다.
    color={entry.appearance.color}
    alt={`${entry.nickname}의 젓가락 캐릭터`}
    fallback={<img src={REST_CHARACTER} alt={`${entry.nickname}의 젓가락 캐릭터 rest 자세`} />}
  />;
}

function PodiumRank({ rank, entry, metric }: { rank: 1 | 2 | 3; entry?: RankingEntry; metric: RankingMetric }) {
  return (
    <article className={`ranking-podium-rank rank-${rank}${entry ? "" : " is-empty"}`} aria-label={entry ? `${rank}위 ${entry.nickname}` : `${rank}위 집계 중`}>
      <span className="ranking-place-badge" aria-hidden="true"><img src={placeBadgeArt} alt="" /><span>{rank}</span></span>
      {entry ? <>
        <div className="ranking-character-wrap" title={appearanceSummary(entry.appearance)} data-equipped-appearance={JSON.stringify(entry.appearance)}>
          <span className="ranking-character-glow" aria-hidden="true" />
          <RankingCharacter entry={entry} />
        </div>
        <div className="ranking-podium-copy">
          <strong data-pretext data-pretext-lines="1" title={entry.nickname}>{entry.nickname}</strong>
          <span><b>LV. {entry.level.toLocaleString()}</b><i aria-hidden="true" />{metricLabel(metric)} {metricValue(entry, metric)}</span>
        </div>
      </> : <div className="ranking-podium-empty">집계 중</div>}
    </article>
  );
}

function metricLabel(metric: RankingMetric): string {
  return metric === "STAGE" ? "스테이지" : "전투력";
}

/* 줄 세운 기준과 눈에 보이는 값이 어긋나면 순위가 납득되지 않는다. 같은 값을 쓴다. */
function metricValue(entry: RankingEntry, metric: RankingMetric): string {
  if (metric === "COMBAT_POWER") return formatPower(entry.combatPower);
  return formatStage(entry.highestClearedStageId) ?? "기록 없음";
}

function RankingRowValue({ entry, metric }: { entry: RankingEntry; metric: RankingMetric }) {
  const cleared = metric === "COMBAT_POWER" || entry.highestClearedStageId !== null;
  return <span className={`ranking-row-power${cleared ? "" : " is-unranked"}`}>
    <span>{metricLabel(metric)}</span><b>{metricValue(entry, metric)}</b>
  </span>;
}

function MetricButtons({ selected, onChange }: { selected: RankingMetric; onChange: (metric: RankingMetric) => void }) {
  return (
    <div className="ranking-metric-buttons" role="group" aria-label="랭킹 기준">
      {METRIC_BUTTONS.map((button) => <button
        key={button.id}
        type="button"
        aria-pressed={selected === button.id}
        className={selected === button.id ? "active" : undefined}
        onClick={() => onChange(button.id)}
      >{button.label}</button>)}
    </div>
  );
}

function RankingBoard({ entries, rankKey, metric, category, overall, myEntry, onMetricChange }: {
  entries: RankingEntry[];
  rankKey: RankKey;
  metric: RankingMetric;
  overall: boolean;
  category: string;
  myEntry: RankingEntry | null;
  onMetricChange: (metric: RankingMetric) => void;
}) {
  const myRank = myEntry ? myEntry[rankKey] : null;
  return (
    <section className="ranking-list-panel" aria-labelledby="ranking-list-title">
      <img className="ranking-list-panel-art" src={panelArt} alt="" aria-hidden="true" />
      <div className="ranking-list-content">
        <header>
          <h3 id="ranking-list-title">{category} 랭킹</h3>
          <MetricButtons selected={metric} onChange={onMetricChange} />
        </header>
        {/* 열 칸만 보이고 나머지는 판 안에서 굴러간다. 막대는 감춰 나무판 그림을 가리지 않는다. */}
        {entries.length > 0 ? <ol className="ranking-list">
          {entries.map((entry) => {
            const rank = entry[rankKey];
            const isMine = entry.nickname === myEntry?.nickname;
            /* 전체 랭킹에서는 "감자 전문" 대신 이름 색으로 계열을 알린다. 채팅과 같은 색이다. */
            return <li key={`${entry.materialType}-${rank}-${entry.nickname}`} className={`${rank <= 3 ? `is-top is-rank-${rank}` : ""}${isMine ? " is-mine" : ""}${overall ? ` material-${entry.materialType.toLowerCase().replace("_", "-")}` : ""}`}>
              <span className="ranking-row-rank">
                {rank <= 3 && <img src={placeBadgeArt} alt="" aria-hidden="true" />}
                <span>{rank}</span>
              </span>
              <span className="ranking-row-player"><strong data-pretext data-pretext-lines="1" title={entry.nickname}>{entry.nickname}</strong><small>LV. {entry.level.toLocaleString()}{overall ? "" : ` · ${entry.displayName}`}</small></span>
              <RankingRowValue entry={entry} metric={metric} />
            </li>;
          })}
        </ol> : <p className="ranking-empty">아직 집계된 랭커가 없습니다.<small>이 나라의 첫 랭커가 되어보세요.</small></p>}
        {myEntry && <div className="ranking-my-position" aria-label={`내 순위 ${myRank}위`}>
          <span className="ranking-row-rank"><span>{myRank}</span></span>
          <span className="ranking-row-player"><strong>{myEntry.nickname}</strong><small>LV. {myEntry.level.toLocaleString()} · {myEntry.displayName}</small></span>
          <RankingRowValue entry={myEntry} metric={metric} />
        </div>}
      </div>
    </section>
  );
}

function RankingMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <section className={`ranking-message${error ? " error" : ""}`} role={error ? "alert" : "status"}>{children}</section>;
}
