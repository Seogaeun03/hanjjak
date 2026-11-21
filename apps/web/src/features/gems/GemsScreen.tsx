import { layout, prepare, type PreparedText } from "@chenglou/pretext";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillsApi } from "../skills/api";
import { gemDungeonsApi, gemsApi, type GemDungeonChallenge, type GemDungeonCombatEvent, type GemDungeonToday, type GemPreset, type GemState } from "./api";
import { AngelDungeonCharacter } from "./AngelDungeonCharacter";
import { PlayerBattleCharacter } from "./PlayerBattleCharacter";
import { cosmeticsApi, type Catalog, type Collection } from "../cosmetics/api";
import { angelWeaponIds, basicLoadout, defaultAngelLoadout, dungeonMotionForEvent, equipmentSlots, motionFrameDurations, type DungeonMotionSelection, type EquippedAppearance } from "./angelEquipment";
import { SkillVfxSprite, skillVfxForEvents } from "./skillVfx";
import { serverNow } from "../../shared/serverClock";
import { damageText } from "../battle/battleVisuals";
import { SKILL_COOLDOWN_TICKS } from "../battle/skillCooldown";
import { GemManagementWindow } from "./GemManagement";

import dungeonBook from "./assets-cozy-pixel-v2/dungeon-selection-book.png";
import udonBookmark from "./assets-cozy-pixel-v2/ui/bookmark-udon.png";
import quailBookmark from "./assets-cozy-pixel-v2/ui/bookmark-quail-egg-jangjorim.png";
import acornBookmark from "./assets-cozy-pixel-v2/ui/bookmark-acorn-jelly.png";
import dungeonTabSheet from "./assets-cozy-pixel-v2/ui/dungeon-tabs-v3.png";
import openRibbon from "./assets-cozy-pixel-v2/ui/dungeon-open-ribbon-v1.png";
import udonKeyArt from "./assets-cozy-pixel-v2/bosses/udon/keyart.png";
import quailKeyArt from "./assets-cozy-pixel-v2/bosses/quail-egg-jangjorim/keyart.png";
import acornKeyArt from "./assets-cozy-pixel-v2/bosses/acorn-jelly/keyart.png";
import udonSpriteSheet from "./assets-cozy-pixel-v2/bosses/udon/sprite-sheet-4x5.png";
import quailSpriteSheet from "./assets-cozy-pixel-v2/bosses/quail-egg-jangjorim/sprite-sheet-4x5.png";
import acornSpriteSheet from "./assets-cozy-pixel-v2/bosses/acorn-jelly/sprite-sheet-4x5.png";
import udonAttackSheet from "./assets-cozy-pixel-v2/effects/udon-attack-sheet-4x2.png";
import quailAttackSheet from "./assets-cozy-pixel-v2/effects/quail-egg-jangjorim-attack-sheet-4x2.png";
import acornAttackSheet from "./assets-cozy-pixel-v2/effects/acorn-jelly-attack-sheet-4x2.png";
import udonBattleBackground from "./assets-cozy-pixel-v2/backgrounds/battle-udon.png";
import quailBattleBackground from "./assets-cozy-pixel-v2/backgrounds/battle-quail-egg-jangjorim.png";
import acornBattleBackground from "./assets-cozy-pixel-v2/backgrounds/battle-acorn-jelly.png";
import ticketIcon from "./assets-cozy-pixel-v2/icons/icon-entry-ticket.png";
import chestIcon from "./assets-cozy-pixel-v2/icons/icon-gem-chest.png";
import broomIcon from "./assets-cozy-pixel-v2/icons/icon-sweep-broom.png";
import lockIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-lock-large-v1.png";
import openClockIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-open-clock-v1.png";
import openSunIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-open-sun-v1.png";
import rankGoldIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-rank-gold-v1.png";
import rankSilverIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-rank-silver-v1.png";
import rankBronzeIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-rank-bronze-v1.png";
import udonTabIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-tab-udon-v1.png";
import quailTabIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-tab-quail-egg-v1.png";
import acornTabIcon from "./assets-cozy-pixel-v2/icons/icon-dungeon-tab-acorn-v1.png";
import challengeButtonShell from "./assets-cozy-pixel-v2/ui/dungeon-challenge-button-v1.png";
import sweepButtonShell from "./assets-cozy-pixel-v2/ui/dungeon-sweep-button-v1.png";
import victoryBadge from "./assets-cozy-pixel-v2/ui/result-victory-badge.png";
import defeatBadge from "./assets-cozy-pixel-v2/ui/result-defeat-badge.png";
import skillCardShell from "./assets-cozy-pixel-v2/ui/skill-card-shell.png";
import battleTimerShell from "./assets-cozy-pixel-v2/ui/battle-timer-shell.png";
import activeHasteIcon from "../skills/assets-cozy-pixel/skill-active-haste.png";
import activeBasicAmpIcon from "../skills/assets-cozy-pixel/skill-active-basic-amp.png";
import activeHeavyIcon from "../skills/assets-cozy-pixel/skill-active-heavy.png";
import activeDotIcon from "../skills/assets-cozy-pixel/skill-active-dot.png";
import "../../shared/domain-panel.css";
import "./gems-dungeon.css";
import "./DungeonSelection.css";

type DungeonBoss = Exclude<GemPreset, "MAIN">;

/* 서버의 hanjjak.gem-dungeon.ticket.max-stock 과 같은 값. 아직 응답에 실려 오지 않아
   화면이 따로 들고 있다. 정책이 다시 바뀌면 여기도 같이 고쳐야 한다. */
const DUNGEON_TICKET_MAX = 3;
const bossTypeNames: Record<GemPreset, string> = { MAIN: "메인", SURVIVAL: "생존형", BERSERK: "폭주형", ARMORED: "장갑형" };
const dungeonBossNames: Record<GemPreset, string> = { MAIN: "우동 몬스터", SURVIVAL: "우동 몬스터", BERSERK: "메추리알 장조림 몬스터", ARMORED: "도토리묵 몬스터" };
const dungeonTabNames: Record<DungeonBoss, string> = { SURVIVAL: "우동", BERSERK: "메추리알 장조림", ARMORED: "도토리묵" };
const dungeonBosses: DungeonBoss[] = ["SURVIVAL", "BERSERK", "ARMORED"];
const eventNames: Record<GemDungeonCombatEvent["type"], string> = {
  BATTLE_START: "전투 시작", SKILL_CAST: "스킬 사용", PLAYER_HIT: "공격 적중", DOT_HIT: "지속 피해",
  BOSS_HIT: "보스 공격", SURVIVAL_STRIKE: "회피 불가 강타", VICTORY: "승리", DEFEAT: "패배",
};
const skillNames: Record<string, string> = { active_haste: "잘게 더 잘게!", active_basic_amp: "화력 최대로!", active_heavy: "한짝의 일격", active_dot: "마! 쫄이나" };
const skillIcons: Record<string, string> = { active_haste: activeHasteIcon, active_basic_amp: activeBasicAmpIcon, active_heavy: activeHeavyIcon, active_dot: activeDotIcon };
/** Each line states the rule the dungeon actually checks: survival tanks a strike every two
 *  seconds, berserk has no defense, and armored scales defense so penetration decides the run. */
const bossDescriptions: Record<GemPreset, string> = {
  MAIN: "15초 동안 보스의 강타를 버텨내는 생존력 던전입니다.",
  SURVIVAL: "15초 동안 보스의 강타를 버텨내는 생존력 던전입니다.",
  BERSERK: "15초 안에 보스를 처치하는 순수 공격력 던전입니다.",
  ARMORED: "방어력 높은 보스를 15초 안에 처치하는 방어 관통 던전입니다.",
};
const bossVisuals: Record<GemPreset, { bookmark: string; keyArt: string; spriteSheet: string; background: string; attackSheet: string }> = {
  MAIN: { bookmark: udonBookmark, keyArt: udonKeyArt, spriteSheet: udonSpriteSheet, background: udonBattleBackground, attackSheet: udonAttackSheet },
  SURVIVAL: { bookmark: udonBookmark, keyArt: udonKeyArt, spriteSheet: udonSpriteSheet, background: udonBattleBackground, attackSheet: udonAttackSheet },
  BERSERK: { bookmark: quailBookmark, keyArt: quailKeyArt, spriteSheet: quailSpriteSheet, background: quailBattleBackground, attackSheet: quailAttackSheet },
  ARMORED: { bookmark: acornBookmark, keyArt: acornKeyArt, spriteSheet: acornSpriteSheet, background: acornBattleBackground, attackSheet: acornAttackSheet },
};
const dungeonTabVisuals: Record<DungeonBoss, { position: string; icon: string }> = {
  SURVIVAL: { position: "0%", icon: udonTabIcon },
  BERSERK: { position: "50%", icon: quailTabIcon },
  ARMORED: { position: "100%", icon: acornTabIcon },
};
const dungeonRankIcons = [rankGoldIcon, rankSilverIcon, rankBronzeIcon] as const;

/** The boss attack sheets are 4 x 2 grids of 8 frames played one frame per replay tick. */
export const bossAttackFrameCount = 8;

export function bossAttackFrame(latest: GemDungeonCombatEvent | undefined, playedTicks: number) {
  if (!latest || (latest.type !== "BOSS_HIT" && latest.type !== "SURVIVAL_STRIKE")) return undefined;
  const age = playedTicks - latest.tick;
  if (age < 0 || age >= bossAttackFrameCount) return undefined;
  return { frame: age, sequence: latest.sequence };
}

function bossAttackSpriteStyle(sheet: string, frame: number): CSSProperties {
  return {
    backgroundImage: `url(${sheet})`,
    backgroundSize: "400% 200%",
    backgroundPosition: `${frame % 4 / 3 * 100}% ${Math.floor(frame / 4) * 100}%`,
  };
}

export function combatAnimationKeys(side: "player" | "boss", hit: boolean, sequence?: number) {
  return { fighter: `${side}-fighter-${hit ? sequence : "idle"}`, damage: hit ? `${side}-damage-${sequence}` : undefined };
}

export function wholeEventSecond(tick: number) {
  return Math.max(0, Math.floor(tick / 10));
}

function formatRecharge(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Beta rotates the open dungeon every hour, matching `GemRules.BOSS_ROTATION_HOURS`. */
export const bossRotationHours = 1;

/** How long the boss holds a recoil or attack pose before settling back to idle. */
export const bossReactionTicks = 3;

/** The battle HUD always shows this many skill slots, filled from the player's loadout. */
export const dungeonSkillSlotCount = 4;

/** 생존 보스는 `DungeonMode.SURVIVE`로 돌아 플레이어가 행동하지 않는다 — 스킬이 나갈 일이 없다. */
export function survivalOnlyDungeon(boss: GemPreset): boolean {
  return boss === "SURVIVAL";
}

/**
 * 마지막으로 나간 시전에서 재사용까지 남은 시간.  한 번도 안 썼거나 다 돌았으면 "준비".
 *
 * 예전에는 "다음 시전까지"를 셌다.  그러면 남은 재생분에 그 시전이 없을 때 — 보스를 일찍
 * 잡거나 전투가 끝나갈 때 — 쿨이 한창 도는 중인데도 "준비"로 보였다.
 */
export function skillCooldownLabel(lastCastTick: number | undefined, playedTicks: number) {
  if (lastCastTick === undefined) return "준비";
  const remainingTicks = Math.max(0, lastCastTick + SKILL_COOLDOWN_TICKS - playedTicks);
  return remainingTicks === 0 ? "준비" : `${(remainingTicks / 10).toFixed(1)}초`;
}

/**
 * 결과를 확정할 수 있는 시점인가.
 *
 * 서버는 `minimumCompleteAt` 전에 들어온 확정을 `GEM_DUNGEON_COMPLETE_TOO_EARLY` 로 되돌리고,
 * 거기서 `completionWindowSeconds` 가 지나면 `EXPIRED` 로 닫는다. 어느 쪽이든 보석함도
 * 입장권도 그대로 날아가므로, [now] 는 반드시 서버 시계로 환산한 지금이어야 한다
 * (`shared/serverClock`). 브라우저 시계를 그대로 넣으면 유저의 시계 오차가 곧 보상 손실이 된다.
 */
export function dungeonSettled(challenge: GemDungeonChallenge, now: number): boolean {
  return now >= Date.parse(challenge.minimumCompleteAt);
}

/** 이겨 놓고 아직 서버에 확정하지 않은 도전. 화면이 스스로 확정해야 보상이 남는다. */
export function awaitsRewardConfirmation(challenge: GemDungeonChallenge | null, now: number): boolean {
  return challenge !== null && challenge.status === "ACTIVE" && challenge.battle.success && dungeonSettled(challenge, now);
}

/** 확정이 막힌 이유를 유저의 말로 옮긴다. 서버 코드를 그대로 보여 주면 읽을 수 없다. */
function dungeonErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVENTORY_CAPACITY_EXCEEDED") return "가방이 가득 차 보석함을 받지 못했습니다. 자리를 비우고 다시 시도하세요.";
  if (code === "GEM_DUNGEON_COMPLETE_TOO_EARLY") return "아직 전투가 끝나지 않았습니다. 잠시 후 다시 시도하세요.";
  return "결과를 확정하지 못했습니다. 다시 시도해 주세요.";
}

export function secondsUntilNextDungeonSlot(now = Date.now()) {
  const rotationSeconds = bossRotationHours * 60 * 60;
  const elapsed = Math.floor(now / 1000) % rotationSeconds;
  return elapsed === 0 ? rotationSeconds : rotationSeconds - elapsed;
}

export function nextOpeningLabel(todayBoss: GemPreset, targetBoss: DungeonBoss, now = Date.now()) {
  const todayIndex = dungeonBosses.indexOf(todayBoss as DungeonBoss);
  const targetIndex = dungeonBosses.indexOf(targetBoss);
  if (todayIndex === targetIndex) return "지금 OPEN";
  const rotations = (targetIndex - todayIndex + dungeonBosses.length) % dungeonBosses.length;
  const rotationMs = bossRotationHours * 60 * 60 * 1000;
  const seconds = Math.max(1, Math.ceil((Math.floor(now / rotationMs) * rotationMs + rotations * rotationMs - now) / 1000));
  return `${formatRecharge(seconds)} 후`;
}

function usePretextDungeonLayout(contentKey: string) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!document.fonts || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void document.fonts.ready.then(() => {
      if (disposed || !root.current) return;
      const prepared = new Map<HTMLElement, PreparedText>();
      root.current.querySelectorAll<HTMLElement>("[data-pretext]").forEach((element) => prepared.set(element, prepare(element.textContent ?? "", getComputedStyle(element).font, { wordBreak: "keep-all" })));
      const relayout = () => prepared.forEach((text, element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
        element.style.minHeight = `${Math.ceil(layout(text, Math.max(1, element.clientWidth), lineHeight).height)}px`;
      });
      relayout();
      observer = new ResizeObserver(relayout);
      observer.observe(root.current);
    });
    return () => { disposed = true; observer?.disconnect(); };
  }, [contentKey]);
  return root;
}

function formatDungeonClearedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.month}.${parts.day}\n${parts.hour}:${parts.minute}`;
}

export function DungeonSelection({ dungeon, busy, now = Date.now(), testBoss, onSelectBoss, onStart, onSweep }: {
  dungeon: GemDungeonToday; busy: boolean; testBoss?: GemPreset;
  now?: number;
  onSelectBoss: (boss: DungeonBoss) => void; onStart: () => void; onSweep: () => void;
}) {
  const [selectedBoss, setSelectedBoss] = useState<DungeonBoss>(dungeon.boss as DungeonBoss);
  useEffect(() => setSelectedBoss(dungeon.boss as DungeonBoss), [dungeon.boss]);
  const visual = bossVisuals[selectedBoss];
  const highestStage = dungeon.progress.find((item) => item.boss === selectedBoss)?.highestClearedStage ?? 0;
  const opened = dungeon.boss === selectedBoss;
  const challengeStage = opened ? dungeon.nextChallengeStage ?? null : highestStage + 1;
  const sweepStage = opened ? dungeon.sweepStage ?? null : highestStage > 0 ? highestStage : null;
  /* 보상식은 서버가 소유한다. 닫힌 던전은 현재 회차의 보상 계약이 없으므로 수량을 추정하지 않는다. */
  const firstClearReward = opened ? dungeon.nextChallengeRewardGemBoxes ?? 0 : 0;
  const sweepReward = opened ? dungeon.sweepRewardGemBoxesPerTicket ?? 0 : 0;
  const sweepLocked = !opened || sweepStage === null;
  const ranking = dungeon.rankings?.[selectedBoss];
  const rankingEntries = ranking?.topEntries ?? [];
  const nextOpening = nextOpeningLabel(dungeon.boss, selectedBoss, now);
  const root = usePretextDungeonLayout(`${selectedBoss}-${dungeon.nextChallengeStage ?? "done"}`);
  const style = {
    "--dungeon-book-bg": `url(${dungeonBook})`,
    "--dungeon-tab-sheet": `url(${dungeonTabSheet})`,
    "--dungeon-primary-button": `url(${challengeButtonShell})`,
    "--dungeon-secondary-button": `url(${sweepButtonShell})`,
  } as CSSProperties;

  return <section ref={root} className="dungeon-book-screen" style={style} aria-labelledby="gems-title">
    <div className="dungeon-book-left">
      <header className="dungeon-book-title"><h2 id="gems-title" data-pretext>보석 던전</h2></header>
      <div className="dungeon-bookmarks" aria-label="던전 입장 문">
        {dungeonBosses.map((boss) => {
          const tabVisual = dungeonTabVisuals[boss];
          const bossOpened = dungeon.boss === boss;
          const active = selectedBoss === boss;
          const openingLabel = nextOpeningLabel(dungeon.boss, boss, now);
          return <button key={boss} type="button" className={`dungeon-bookmark dungeon-bookmark-${boss.toLowerCase()} ${bossOpened ? "opened" : "locked"}${active ? " active" : ""}`} style={{ "--bookmark-position": tabVisual.position } as CSSProperties} aria-pressed={active} disabled={busy} onClick={() => { setSelectedBoss(boss); if (dungeon.testBossSelectionEnabled) onSelectBoss(boss); }}>
            <span className="dungeon-bookmark-head"><img src={tabVisual.icon} alt="" /><strong>{dungeonTabNames[boss]}</strong></span>
            <small className="dungeon-bookmark-type">{bossTypeNames[boss]}</small>
            <em>{openingLabel}</em>
          </button>;
        })}
      </div>
      <div className={`dungeon-feature${opened ? " is-open" : " is-locked"}`}>
        <div className="dungeon-feature-content">
          <div className="dungeon-open-ribbon" aria-label={opened ? "현재 열림" : nextOpening}>
            {opened ? <><img className="dungeon-open-ribbon-shell" src={openRibbon} alt="" /><span><img src={openSunIcon} alt="" />OPEN</span></> : <span className="dungeon-next-opening"><img src={openClockIcon} alt="" />{nextOpening} OPEN</span>}
          </div>
          <header className="dungeon-boss-intro"><h3>{dungeonBossNames[selectedBoss]}</h3><span><img src={dungeonTabVisuals[selectedBoss].icon} alt="" /> {bossTypeNames[selectedBoss]}</span></header>
          <p className="dungeon-boss-description" data-pretext>{bossDescriptions[selectedBoss]}</p>
          <div className="dungeon-keyart-wrap"><img src={visual.keyArt} alt={`${dungeonBossNames[selectedBoss]} 모습`} /></div>
          <div className="dungeon-primary-actions">
            <button className="dungeon-start-button" disabled={!opened || dungeon.tickets <= 0 || challengeStage === null || busy} onClick={onStart}>{challengeStage === null ? "모든 단계 완료" : `${challengeStage}단계 도전`}<small aria-label={`입장권 ${dungeon.tickets} / ${DUNGEON_TICKET_MAX}`}><img src={ticketIcon} alt="" />{dungeon.tickets} / {DUNGEON_TICKET_MAX}</small></button>
            <button className="dungeon-sweep-button" disabled={sweepLocked || dungeon.tickets <= 0 || busy || testBoss !== undefined} aria-disabled={sweepLocked || dungeon.tickets <= 0 || busy || testBoss !== undefined} onClick={onSweep}><img src={broomIcon} alt="" />{sweepStage === null ? "소탕 잠김" : "소탕하기"}</button>
          </div>
        </div>
        {!opened && <div className="dungeon-locked-overlay" role="status"><img src={lockIcon} alt="" /><strong>현재 열리지 않은 던전입니다</strong><span><img src={openClockIcon} alt="" />{nextOpening} OPEN</span></div>}
      </div>
    </div>

    <div className="dungeon-book-right">
      <section className="dungeon-ranking" aria-labelledby="dungeon-ranking-title">
        <header><h3 id="dungeon-ranking-title"><img src={rankGoldIcon} alt="" />던전 랭킹<img src={rankGoldIcon} alt="" /></h3><small>클리어 단계</small><small>클리어 시각</small></header>
        {rankingEntries.length > 0 ? <ol className="dungeon-ranking-list">
          {rankingEntries.slice(0, 5).map((entry) => <li key={`${entry.rank}-${entry.nickname}`} className={entry.rank <= 3 ? `is-top rank-${entry.rank}` : undefined}>
            <span className="dungeon-rank-number">{entry.rank <= 3 && <img src={dungeonRankIcons[entry.rank - 1]} alt="" />}<b>{entry.rank}</b></span>
            <strong>{entry.nickname}</strong><span>{entry.stage}단계</span><time dateTime={entry.clearedAt}>{formatDungeonClearedAt(entry.clearedAt)}</time>
          </li>)}
        </ol> : <div className="dungeon-ranking-empty"><strong>아직 집계된 기록이 없습니다.</strong><span>첫 클리어 기록을 남겨보세요.</span></div>}
        {ranking?.myEntry && <span className="dungeon-ranking-gap" aria-hidden="true" />}
        {ranking?.myEntry && <div className="dungeon-my-rank">
          <span className="dungeon-my-rank-label" aria-label={`내 순위 ${ranking.myEntry.rank}위`}><strong>{ranking.myEntry.rank}위</strong></span>
          <strong className="dungeon-my-rank-name">{ranking.myEntry.nickname}</strong>
          <b>{ranking.myEntry.stage}단계</b><time dateTime={ranking.myEntry.clearedAt}>{formatDungeonClearedAt(ranking.myEntry.clearedAt)}</time>
        </div>}
      </section>
      <div className="dungeon-rewards" aria-label="던전 보상">
        <article><span>최초 클리어</span><img src={chestIcon} alt="보석함" /><p><b>{firstClearReward}개</b></p></article>
        <article><span>소탕 1회</span><img src={chestIcon} alt="보석함" /><p><b>{sweepReward}개</b></p></article>
      </div>
    </div>
  </section>;
}

export function BattlePlayback({ challenge, now, busy, loadout = [], appearance, cosmeticCatalog, debugEnabled = false, error, onComplete, onRetry, onAbort }: { challenge: GemDungeonChallenge; now: number; busy: boolean; loadout?: string[]; appearance?: Collection; cosmeticCatalog?: Catalog; debugEnabled?: boolean; error?: string | null; onComplete: () => void; onRetry: () => void; onAbort: () => void }) {
  const [equipped, setEquipped] = useState<EquippedAppearance>(() => ({ ...basicLoadout }));
  const [motionSelection, setMotionSelection] = useState<DungeonMotionSelection>("auto");
  const [frameSelection, setFrameSelection] = useState<"auto" | "1" | "2" | "3" | "4">("auto");
  const [debugMotionStartedAt, setDebugMotionStartedAt] = useState(now);
  const completeAt = Date.parse(challenge.minimumCompleteAt);
  const startAt = completeAt - challenge.battle.elapsedTicks * 100;
  const replayTicks = Math.max(0, Math.floor((now - startAt) / 100));
  const playedTicks = Math.min(challenge.battle.elapsedTicks, replayTicks);
  const events = challenge.battle.events.filter((event) => event.tick <= playedTicks);
  const latest = events.at(-1);
  const secondsLeft = Math.max(0, Math.ceil((completeAt - now) / 1000));
  const opening = challenge.battle.events[0];
  const playerHp = latest?.playerHp ?? opening?.playerHp ?? challenge.battle.remainingPlayerHp;
  const bossHp = latest?.bossHp ?? opening?.bossHp ?? challenge.battle.remainingBossHp;
  const maxPlayerHp = Math.max(1, opening?.playerHp ?? playerHp);
  const maxBossHp = Math.max(1, opening?.bossHp ?? bossHp);
  const playerHpPercent = Math.max(0, Math.min(100, playerHp / maxPlayerHp * 100));
  const bossHpPercent = Math.max(0, Math.min(100, bossHp / maxBossHp * 100));
  const playerHit = latest?.type === "BOSS_HIT" || latest?.type === "SURVIVAL_STRIKE";
  const bossReactionAge = latest ? playedTicks - latest.tick : Number.POSITIVE_INFINITY;
  const bossHit = (latest?.type === "PLAYER_HIT" || latest?.type === "DOT_HIT") && bossReactionAge <= bossReactionTicks;
  /* 강조도 재사용 시간도 지금까지 재생한 사건만 본다. 앞으로 쓸 스킬을 미리 켜 두지 않는다. */
  const castSkillIds = new Set(events.flatMap((event) => event.skillId ? [event.skillId] : []));
  const lastCastTick = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "SKILL_CAST" && event.type !== "PLAYER_HIT") continue;
    if (!event.skillId) continue;
    lastCastTick.set(event.skillId, event.tick);
  }
  const skillSlots = Array.from({ length: dungeonSkillSlotCount }, (_, index) => loadout[index] ?? null);
  const settled = dungeonSettled(challenge, now);
  /** 아직 서버에 결과가 남지 않은 도전. 확정도 포기도 여기서만 의미가 있다. */
  const pendingResolution = challenge.status === "ACTIVE";
  /* 이겼다고 보상이 남지는 않는다. 창이 닫힌 뒤 확정하면 서버는 EXPIRED 로 돌려주고
     보석함도 입장권도 건드리지 않는다. 화면이 status 를 보지 않으면 없는 보상을 알린다. */
  const rewarded = challenge.status === "SUCCEEDED";
  const automaticMotion = dungeonMotionForEvent(latest, playedTicks);
  const skillVfx = skillVfxForEvents(events, replayTicks);
  const playerMotion = motionSelection === "auto" ? automaticMotion.motion : motionSelection;
  const playerMotionStartedAt = motionSelection === "auto" ? startAt + automaticMotion.startedAtTick * 100 : debugMotionStartedAt;
  const showVerdict = settled && (challenge.battle.success || now >= completeAt + motionFrameDurations.death1 * 4);
  const playerKeys = combatAnimationKeys("player", playerHit, latest?.sequence);
  const bossKeys = combatAnimationKeys("boss", bossHit, latest?.sequence);
  const playerAnimationKey = motionSelection === "auto" ? playerKeys.fighter : `debug-${motionSelection}`;
  const wearsCosmetics = Object.values(appearance?.equipment ?? {}).some(Boolean);
  const bossMotion = showVerdict && challenge.battle.success ? "defeat" : bossHit ? "hit" : playerHit && bossReactionAge <= bossReactionTicks ? "attack" : "idle";
  const visual = bossVisuals[challenge.boss];
  const bossAttack = bossAttackFrame(latest, playedTicks);
  const style = { "--dungeon-battle-bg": `url(${visual.background})` } as CSSProperties;

  return <section className={`dungeon-battle cozy-dungeon-battle dungeon-theme-${challenge.boss.toLowerCase()}`} aria-label={`${dungeonBossNames[challenge.boss]} 전투`}>
    <div className="dungeon-battle-stage" style={style}>
      <header className="dungeon-battle-hud">
        <div className="dungeon-hp-panel dungeon-player-hp"><span className="dungeon-player-portrait" aria-hidden="true">한</span><div><strong>한짝</strong><div className="health-track" role="progressbar" aria-label="플레이어 체력" aria-valuemin={0} aria-valuemax={maxPlayerHp} aria-valuenow={playerHp}><i style={{ width: `${playerHpPercent}%` }} /></div><small>{playerHp.toLocaleString()} / {maxPlayerHp.toLocaleString()}</small></div></div>
        <div className={`dungeon-stage-timer ${secondsLeft <= 5 ? "urgent" : ""}`} style={{ "--dungeon-timer-shell": `url(${battleTimerShell})` } as CSSProperties}><strong>{challenge.stage}단계 · {bossTypeNames[challenge.boss]}</strong><span><small>남은 시간</small><b>{secondsLeft}</b>초</span></div>
        <div className="dungeon-hp-panel dungeon-boss-hp"><img src={visual.keyArt} alt="" /><div><strong>{dungeonBossNames[challenge.boss]}</strong><div className="health-track boss-health" role="progressbar" aria-label="보스 체력" aria-valuemin={0} aria-valuemax={maxBossHp} aria-valuenow={bossHp}><i style={{ width: `${bossHpPercent}%` }} /></div><small>{bossHp.toLocaleString()} / {maxBossHp.toLocaleString()}</small></div></div>
      </header>

      <div className="dungeon-fight-floor">
        <div className="dungeon-player-fighter">{bossAttack && <span key={`boss-attack-${bossAttack.sequence}`} aria-hidden="true" className="dungeon-boss-attack-vfx" style={bossAttackSpriteStyle(visual.attackSheet, bossAttack.frame)} />}{/* 치장을 걸치든 아니든 같은 조합기로 그린다. 예전에는 둘이 다른 컴포넌트라
        바닥선과 크기를 따로 맞춰야 했고, 한쪽만 고치면 다른 쪽이 어긋났다. */}
      <PlayerBattleCharacter key={playerAnimationKey} appearance={appearance} catalog={cosmeticCatalog} motion={playerMotion} actionEventId={latest?.sequence === undefined ? undefined : String(latest.sequence)} hit={playerHit} skillVfx={skillVfx.caster} />{playerHit && latest && latest.amount > 0 && <b key={playerKeys.damage} className="damage-number damage-player">-{damageText(latest.amount)}</b>}</div>
        <div className="dungeon-boss-fighter"><div key={bossKeys.fighter} className={`dungeon-boss-sprite dungeon-boss-motion-${bossMotion}`} style={{ backgroundImage: `url(${visual.spriteSheet})` }} />{skillVfx.target.map((effect) => <SkillVfxSprite key={effect.kind} effect={effect} />)}{bossHit && latest && latest.amount > 0 && <b key={bossKeys.damage} className={`damage-number damage-boss ${latest.critical ? "critical" : ""}`}>{damageText(latest.amount)}</b>}</div>
        {latest?.type === "SURVIVAL_STRIKE" && <span className="dungeon-danger-callout">면발 휩쓸기!</span>}
      </div>

      <div className="dungeon-battle-controls">
        <aside className="dungeon-combat-feed" aria-live="polite"><h4>전투 기록</h4><ol className="dungeon-log">{events.slice(-3).reverse().map((event) => <li key={event.sequence} className={`event-${event.type.toLowerCase()}`}><time>{wholeEventSecond(event.tick)}초</time><span>{eventNames[event.type]}</span>{event.amount > 0 && <strong>{damageText(event.amount)}</strong>}</li>)}</ol></aside>
        <div className="dungeon-skills" aria-label="장착 스킬">{skillSlots.map((skillId, index) => <div key={skillId ?? `empty-${index}`} className={`dungeon-skill${skillId ? "" : " empty"}${skillId && castSkillIds.has(skillId) ? " is-cast" : ""}`} style={{ "--skill-shell": `url(${skillCardShell})` } as CSSProperties}><span>{index + 1}</span>{skillId && skillIcons[skillId] && <img src={skillIcons[skillId]} alt="" />}<strong>{skillId ? skillNames[skillId] ?? skillId : "비어 있음"}</strong><small>{skillId ? skillCooldownLabel(lastCastTick.get(skillId), playedTicks) : "—"}</small></div>)}</div>
        <div className="dungeon-battle-actions">{error && <p className="dungeon-battle-error" role="alert">{error}</p>}{pendingResolution && <>{settled && <button className="dungeon-result-button" disabled={busy} onClick={onComplete}>결과 확정</button>}<button className="dungeon-abort-button" disabled={busy} onClick={onAbort}>도전 포기</button></>}</div>
      </div>

      {showVerdict && <div className={`battle-verdict ${challenge.battle.success ? "victory" : "defeat"}`}>
        <p className="battle-verdict-badge" style={{ "--verdict-badge": `url(${challenge.battle.success ? victoryBadge : defeatBadge})` } as CSSProperties}><strong>{challenge.battle.success ? "승리" : "패배"}</strong></p>
        <span>{!challenge.battle.success ? "성장을 정비하고 다시 도전하세요" : pendingResolution ? "결과를 확정하는 중입니다" : rewarded ? `보석함 ${challenge.rewardGemBoxes}개를 받았습니다` : "보상 시간이 지나 이번 클리어는 기록되지 않았습니다"}</span>
        <div className="battle-verdict-actions">
          <button type="button" className="dungeon-result-button" disabled={busy} onClick={onRetry}>{challenge.battle.success ? "다음 도전" : "다시하기"}</button>
          <button type="button" className="dungeon-abort-button" disabled={busy} onClick={onComplete}>나가기</button>
        </div>
      </div>}
    </div>

    {debugEnabled && <details className="dungeon-appearance-debug"><summary>천사 장비·모션 테스트</summary><div className="appearance-debug-controls">
      <label>모션<select value={motionSelection} onChange={(event) => { setMotionSelection(event.target.value as DungeonMotionSelection); setDebugMotionStartedAt(now); }}><option value="auto">전투 자동</option><option value="rest">대기 rest</option><option value="run2">이동 run2</option><option value="strike1">공격 strike1</option><option value="thrust1">찌르기 thrust1</option><option value="death1">사망 death1</option></select></label>
      <label>프레임<select value={frameSelection} onChange={(event) => setFrameSelection(event.target.value as typeof frameSelection)}><option value="auto">자동 재생</option><option value="1">1 / 4</option><option value="2">2 / 4</option><option value="3">3 / 4</option><option value="4">4 / 4</option></select></label>
      <label>무기<select value={equipped.weapon ?? ""} onChange={(event) => setEquipped((current) => ({ ...current, weapon: event.target.value || null }))}><option value="">해제</option>{angelWeaponIds.map((weapon) => <option key={weapon} value={weapon}>{weapon}</option>)}</select></label>
      <div className="appearance-slot-toggles" role="group" aria-label="천사 장비 슬롯 표시 전환">{equipmentSlots.map((slot) => <label key={slot}><input type="checkbox" checked={equipped[slot] !== null} onChange={(event) => setEquipped((current) => ({ ...current, [slot]: event.target.checked ? defaultAngelLoadout[slot] : null }))} />{slot}</label>)}</div>
    </div></details>}
  </section>;
}

export function GemsScreen({ mode = "manage", onClose, onOpenGems, previewStartChallenge }: { mode?: "manage" | "dungeon"; onClose?: () => void; onOpenGems?: () => void; previewStartChallenge?: (stage?: number) => GemDungeonChallenge }) {
  if (mode === "manage") return <GemManagementWindow open onClose={onClose ?? (() => undefined)} />;
  const queryClient = useQueryClient();
  /* 서버 시계로 재는 지금. 보상 창의 양쪽 끝이 서버 시각이라, 브라우저 시계로 재면
     앞선 만큼 일찍 눌러 거절당하고 뒤처진 만큼 늦게 눌러 창을 놓친다. */
  const [now, setNow] = useState(() => serverNow());
  const [testBoss, setTestBoss] = useState<GemPreset>();
  const state = useQuery({ queryKey: ["gems"], queryFn: gemsApi.state });
  const dungeon = useQuery({ queryKey: ["gem-dungeons", "today", testBoss], queryFn: () => gemDungeonsApi.today(testBoss), enabled: state.data?.unlocked === true });
  const skills = useQuery({ queryKey: ["skills"], queryFn: skillsApi.state, enabled: state.data?.unlocked === true });
  const appearance = useQuery({ queryKey: ["cosmetic-collection"], queryFn: cosmeticsApi.collection, enabled: state.data?.unlocked === true, retry: false });
  const cosmeticCatalog = useQuery({ queryKey: ["cosmetic-catalog"], queryFn: cosmeticsApi.catalog, enabled: state.data?.unlocked === true, retry: false, staleTime: Number.POSITIVE_INFINITY });
  const active = dungeon.data?.activeChallenge ?? null;
  /* 확정이 끝나면 서버의 활성 도전은 사라진다. 결과 화면까지 같이 걷히면 무엇을 받았는지
     볼 틈이 없으므로, 확정된 도전을 여기 붙잡아 두고 유저가 나갈 때 놓는다. */
  const [resolved, setResolved] = useState<GemDungeonChallenge | null>(null);
  const [dungeonError, setDungeonError] = useState<string | null>(null);
  const shown = active ?? resolved;
  const rotationSlot = useRef(Math.floor(serverNow() / (bossRotationHours * 60 * 60 * 1000)));

  useEffect(() => {
    setNow(serverNow());
    const timer = window.setInterval(() => {
      const current = serverNow();
      setNow(current);
      const nextSlot = Math.floor(current / (bossRotationHours * 60 * 60 * 1000));
      if (nextSlot !== rotationSlot.current) {
        rotationSlot.current = nextSlot;
        void queryClient.invalidateQueries({ queryKey: ["gems"] });
        void queryClient.invalidateQueries({ queryKey: ["gem-dungeons", "today"] });
      }
    }, active ? 100 : 1000);
    return () => window.clearInterval(timer);
  }, [active?.challengeId, queryClient]);

  const refreshDungeon = () => queryClient.invalidateQueries({ queryKey: ["gem-dungeons", "today"] });
  const start = useMutation({ mutationFn: (boss?: GemPreset) => gemDungeonsApi.start(boss), onSuccess: (result) => { setDungeonError(null); queryClient.setQueryData(["gem-dungeons", "today", testBoss], (old: typeof dungeon.data) => old ? { ...old, activeChallenge: result } : old); }, onError: (error) => setDungeonError(dungeonErrorMessage(error)) });
  const complete = useMutation({
    mutationFn: gemDungeonsApi.complete,
    onSuccess: (result) => { setDungeonError(null); queryClient.setQueryData<GemState>(["gems"], result.state); setResolved(result.challenge); refreshDungeon(); },
    onError: (error) => setDungeonError(dungeonErrorMessage(error)),
  });
  const abort = useMutation({ mutationFn: gemDungeonsApi.abort, onSuccess: () => { setDungeonError(null); refreshDungeon(); }, onError: (error) => setDungeonError(dungeonErrorMessage(error)) });
  const sweep = useMutation({ mutationFn: gemDungeonsApi.sweep, onSuccess: (result) => { queryClient.setQueryData<GemState>(["gems"], result.state); refreshDungeon(); } });
  const data = state.data;
  const dungeonBusy = start.isPending || complete.isPending || abort.isPending || sweep.isPending;
  const setPreviewChallenge = (challenge: GemDungeonChallenge | null) => queryClient.setQueryData(["gem-dungeons", "today", testBoss], { ...dungeon.data, activeChallenge: challenge });

  /* 보상 창은 서버 시각으로 completionWindowSeconds 뿐이다. 승리 화면을 읽는 사이에 닫히면
     보석함도 입장권도 함께 사라지므로, 확정은 눌러 주기를 기다리지 않고 창이 열리는 순간
     보낸다. 결과 화면은 확정된 도전으로 그대로 이어 그린다. */
  const confirmed = useRef<string>(undefined);
  const readyToConfirm = awaitsRewardConfirmation(active, now);
  useEffect(() => {
    if (previewStartChallenge || !active || !readyToConfirm || confirmed.current === active.challengeId) return;
    confirmed.current = active.challengeId;
    complete.mutate(active.challengeId);
  }, [active?.challengeId, readyToConfirm]);

  const leaveDungeon = () => {
    if (previewStartChallenge) return setPreviewChallenge(null);
    if (!shown) return;
    if (shown.status !== "ACTIVE") return setResolved(null);
    complete.mutate(shown.challengeId, { onSuccess: () => setResolved(null) });
  };
  const nextChallenge = () => {
    if (previewStartChallenge) return setPreviewChallenge(previewStartChallenge((shown?.stage ?? 0) + 1));
    if (!shown) return;
    if (shown.status !== "ACTIVE") { setResolved(null); return void start.mutate(testBoss); }
    complete.mutate(shown.challengeId, { onSuccess: () => { setResolved(null); start.mutate(testBoss); } });
  };
  const abortChallenge = () => {
    if (previewStartChallenge) return setPreviewChallenge(null);
    if (shown) abort.mutate(shown.challengeId);
  };

  return <section className={`gems-screen gems-dungeon-screen ${shown ? "is-battle-active" : "is-selection-active"}`} aria-labelledby="gems-title">
    {/* 깨고 나면 보석을 만지러 가고 싶다. 여기서 바로 넘어간다. */}
    {onOpenGems && <button type="button" className="cozy-quick-shortcut" onClick={onOpenGems}>보석 보러 가기<i className="cozy-chevron is-next" aria-hidden="true" /></button>}
    {(!data?.unlocked || !dungeon.data) && <div className="dungeon-book-screen dungeon-book-pending" style={{ "--dungeon-book-bg": `url(${dungeonBook})` } as CSSProperties} aria-busy={state.isLoading || dungeon.isLoading}>
      <div className="dungeon-book-pending-content">
        <header className="gems-heading"><div><p className="eyebrow">CONTENTS · DUNGEON</p><h2 id="gems-title">보석 던전</h2><p>1-5 최초 클리어 후 오늘의 보스에 도전하고 보석함을 획득합니다.</p></div>{data && <div className="gem-ticket"><strong>{data.tickets}</strong><small>입장권</small></div>}</header>
        {state.isLoading && <div className="domain-message" role="status">보석 상태를 불러오는 중입니다.</div>}
        {state.error && <div className="domain-message error" role="alert"><strong>보석 상태를 불러오지 못했습니다.</strong><button onClick={() => state.refetch()}>다시 시도</button></div>}
        {data && !data.unlocked && <div className="domain-message"><strong>보석 콘텐츠 잠김</strong><span>메인 스테이지 1-5 최초 클리어 후 입장권 3장과 보석 프리셋이 열립니다.</span></div>}
        {data?.unlocked && dungeon.isLoading && <div className="domain-message" role="status">오늘의 던전을 불러오는 중입니다.</div>}
        {data?.unlocked && dungeon.error && <div className="domain-message error" role="alert"><strong>던전 정보를 불러오지 못했습니다.</strong><button onClick={() => dungeon.refetch()}>다시 시도</button></div>}
      </div>
    </div>}
    {data?.unlocked && <>
      {dungeon.data && dungeon.error && <div className="domain-message error" role="alert"><strong>던전 정보를 불러오지 못했습니다.</strong><button onClick={() => dungeon.refetch()}>다시 시도</button></div>}
      {shown && <BattlePlayback challenge={shown} now={now} busy={dungeonBusy} loadout={skills.data?.activeLoadout ?? []} appearance={appearance.data} cosmeticCatalog={cosmeticCatalog.data} debugEnabled={dungeon.data?.testBossSelectionEnabled === true} error={dungeonError} onComplete={leaveDungeon} onRetry={nextChallenge} onAbort={abortChallenge} />}
      {dungeon.data && !shown && <><DungeonSelection dungeon={dungeon.data} busy={dungeonBusy} now={now} testBoss={testBoss} onSelectBoss={(boss) => setTestBoss(boss)} onStart={() => previewStartChallenge ? setPreviewChallenge(previewStartChallenge(dungeon.data.nextChallengeStage ?? 1)) : start.mutate(testBoss)} onSweep={() => sweep.mutate(1)} /><section className="domain-panel raid-card dungeon-raid-note" aria-disabled="true"><div><span>RAID</span><h3>레이드 준비 중</h3><p>레이드 콘텐츠는 아직 입장할 수 없습니다.</p></div><button disabled>준비 중</button></section></>}
    </>}
  </section>;
}
