import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { AccountIdentity } from "../auth/api";
import { restartActiveBattle } from "./autoBattleControl";
import riceIcon from "../equipment/assets-cozy-pixel/currency-rice-gold-256.png";
import cosmeticTicketIcon from "../cosmetics/assets-cozy-pixel/cosmetic-draw-ticket-v1.png";
import profileIcons from "../profile/assets-cozy-pixel-v2/profile-info-icons-v3.png";
import cornKernelIcon from "../equipment/assets/material-ranks/corn-kernel-f.png";
import cornMiniIcon from "../equipment/assets/material-ranks/corn-mini-d.png";
import cornIcon from "../equipment/assets/material-ranks/corn-c.png";
import cornGoldenIcon from "../equipment/assets/material-ranks/corn-golden-b.png";
import cornLegendaryIcon from "../equipment/assets/material-ranks/corn-legendary-a.png";
import potatoFragmentIcon from "../equipment/assets/material-ranks/potato-fragment-f.png";
import potatoMiniIcon from "../equipment/assets/material-ranks/potato-mini-d.png";
import potatoIcon from "../equipment/assets/material-ranks/potato-c.png";
import potatoGoldenIcon from "../equipment/assets/material-ranks/potato-golden-b.png";
import potatoLegendaryIcon from "../equipment/assets/material-ranks/potato-legendary-a.png";
import sweetPotatoFragmentIcon from "../equipment/assets/material-ranks/sweet-potato-fragment-f.png";
import sweetPotatoMiniIcon from "../equipment/assets/material-ranks/sweet-potato-mini-d.png";
import sweetPotatoIcon from "../equipment/assets/material-ranks/sweet-potato-c.png";
import sweetPotatoGoldenIcon from "../equipment/assets/material-ranks/sweet-potato-golden-b.png";
import sweetPotatoLegendaryIcon from "../equipment/assets/material-ranks/sweet-potato-legendary-a.png";
import stageVictoryIcon from "../../shared/assets/cozy-hud-v1-webp/icons/battle-event-victory.webp";
import stageFailureIcon from "../../shared/assets/cozy-hud-v1-webp/icons/battle-event-failure.webp";
import bottomCharacterIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/character.webp";
import bottomEquipmentIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/equipment.webp";
import bottomItemsIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/item.webp";
import bottomSkillsIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/skill.webp";
import bottomGemsIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/gem.webp";
import bottomGemsLockedIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/gem-locked.webp";
import chopstickHeadIcon from "../../shared/assets/cozy-hud-v1-webp/icons/chopstick-head.webp";
import stageTimerIcon from "../../shared/assets/cozy-hud-v1-webp/paper/stage-timer-hourglass-figma-v2.webp";
import stageChapterIcon from "../../shared/assets/cozy-hud-v1-webp/paper/stage-action-chapter-figma-v2.webp";
import stageSelectIcon from "../../shared/assets/cozy-hud-v1-webp/paper/stage-action-stage-figma-v2.webp";
import stageResetIcon from "../../shared/assets/cozy-hud-v1-webp/paper/stage-action-reset-figma-v2.webp";
import stageHistoryIcon from "../../shared/assets/cozy-hud-v1-webp/paper/stage-action-history-figma-v2.webp";
import rewardSkillbookIcon from "../../shared/assets/cozy-hud-v1-webp/icons/reward-skillbook.webp";
import rewardsEmptyIcon from "../../shared/assets/cozy-hud-v1-webp/icons/rewards-empty-final.webp";
import rewardResetDialog from "../../shared/assets/cozy-hud-v1-webp/reward-reset/popup-blank-shell.webp";
import rewardResetPouch from "../../shared/assets/cozy-hud-v1-webp/reward-reset/reward-pouch-icon.webp";
import rewardResetConfirm from "../../shared/assets/cozy-hud-v1-webp/reward-reset/button-coral-default.webp";
import rewardResetCancel from "../../shared/assets/cozy-hud-v1-webp/reward-reset/button-beige-default.webp";
import utilityBattleReturnIcon from "../../shared/assets/cozy-hud-v1-webp/top-utilities/back-normalized-v1.webp";
import utilityMailIcon from "../../shared/assets/cozy-hud-v10/top-utilities/icon-mail-simple-v1.png";
import utilityContentIcon from "../../shared/assets/cozy-hud-v10/top-utilities/icon-content-simple-v1.png";
import utilityMarketIcon from "../../shared/assets/cozy-hud-v10/top-utilities/icon-market-simple-v1.png";
import utilityRankingIcon from "../../shared/assets/cozy-hud-v10/top-utilities/icon-ranking-simple-v1.png";
import utilitySettingsIcon from "../../shared/assets/cozy-hud-v10/top-utilities/icon-settings-simple-v1.png";
import utilityLiveopsIcon from "../../shared/assets/cozy-hud-v10/top-utilities/icon-liveops-gacha-simple-v1.png";
import trophyIcon from "../../shared/assets/cozy-hud-v1-webp/icons/nav-ranking.webp";
import { CosmeticHero, useOwnCosmeticAppearance } from "../cosmetics/CosmeticHero";
import paperCloseButton from "../../shared/assets/cozy-hud-v9/close-button-v9.png";
import contentAppearanceIcon from "../../shared/assets/cozy-hud-v1-webp/top-utilities/appearance-gacha-normalized-v2.webp";
import contentDungeonIcon from "../../shared/assets/cozy-hud-v1-webp/top-utilities/dungeon-normalized-v2.webp";
import contentRaidIcon from "../../shared/assets/cozy-hud-v1-webp/top-utilities/raid-normalized-v2.webp";
import type { FirstClearRewardResult } from "../first-clear-rewards/api";
import type { BattleHistoryEvent, RewardLine, StageSummary } from "./api";
import { battleApi } from "./api";
import { BattleHistoryGains, battleHistoryDateTime, battleHistoryDuration, battleHistoryResultEvents, battleHistoryResultLabel, battleHistoryStageEnteredAt, battleHistoryTargetLabel } from "./BattleHistoryScreen";
import { mailApi, noticeApi } from "../mail/api";
import { marketApi } from "../market/api";
import { giftMailOnly } from "../mail/mailFilters";
import { liveopsApi } from "../liveops/api";
import { preloadScreenChunk } from "../../screenChunks";
import { formatStageId } from "./stageLabel";
import { CHAPTERS, chapterOfStage } from "./chapterCatalog";
import "./BattleHud.css";

/* 챕터 선택 창은 전투 화면의 단추로만 열린다. 첫 화면과 따로 받아 오고, 여는
   단추에 손이 닿으면 미리 받는다. 미리 받기가 실패해도 삼킨다 — 실제로 열 때
   `lazy` 가 다시 받는다. */
const loadChapterSelect = () => import("./ChapterSelectScreen");
const preloadChapterSelect = () => void loadChapterSelect().catch(() => undefined);
const ChapterSelectScreen = lazy(() => loadChapterSelect().then((m) => ({ default: m.ChapterSelectScreen })));

export type BattleHudRoute = "battle" | "battleHistory" | "character" | "equipment" | "inventory" | "skills" | "gems" | "dungeon" | "raid" | "market" | "mail" | "ranking" | "arena" | "settings" | "cosmetics" | "liveops";

type NavigationProps = {
  onNavigate: (route: BattleHudRoute) => void;
  activeRoute?: BattleHudRoute;
  gemContentUnlocked?: boolean;
  cosmeticContentUnlocked?: boolean;
  raid?: { featureAvailable: boolean; unlockStageId: string; unlocked: boolean };
};

type UtilityIconName = "content" | "liveops" | "market" | "ranking" | "mail" | "settings";

const UTILITY_NAV: ReadonlyArray<{ id: UtilityIconName; route?: BattleHudRoute; label: string; icon: string }> = [
  { id: "liveops", route: "liveops", label: "이벤트", icon: utilityLiveopsIcon },
  { id: "mail", route: "mail", label: "메시지", icon: utilityMailIcon },
  { id: "content", label: "콘텐츠", icon: utilityContentIcon },
  { id: "market", route: "market", label: "거래소", icon: utilityMarketIcon },
  { id: "ranking", route: "ranking", label: "랭킹", icon: utilityRankingIcon },
  { id: "settings", route: "settings", label: "설정", icon: utilitySettingsIcon },
];

const BATTLE_RETURN_NAV = { route: "battle", label: "전투", icon: utilityBattleReturnIcon } as const;

const GROWTH_NAV = [
  { route: "character", label: "캐릭터", icon: bottomCharacterIcon },
  { route: "equipment", label: "장비", icon: bottomEquipmentIcon },
  { route: "inventory", label: "아이템", icon: bottomItemsIcon },
  { route: "skills", label: "스킬", icon: bottomSkillsIcon },
  { route: "gems", label: "보석", icon: bottomGemsIcon },
] as const;

export function BattleUtilityNavigation({ onNavigate, activeRoute, gemContentUnlocked, cosmeticContentUnlocked = false, raid = { featureAvailable: false, unlockStageId: "", unlocked: false } }: NavigationProps) {
  const [contentOpen, setContentOpen] = useState(false);
  /* 레드닷은 '아직 읽지 않은 것'만 뜻한다. 보상을 아직 받지 않았다는 이유만으로
     계속 켜 두면 메시지를 모두 확인해도 사라지지 않아 읽음 표시로 쓸 수 없다. */
  const mails = useQuery({ queryKey: ["mails"], queryFn: () => mailApi.list(), retry: false, staleTime: 30_000 });
  const notices = useQuery({ queryKey: ["notices"], queryFn: () => noticeApi.list(), retry: false, staleTime: 30_000 });
  const unreadMail = giftMailOnly(mails.data?.items ?? []).filter((mail) => mail.readAt == null).length
    + (notices.data?.unreadCount ?? 0);
  /* 매물이 팔리면 쌀이, 사 둔 물건이 도착하면 물품이 거래소에 쌓인다. 둘 다 받으러
     들어가야 하는 일이라, 기다리는 것이 있다는 것만 단추에서 알린다. */
  const market = useQuery({ queryKey: ["market-summary"], queryFn: marketApi.summary, retry: false, staleTime: 30_000 });
  const marketWaiting = (market.data?.claimableDeliveries ?? 0) + (market.data?.claimableSettlements ?? 0);
  /* 이벤트 단추를 띄우는 조건은 LiveopsScreen 이 화면을 쓸 수 있다고 보는 조건과 같아야 한다
     (`state.open || state.ticketBalance > 0`). 어긋나면 눌러도 "진행 중인 이벤트가 없습니다"만
     나오는 막다른 단추가 생긴다. 기간이 끝나도 남은 티켓은 계속 쓸 수 있어 잔액도 함께 본다. */
  const liveops = useQuery({ queryKey: ["liveops-state"], queryFn: () => liveopsApi.state(), retry: false, staleTime: 30_000 });
  const liveopsUsable = liveops.data ? liveops.data.open || liveops.data.ticketBalance > 0 : false;
  const liveopsTickets = liveops.data?.ticketBalance ?? 0;
  const hasBattleReturn = activeRoute && activeRoute !== "battle";
  const utility = UTILITY_NAV.filter((item) => item.id !== "liveops" || liveopsUsable);
  const items = hasBattleReturn ? [BATTLE_RETURN_NAV, ...utility] : utility;

  useEffect(() => {
    if (!contentOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setContentOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [contentOpen]);

  return <>
    <nav
      className={`cozy-utility-nav${hasBattleReturn ? " has-battle-return" : ""}`}
      aria-label="주요 관리 메뉴"
      style={{ "--cozy-utility-columns": items.length } as CSSProperties}
    >
      {items.map((item) => {
        if (!("id" in item)) return <button
          key={item.route}
          type="button"
          data-route={item.route}
          className={[item.route === activeRoute ? "active" : "", "battle-return"].filter(Boolean).join(" ")}
          aria-current={item.route === activeRoute ? "page" : undefined}
          aria-label={item.label}
          onPointerEnter={() => preloadScreenChunk(item.route)}
          onFocus={() => preloadScreenChunk(item.route)}
          onClick={() => onNavigate(item.route)}
        >
          <img src={item.icon} alt="" />
        </button>;

        const contentActive = item.id === "content" && (activeRoute === "cosmetics" || activeRoute === "dungeon" || activeRoute === "raid");
        const active = contentActive || item.route === activeRoute;
        return <button
          key={item.id}
          type="button"
          data-route={item.id}
          className={active ? "active" : undefined}
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          aria-expanded={item.id === "content" ? contentOpen : undefined}
          onPointerEnter={() => item.route && preloadScreenChunk(item.route)}
          onFocus={() => item.route && preloadScreenChunk(item.route)}
          onClick={() => {
            if (item.id === "content") setContentOpen((value) => !value);
            else if (item.route) { setContentOpen(false); onNavigate(item.route); }
          }}
        >
          <img className="cozy-utility-art" src={item.icon} alt="" />
          {item.id === "mail" && unreadMail > 0 && <span className="cozy-utility-dot" aria-hidden="true" />}
          {item.id === "market" && marketWaiting > 0 && <span className="cozy-utility-dot" aria-hidden="true" />}
          {item.id === "liveops" && liveopsTickets > 0 && <span className="cozy-utility-dot" aria-hidden="true" />}
        </button>;
      })}
    </nav>
    {contentOpen && <nav className="cozy-content-dropdown" aria-label="콘텐츠 메뉴">
      <button type="button" disabled={!cosmeticContentUnlocked} data-disabled-reason="1-5 클리어 시 해금" title={!cosmeticContentUnlocked ? "1-5 최초 클리어 후 해금됩니다." : undefined} onClick={() => { setContentOpen(false); onNavigate("cosmetics"); }}><img src={contentAppearanceIcon} alt="" /><span>치장 뽑기</span><i aria-hidden="true" /></button>
      <button type="button" disabled={gemContentUnlocked === false} data-disabled-reason="1-5 클리어 시 해금" title={gemContentUnlocked === false ? "1-5 최초 클리어 후 해금됩니다." : undefined} onClick={() => { setContentOpen(false); onNavigate("dungeon"); }}><img src={contentDungeonIcon} alt="" /><span>던전</span><i aria-hidden="true" /></button>
      <button type="button" disabled={!raid.featureAvailable || !raid.unlocked} data-disabled-reason={!raid.featureAvailable ? "준비중" : `${raid.unlockStageId || "해당 스테이지"} 클리어 시 해금`} title={!raid.featureAvailable ? "준비중" : !raid.unlocked ? `${raid.unlockStageId || "해당 스테이지"} 클리어 시 해금` : undefined} onClick={() => { setContentOpen(false); onNavigate("raid"); }}><img src={contentRaidIcon} alt="" /><span>레이드</span><i aria-hidden="true" /></button>
    </nav>}
  </>;
}

export function BattleGrowthNavigation({ onNavigate, activeRoute, gemContentUnlocked }: NavigationProps) {
  return <nav className="cozy-growth-nav cozy-paper" aria-label="성장 메뉴">
    {GROWTH_NAV.map((item, index) => {
      /* 조회가 끝나기 전 버튼을 잠가 버리면 정상 계정도 첫 클릭이 먹지 않는다.
         명시적으로 잠김을 확인한 경우에만 막고, 보석 화면 자체가 최종 상태를 안내한다. */
      const disabled = item.route === "gems" && gemContentUnlocked === false;
      const active = !disabled && (item.route === activeRoute || (activeRoute === undefined && index === 0));
      return <button
        key={item.route}
        type="button"
        data-route={item.route}
        className={active ? "active" : undefined}
        aria-current={active ? "page" : undefined}
        aria-label={disabled ? `${item.label} 1-5 해금` : item.label}
        data-disabled-reason={disabled ? "1-5 클리어 시 해금" : undefined}
        disabled={disabled}
        title={disabled ? `${item.label}: 1-5 최초 클리어 후 해금됩니다.` : undefined}
        onPointerEnter={() => !disabled && preloadScreenChunk(item.route)}
        onFocus={() => !disabled && preloadScreenChunk(item.route)}
        onClick={() => !disabled && onNavigate(item.route)}
      >
        <img src={disabled ? bottomGemsLockedIcon : item.icon} alt="" />
        <span>{item.label}</span>
      </button>;
    })}
  </nav>;
}

/* 장비·스킬·보석을 바꿔도 진행 중인 스테이지에는 반영되지 않는다. 전투는 시작할 때
   한 번에 계산되기 때문이다. 바꾼 걸 지금 적용하고 싶은 사람을 위해 스테이지를 다시
   여는 버튼을 성장 메뉴 옆에 둔다. 잡은 몬스터의 보상은 이미 지급돼 남는다. */
export function BattleStageRestartButton() {
  const [restarting, setRestarting] = useState(false);

  return <button
    type="button"
    className="cozy-stage-restart"
    aria-label="스테이지 재시작"
    title="스테이지 재시작: 바꾼 장비와 스킬을 지금 적용합니다."
    disabled={restarting}
    onClick={async () => {
      setRestarting(true);
      try {
        await restartActiveBattle();
      } finally {
        setRestarting(false);
      }
    }}
  >
    <img src={stageResetIcon} alt="" aria-hidden="true" />
    <span>재시작</span>
  </button>;
}

export function BattleProfileSummary({ account, onOpen, triggerRef }: { account: AccountIdentity | null; onOpen: () => void; triggerRef?: RefObject<HTMLButtonElement | null> }) {
  const appearance = useOwnCosmeticAppearance(Boolean(account));
  const fallbackAvatar = <img className="cozy-profile-avatar" src={chopstickHeadIcon} alt="" />;
  return <button ref={triggerRef} type="button" className="cozy-profile-summary cozy-paper" onPointerEnter={() => preloadScreenChunk("profile")} onFocus={() => preloadScreenChunk("profile")} onClick={onOpen} aria-label="내 정보 열기">
    <CosmeticHero
      className="cozy-profile-avatar"
      equipment={appearance.equipment}
      catalog={appearance.catalog}
      alt={`${account?.nickname ?? "한짝"} 프로필`}
      fallback={fallbackAvatar}
    />
    <span className="cozy-profile-copy">
      <strong>{account?.nickname ?? "한짝"}</strong>
      <small><span className="cozy-rice-coin" style={{ "--cozy-profile-icons": `url(${profileIcons})` } as CSSProperties} role="img" aria-label="쌀" />{(account?.rice ?? 0).toLocaleString()}</small>
    </span>
  </button>;
}

export function CozySharedNavigation({ account, activeRoute, onOpenProfile, onNavigate, profileTriggerRef, gemContentUnlocked, cosmeticContentUnlocked = false, topBarOnly = false, raid }: {
  account: AccountIdentity | null;
  activeRoute: BattleHudRoute;
  onOpenProfile: () => void;
  onNavigate: NavigationProps["onNavigate"];
  profileTriggerRef?: RefObject<HTMLButtonElement | null>;
  gemContentUnlocked?: boolean;
  cosmeticContentUnlocked?: boolean;
  topBarOnly?: boolean;
  raid?: NavigationProps["raid"];
}) {
  return <div className={`cozy-shared-navigation${topBarOnly ? " is-top-bar-only" : ""}`}>
    {!topBarOnly && <BattleProfileSummary account={account} onOpen={onOpenProfile} triggerRef={profileTriggerRef} />}
    <BattleUtilityNavigation activeRoute={activeRoute} onNavigate={onNavigate} gemContentUnlocked={gemContentUnlocked} cosmeticContentUnlocked={cosmeticContentUnlocked} raid={raid} />
    {!topBarOnly && <BattleGrowthNavigation activeRoute={activeRoute} onNavigate={onNavigate} gemContentUnlocked={gemContentUnlocked} />}
  </div>;
}

const HISTORY_LABELS: Record<BattleHistoryEvent["type"], string> = {
  STAGE_ENTERED: "스테이지 입장",
  STAGE_CLEARED: "승리",
  STAGE_FAILED: "패배",
  DUNGEON_ENTERED: "던전 입장",
  RETURNED: "전투 복귀",
};

function historyIcon(event: BattleHistoryEvent): string {
  if (event.type === "STAGE_CLEARED") return stageVictoryIcon;
  return stageFailureIcon;
}

export function BattleHistoryPopoverItem({ event }: { event: BattleHistoryEvent }) {
  const snapshot = event.combatSnapshot;
  const enteredAt = battleHistoryStageEnteredAt(event);
  const finalBossStage = event.stageId?.endsWith("-10") ?? false;
  return <li className={`is-${event.type.toLowerCase()}`}>
    <img src={historyIcon(event)} alt="" />
    <div>
      <header className="cozy-history-entry-header">
        <p><strong>{HISTORY_LABELS[event.type]}</strong><b>{battleHistoryTargetLabel(event)}</b></p>
        <time dateTime={event.occurredAt}>
          <small>{event.type === "STAGE_CLEARED" ? "클리어 시각" : "패배 시각"}</small>
          <b>{battleHistoryDateTime(event.occurredAt)}</b>
        </time>
      </header>
      {snapshot && <dl className="cozy-history-result" aria-label="전투 결과 요약">
        {enteredAt && <div><dt>입장</dt><dd>{battleHistoryDateTime(enteredAt)}</dd></div>}
        {snapshot.elapsedTicks !== undefined && <div><dt>소요</dt><dd>{battleHistoryDuration(snapshot.elapsedTicks)}</dd></div>}
        {snapshot.remainingHp !== undefined && <div><dt>남은 HP</dt><dd>{snapshot.remainingHp.toLocaleString()}</dd></div>}
        {event.type === "STAGE_FAILED" && <div><dt>원인</dt><dd>{battleHistoryResultLabel(event)}</dd></div>}
        {event.type === "STAGE_FAILED" && snapshot.defeatedNormals !== undefined && <div><dt>처치</dt><dd>{finalBossStage ? "일반 몬스터 없음" : `${snapshot.defeatedNormals.toLocaleString()} / 20`}</dd></div>}
        {event.type === "STAGE_FAILED" && snapshot.lastEnemyRemainingHp !== undefined && <div><dt>상대 HP</dt><dd>{snapshot.lastEnemyRemainingHp.toLocaleString()}</dd></div>}
      </dl>}
      {snapshot && <BattleHistoryGains event={event} compact />}
      {snapshot?.rewards && snapshot.rewards.length > 0 && <small className="cozy-history-reward-items">
        <b>지급 아이템</b>
        <span>{snapshot.rewards.filter((reward) => reward.quantity > 0).map((reward) => `${reward.displayName} +${reward.quantity.toLocaleString()}`).join(" · ")}</span>
      </small>}
    </div>
  </li>;
}

export function BattleHistoryPopover() {
  const [open, setOpen] = useState(false);
  const history = useQuery({ queryKey: ["battle-history"], queryFn: battleApi.history, retry: false, enabled: open });
  const results = battleHistoryResultEvents(history.data);

  return <div className={`cozy-history ${open ? "is-open" : ""}`}>
    <button type="button" className="cozy-history-trigger cozy-paper" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <img src={stageHistoryIcon} alt="" />
      <span>전투 기록</span>
      <b aria-hidden="true"><i className={`cozy-chevron ${open ? "is-previous" : "is-next"}`} /></b>
    </button>
    {open && <section className="cozy-history-panel cozy-paper" aria-labelledby="cozy-history-title">
      <header>
        <div><h3 id="cozy-history-title">전투 기록</h3><span>최근 승패 기록 {results.length} / 50</span></div>
        {/* 다른 창과 같은 닫기 그림을 쓴다. */}
        <button type="button" className="cozy-history-close" onClick={() => setOpen(false)} aria-label="전투 기록 닫기">
          <img src={paperCloseButton} alt="" aria-hidden="true" />
        </button>
      </header>
      {history.isLoading && <p className="cozy-history-message" role="status">기록을 불러오는 중입니다.</p>}
      {history.error && <p className="cozy-history-message" role="alert">기록을 불러오지 못했습니다. <button type="button" onClick={() => history.refetch()}>다시 시도</button></p>}
      {history.data && results.length === 0 && <p className="cozy-history-message">아직 완료된 전투 기록이 없습니다.</p>}
      {results.length > 0 && <ol>
        {results.slice(0, 50).map((event) => <BattleHistoryPopoverItem key={event.eventId} event={event} />)}
      </ol>}
    </section>}
  </div>;
}

type StageProgressProps = {
  stages: StageSummary[];
  selectedStageId: string;
  remainingSeconds: number | null;
  defeatedNormals: number;
  bossOnly: boolean;
  bossPhase: boolean;
  stageComplete: boolean;
  idleMode: "AUTO_PROGRESS" | "REPEAT_STAGE";
  pendingIdleMode?: "AUTO_PROGRESS" | "REPEAT_STAGE" | null;
  idleModeSaving: boolean;
  repeatEligible: boolean;
  bossHealth?: { name: string; hp: number; maxHp: number } | null;
  onSelectStage: (stageId: string) => void;
  onChangeMode: (mode: "AUTO_PROGRESS" | "REPEAT_STAGE") => void;
};

export type StageSelectItem = {
  stageId: string;
  label: string;
  order: number;
  clearCount: number;
  state: "default" | "current" | "cleared" | "locked";
};

export type StagePanelViewModel = {
  stageLabel: string;
  chapterNumber: number;
  chapterName: string;
  timer: { kind: "timed"; remainingSeconds: number } | { kind: "unlimited" };
  progress:
    | { kind: "normal"; defeated: number; total: 20 }
    | { kind: "boss"; name: string; hp: number; maxHp: number };
  stages: StageSelectItem[];
};

/** 서버·전투 상태를 Figma 패널이 소비하는 표시 상태로만 바꾼다. */
export function stagePanelViewModel(props: Pick<StageProgressProps, "stages" | "selectedStageId" | "remainingSeconds" | "defeatedNormals" | "bossOnly" | "bossPhase" | "stageComplete" | "bossHealth">): StagePanelViewModel {
  const chapter = chapterOfStage(props.selectedStageId);
  const chapterStages = props.stages.filter((stage) => chapterOfStage(stage.stageId) === chapter);
  const safeRemaining = Math.max(0, Math.ceil(props.remainingSeconds ?? 0));
  const defeated = Math.max(0, Math.min(20, props.defeatedNormals));
  const bossMaxHp = Math.max(1, props.bossHealth?.maxHp ?? 1);
  const bossHp = Math.max(0, Math.min(props.bossHealth?.hp ?? 0, bossMaxHp));

  return {
    stageLabel: `STAGE ${formatStageId(props.selectedStageId)}`,
    chapterNumber: chapter,
    chapterName: CHAPTERS.find((entry) => entry.chapter === chapter)?.name ?? "",
    timer: props.remainingSeconds === null ? { kind: "unlimited" } : { kind: "timed", remainingSeconds: safeRemaining },
    progress: props.bossHealth
      ? { kind: "boss", name: props.bossHealth.name, hp: bossHp, maxHp: bossMaxHp }
      : { kind: "normal", defeated: props.bossOnly ? Number(props.stageComplete) * 20 : defeated, total: 20 },
    stages: chapterStages.map((stage, order) => ({
      stageId: stage.stageId,
      label: formatStageId(stage.stageId),
      order,
      clearCount: stage.clearCount,
      state: !stage.unlocked ? "locked" : stage.stageId === props.selectedStageId ? "current" : stage.clearCount > 0 ? "cleared" : "default",
    })),
  };
}

export function battleRemainingSeconds(durationMilliseconds: number, tickDurationMilliseconds: number, elapsedTicks: number): number {
  const remainingMilliseconds = durationMilliseconds - Math.max(0, elapsedTicks) * Math.max(1, tickDurationMilliseconds);
  return Math.max(0, Math.floor(remainingMilliseconds / 1_000));
}

/**
 * 남은 시간은 전투 틱이 아니라 시계로 센다. 틱은 사건이 올 때만 움직이고 화면이
 * 예전 사건으로 되돌아가면 뒤로도 가서, 48초였다가 49초가 되는 일이 있었다.
 */
export function battleRemainingSecondsAt(completableAt: string | null | undefined, now: number): number {
  const deadline = completableAt ? Date.parse(completableAt) : Number.NaN;
  if (Number.isNaN(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}

/** 초 단위가 실제로 바뀔 때만 다시 그린다. */
export function useSecondsClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
export function useCountdownSeconds(active: boolean, durationMilliseconds: number, resetKey: string | null | undefined): number | null {
  const now = useSecondsClock(active);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    setDeadline(active ? Date.now() + Math.max(0, durationMilliseconds) : null);
  }, [active, durationMilliseconds, resetKey]);
  if (!active) return null;
  return Math.max(0, Math.ceil(((deadline ?? now + durationMilliseconds) - now) / 1_000));
}


export function BattleStageProgress({ stages, selectedStageId, remainingSeconds, defeatedNormals, bossOnly, bossPhase, stageComplete, idleMode, pendingIdleMode, idleModeSaving, repeatEligible, bossHealth, onSelectStage, onChangeMode }: StageProgressProps) {
  /* 어느 챕터로 갈지는 챕터 화면이, 그 안 몇 번째 칸을 돌지는 아래 목록이 맡는다. */
  const [chapterOpen, setChapterOpen] = useState(false);
  const [stageListOpen, setStageListOpen] = useState(false);
  const stagePicker = useRef<HTMLDetailsElement>(null);
  const stagePickerPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stageListOpen) return;
    const close = () => setStageListOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!stagePicker.current?.contains(target) && !stagePickerPanel.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      stagePicker.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [stageListOpen]);
  const view = stagePanelViewModel({ stages, selectedStageId, remainingSeconds, defeatedNormals, bossOnly, bossPhase, stageComplete, bossHealth });
  const finalBossStage = bossOnly;
  const displayedIdleMode = pendingIdleMode ?? idleMode;
  const progress = Math.max(0, Math.min(20, defeatedNormals));
  const progressMax = finalBossStage ? 1 : 20;
  const progressValue = finalBossStage ? Number(stageComplete) : progress;
  const normalProgress = view.progress.kind === "normal" ? view.progress.defeated : 0;
  return <>
    <div className="cozy-stage-cluster">
      <section className="cozy-stage-progress" aria-label="현재 스테이지 진행">
      <div className="cozy-stage-heading">
        <strong>{view.stageLabel}</strong>
        <time aria-label={view.timer.kind === "timed" ? `보스 남은 제한시간 ${view.timer.remainingSeconds}초` : "제한시간 없음"}>
          <img src={stageTimerIcon} alt="" aria-hidden="true" />
          <small className="sr-only">남은 제한시간</small>
          <b>{view.timer.kind === "timed" ? `${String(Math.floor(view.timer.remainingSeconds / 60)).padStart(2, "0")}:${String(view.timer.remainingSeconds % 60).padStart(2, "0")}` : "제한 없음"}</b>
        </time>
      </div>
      {view.progress.kind === "boss" || finalBossStage ? <div className="cozy-stage-meter is-boss-health">
        <strong>{view.progress.kind === "boss" ? view.progress.name : "최종 보스"}</strong>
        <div className="cozy-stage-track" role="progressbar" aria-label={view.progress.kind === "boss" ? `${view.progress.name} 보스 체력` : "최종 보스 처치 진행"} aria-valuemin={0} aria-valuemax={view.progress.kind === "boss" ? view.progress.maxHp : 1} aria-valuenow={view.progress.kind === "boss" ? view.progress.hp : Number(stageComplete)}>
          <i style={{ width: `${view.progress.kind === "boss" ? view.progress.hp / view.progress.maxHp * 100 : Number(stageComplete) * 100}%` }} />
        </div>
        <b>{view.progress.kind === "boss" ? `${view.progress.hp.toLocaleString()} / ${view.progress.maxHp.toLocaleString()}` : "BOSS"}</b>
      </div> : <div className="cozy-stage-meter">
        <div className="cozy-stage-slots" role="progressbar" aria-label="일반 몬스터 처치 진행" aria-valuemin={0} aria-valuemax={progressMax} aria-valuenow={progressValue}>
          {Array.from({ length: 20 }, (_, index) => <i key={index} className={index < normalProgress ? "is-filled" : undefined} />)}
        </div>
        <b>{normalProgress} / 20</b>
      </div>}
      <div className="cozy-stage-actions">
      <button type="button" className="cozy-stage-picker-button" aria-haspopup="dialog" onPointerEnter={preloadChapterSelect} onFocus={preloadChapterSelect} onClick={() => setChapterOpen(true)}>
        <img src={stageChapterIcon} alt="" aria-hidden="true" /><span>챕터</span>
      </button>
      <details ref={stagePicker} className="cozy-stage-picker" open={stageListOpen} onToggle={(event) => setStageListOpen(event.currentTarget.open)}>
        <summary><img src={stageSelectIcon} alt="" aria-hidden="true" /><span>스테이지</span></summary>
      </details>
      <div className={`cozy-stage-mode-toggle ${displayedIdleMode === "REPEAT_STAGE" ? "is-repeat" : "is-auto"}`}>
        <button type="button" className="cozy-stage-mode" aria-label="자동 진행" aria-pressed={displayedIdleMode === "AUTO_PROGRESS"} disabled={idleModeSaving} onClick={() => onChangeMode("AUTO_PROGRESS")}>자동 진행</button>
        <button type="button" className="cozy-stage-mode" aria-label="스테이지 반복" aria-pressed={displayedIdleMode === "REPEAT_STAGE"} disabled={idleModeSaving || !repeatEligible} onClick={() => onChangeMode("REPEAT_STAGE")}>스테이지 반복</button>
      </div>
      </div>
      </section>
    </div>
    {stageListOpen && <div ref={stagePickerPanel} className="cozy-stage-picker-panel" role="dialog" aria-label="스테이지 선택">
      <header>
        <strong>CHAPTER {view.chapterNumber} · {view.chapterName}</strong>
        <span>{view.stages.filter((stage) => stage.clearCount > 0).length} / {view.stages.length}</span>
      </header>
      <ul>{view.stages.map((stage) => <li key={stage.stageId} data-state={stage.state}>
        <button
          type="button"
          className={stage.state === "current" ? "is-current" : undefined}
          disabled={stage.state === "locked"}
          aria-label={`${stage.label} ${stage.state === "locked" ? "잠김" : stage.state === "current" ? "현재 스테이지" : `클리어 ${stage.clearCount}회`}`}
          onClick={() => {
            onSelectStage(stage.stageId);
            setStageListOpen(false);
          }}
        >
          <strong>{stage.label}</strong>
          <small>{stage.state === "locked" ? "잠김" : `클리어 ${stage.clearCount}회`}</small>
        </button>
      </li>)}</ul>
    </div>}
    {chapterOpen && <Suspense fallback={null}><ChapterSelectScreen
      stages={stages}
      selectedStageId={selectedStageId}
      onSelectStage={onSelectStage}
      onClose={() => setChapterOpen(false)}
    /></Suspense>}
  </>;
}

type RewardMeta = { label: string; icon?: string };

const MATERIAL_REWARD_META: Record<string, RewardMeta> = {
  POTATO_M1: { label: "감자 한 조각", icon: potatoFragmentIcon },
  POTATO_M2: { label: "미니 감자", icon: potatoMiniIcon },
  POTATO_M3: { label: "감자", icon: potatoIcon },
  POTATO_M4: { label: "황금 감자", icon: potatoGoldenIcon },
  POTATO_M5: { label: "전설 감자", icon: potatoLegendaryIcon },
  SWEET_POTATO_M1: { label: "고구마 한 조각", icon: sweetPotatoFragmentIcon },
  SWEET_POTATO_M2: { label: "미니 고구마", icon: sweetPotatoMiniIcon },
  SWEET_POTATO_M3: { label: "고구마", icon: sweetPotatoIcon },
  SWEET_POTATO_M4: { label: "황금 고구마", icon: sweetPotatoGoldenIcon },
  SWEET_POTATO_M5: { label: "전설 고구마", icon: sweetPotatoLegendaryIcon },
  CORN_M1: { label: "옥수수 한 알", icon: cornKernelIcon },
  CORN_M2: { label: "미니 옥수수", icon: cornMiniIcon },
  CORN_M3: { label: "옥수수", icon: cornIcon },
  CORN_M4: { label: "황금 옥수수", icon: cornGoldenIcon },
  CORN_M5: { label: "전설 옥수수", icon: cornLegendaryIcon },
};

export function rewardMeta(itemId: string): RewardMeta {
  const material = MATERIAL_REWARD_META[itemId];
  if (material) return material;
  if (itemId.startsWith("POTATO")) return { label: "감자", icon: potatoIcon };
  if (itemId.startsWith("SWEET_POTATO")) return { label: "고구마", icon: sweetPotatoIcon };
  if (itemId.startsWith("CORN")) return { label: "옥수수", icon: cornIcon };
  if (itemId.startsWith("skillbook:")) {
    const [, skillId, gradeId] = itemId.split(":");
    const skillName: Record<string, string> = {
      active_heavy: "한짝의 일격",
      active_dot: "마! 쫄이나",
      active_haste: "잘게 더 잘게!",
      active_basic_amp: "화력 최대로!",
      passive_critical: "회심의 간",
      passive_all_damage: "오늘의 특선",
    };
    const gradeName: Record<string, string> = { normal: "노말", rare: "희귀", epic: "영웅", legendary: "전설" };
    const name = skillName[skillId];
    return { label: name ? `${gradeName[gradeId] ?? gradeId} ${name} 비법서` : "스킬 비법서", icon: rewardSkillbookIcon };
  }
  if (itemId.includes("SKILL") || itemId.includes("BOOK")) return { label: "스킬 비법서", icon: rewardSkillbookIcon };
  return { label: itemId };
}

type RewardEntry = { key: string; label: string; quantity: number; icon?: string; warning?: string };

export function FirstClearRewardNotice({ reward, onClose }: { reward: FirstClearRewardResult; onClose?: () => void }) {
  const lines = [
    ...(reward.riceGranted > 0 ? [{ key: "rice", name: "쌀 코인", quantity: reward.riceGranted, icon: riceIcon, pending: false }] : []),
    ...(reward.ticketsGranted > 0 ? [{ key: "ticket", name: "치장 뽑기권", quantity: reward.ticketsGranted, icon: cosmeticTicketIcon, pending: false }] : []),
    ...reward.grantedItems.map((item) => ({ key: `granted:${item.itemId}`, name: item.displayName, quantity: item.quantity, icon: rewardMeta(item.itemId).icon, pending: false })),
    ...reward.pendingItems.map((item) => ({ key: `pending:${item.itemId}`, name: item.displayName, quantity: item.quantity, icon: rewardMeta(item.itemId).icon, pending: true })),
  ];
  return <div className="cozy-first-clear-backdrop" onMouseDown={(event) => onClose && event.target === event.currentTarget && onClose()}>
    <section className="cozy-first-clear-notice" role="dialog" aria-modal="true" aria-labelledby="cozy-first-clear-title">
      {onClose && <button type="button" className="cozy-first-clear-close" aria-label="최초 클리어 보상 닫기" onClick={onClose}>
        <img src={paperCloseButton} alt="" aria-hidden="true" />
      </button>}
      <h2 id="cozy-first-clear-title"><img src={trophyIcon} alt="" aria-hidden="true" />최초 클리어 보상</h2>
      <p className="cozy-first-clear-stage">STAGE {formatStageId(reward.stageId)}</p>

      <div className="cozy-first-clear-scroll">
        <ul className="cozy-first-clear-lines">{lines.map((line) => <li key={line.key} className={line.pending ? "is-pending" : undefined}>
          {line.icon ? <img src={line.icon} alt="" aria-hidden="true" /> : <i aria-hidden="true" />}
          <strong>{line.name}</strong>
          <b>+{line.quantity.toLocaleString()}</b>
          {line.pending && <small>받기함</small>}
        </li>)}
        {lines.length === 0 && <li className="is-empty"><strong>지급된 보상이 없습니다.</strong></li>}
        </ul>
      </div>

      <footer className="cozy-first-clear-foot">
        <p className="cozy-first-clear-bag">
          <img src={bottomItemsIcon} alt="" aria-hidden="true" />
          <span>가방 여유 <b>{reward.availableSlots.toLocaleString()}</b>칸<small>보상은 가방으로 바로 지급됩니다.</small></span>
        </p>
      </footer>
    </section>
  </div>;
}

export function BattleRewards({ stageId, rice, rewards }: { stageId: string; rice: number; rewards: RewardLine[] }) {
  const [open, setOpen] = useState(true);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetBaseline, setResetBaseline] = useState<Record<string, number>>({});
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setResetBaseline({}); setResetConfirmOpen(false); }, [stageId]);
  const entries = useMemo<RewardEntry[]>(() => {
    const riceAfterReset = Math.max(0, rice - (resetBaseline.rice ?? 0));
    const lines: RewardEntry[] = riceAfterReset > 0 ? [{ key: "rice", label: "쌀", quantity: riceAfterReset, icon: riceIcon }] : [];
    for (const reward of rewards) {
      const meta = rewardMeta(reward.itemId);
      const quantity = Math.max(0, reward.grantedQuantity - (resetBaseline[reward.itemId] ?? 0));
      if (quantity === 0) continue;
      lines.push({
        key: reward.itemId,
        label: meta.label,
        quantity,
        icon: meta.icon,
        warning: reward.discardedQuantity > 0 || (reward.skippedQuantity ?? 0) > 0 ? "공간 부족으로 일부 미지급" : undefined,
      });
    }
    return lines;
  }, [resetBaseline, rewards, rice]);

  const resetRewards = () => {
    const baseline: Record<string, number> = { rice };
    rewards.forEach((reward) => { baseline[reward.itemId] = reward.grantedQuantity; });
    setResetBaseline(baseline);
    setResetConfirmOpen(false);
  };

  useEffect(() => {
    if (!resetConfirmOpen) return;
    cancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setResetConfirmOpen(false); }
      if (event.key !== "Tab") return;
      const buttons = [document.querySelector<HTMLButtonElement>(".cozy-reward-reset-confirm"), cancelButton.current].filter(Boolean) as HTMLButtonElement[];
      if (buttons.length !== 2) return;
      const next = event.shiftKey ? buttons[0] : buttons[1];
      const wrap = event.shiftKey ? buttons[1] : buttons[0];
      if (document.activeElement === next) { event.preventDefault(); wrap.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetConfirmOpen]);

  useEffect(() => {
    if (!resetConfirmOpen) resetButton.current?.focus();
  }, [resetConfirmOpen]);

  return <section className={`cozy-rewards cozy-paper ${open ? "is-open" : "is-collapsed"}`} aria-label="획득 보상">
    <div className="cozy-reward-head">
      <span>획득한 보상</span>
      <b className="cozy-reward-count" aria-label={`${entries.length}종 획득`}>{entries.length}</b>
      <button ref={resetButton} type="button" className="cozy-reward-reset" aria-label="획득 보상 초기화" disabled={entries.length === 0} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setResetConfirmOpen(true); }} />
    </div>
    <button
      type="button"
      className="cozy-reward-fold"
      aria-label={open ? "획득 보상 접기" : "획득 보상 펼치기"}
      aria-expanded={open}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}
    />
    {entries.length > 0 ? <ul className={entries.length > 3 ? "is-scrollable" : ""}>
      {entries.map((entry) => <li key={entry.key}>
        <span className="cozy-reward-icon">{entry.key === "rice"
          ? <span className="cozy-rice-coin" style={{ "--cozy-profile-icons": `url(${profileIcons})` } as CSSProperties} role="img" aria-label="쌀" />
          : entry.icon ? <img src={entry.icon} alt="" /> : <b aria-hidden="true">·</b>}</span>
        <strong title={entry.label}>{entry.label}</strong>
        <em>+{entry.quantity.toLocaleString()}</em>
        {entry.warning && <small>{entry.warning}</small>}
      </li>)}
    </ul> : <div className="cozy-rewards-empty"><img src={rewardsEmptyIcon} alt="" /><span>아직 획득한 보상이 없습니다.</span></div>}
    {resetConfirmOpen && createPortal(<div className="cozy-reward-reset-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetConfirmOpen(false); }}>
      <section className="cozy-reward-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="cozy-reward-reset-message">
        <img className="cozy-reward-reset-dialog-shell" src={rewardResetDialog} alt="" />
        <img className="cozy-reward-reset-pouch" src={rewardResetPouch} alt="" />
        <p id="cozy-reward-reset-message">획득한 보상 목록을 비울까요?</p>
        <button type="button" className="cozy-reward-reset-confirm" onClick={resetRewards}><img src={rewardResetConfirm} alt="" /><span>비우기</span></button>
        <button ref={cancelButton} type="button" className="cozy-reward-reset-cancel" onClick={() => setResetConfirmOpen(false)}><img src={rewardResetCancel} alt="" /><span>취소</span></button>
      </section>
    </div>, document.body)}
  </section>;
}

function MeterRow({ label, current, max, percent, value, tone, compact = false }: { label: string; current: number; max: number; percent: number; value: ReactNode; tone: "hp" | "exp"; compact?: boolean }) {
  const fill = Math.max(0, Math.min(100, percent));
  return <div className={`cozy-status-row ${tone}`}>
    <div className="cozy-status-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(1, max)} aria-valuenow={Math.max(0, Math.min(current, max))}>
      <i className="cozy-status-fill" style={{ width: `${fill}%` }}><i className="start" /><i className="body" /><i className="end" /></i>
    </div>
    <span className={compact ? "is-compact" : undefined}>{value}</span>
  </div>;
}

export function BattlePlayerStatus({ level, hp, maxHp, experience, experienceRequired, experiencePercent }: { level: number; hp: number; maxHp: number; experience: number; experienceRequired: number; experiencePercent: number }) {
  const hpValue = maxHp > 0 ? `${hp.toLocaleString()} / ${maxHp.toLocaleString()}` : "-";
  const expValue = level >= 500 ? "MAX" : `${experiencePercent}% (${experience.toLocaleString()} / ${experienceRequired.toLocaleString()})`;
  return <section className="cozy-player-status cozy-paper" aria-label="캐릭터 전투 상태">
    <div className="cozy-level"><strong>{level.toLocaleString()}</strong></div>
    <div className="cozy-status-bars">
      <MeterRow label="HP" current={hp} max={maxHp} percent={maxHp > 0 ? hp / maxHp * 100 : 0} value={hpValue} compact={hpValue.length > 23} tone="hp" />
      <MeterRow label="EXP" current={experience} max={experienceRequired} percent={experiencePercent} value={level >= 500 ? "MAX" : <><strong>{experiencePercent}%</strong> ({experience.toLocaleString()} / {experienceRequired.toLocaleString()})</>} compact={expValue.length > 29} tone="exp" />
    </div>
  </section>;
}
