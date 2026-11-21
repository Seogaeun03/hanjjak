import { experienceProgress } from "../battle/battlePresentation";
import type { CSSProperties, ReactNode } from "react";
import { CosmeticHero } from "../cosmetics/CosmeticHero";
import type { Catalog } from "../cosmetics/api";
import "./character-ability-v3.css";
import attackIcon from "./assets-stats-v2/icon-attack.png";
import attackSpeedIcon from "./assets-stats-v2/icon-attack-speed.png";
import basicAttackIcon from "./assets-stats-v2/icon-basic-attack.png";
import buffDurationIcon from "./assets-stats-v2/icon-buff-duration.png";
import criticalIcon from "./assets-stats-v2/icon-critical.png";
import damageUpIcon from "./assets-stats-v2/icon-damage-up.png";
import hpIcon from "./assets-stats-v2/icon-hp.png";
import penetrationIcon from "./assets-stats-v2/icon-penetration.png";
import expFill from "./assets-stats-v2/exp-fill.png";
import expTrack from "./assets-stats-v2/exp-track.png";
import restCharacter from "./assets-stats-v2/character-rest-192.png";
import combatPowerPlaque from "./assets-stats-v3/combat-power-plaque.png";
import primaryStatsPanel from "./assets-stats-v3/primary-stats-panel.png";
import profileSummaryPanel from "./assets-stats-v3/profile-summary-panel.png";
import supportStatsPanel from "./assets-stats-v3/support-stats-panel.png";
import type { CharacterStat, CharacterStats } from "./api";

type CharacterAppearance = {
  equipment?: Record<string, string | null>;
  catalog?: Pick<Catalog, "cosmetics" | "sets">;
};

export function formatCharacterStat(value: number, unit: string) {
  const number = unit === "BASIS_POINTS" || unit === "PERCENTAGE_POINTS" ? value / 100 : value;
  const suffix = unit === "BASIS_POINTS" ? "%" : unit === "PERCENTAGE_POINTS" ? "%p" : unit === "SECONDS" ? "초" : "";
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}${suffix}`;
}

function statValue(stat: CharacterStat | undefined, fallback = "—") {
  return stat ? formatCharacterStat(stat.total, stat.unit) : fallback;
}

function AbilityHero({ equipment, catalog }: CharacterAppearance) {
  return <CosmeticHero
    className="ability-summary-hero"
    equipment={equipment}
    catalog={catalog}
    alt="착용한 치장을 입은 한짝 캐릭터"
    fallback={<img className="ability-summary-hero" src={restCharacter} alt="나무검을 든 한짝 캐릭터" />}
  />;
}

function DetailRow({ icon, label, stat, fallback }: { icon: string; label: string; stat?: CharacterStat; fallback?: string }) {
  return <div className="ability-stat-row">
    <img src={icon} alt="" aria-hidden="true" />
    <span>{label}</span>
    <strong>{statValue(stat, fallback)}</strong>
  </div>;
}

function StatGroup({ tone, art, title, children }: {
  tone: "primary" | "support";
  art: string;
  title: string;
  children: ReactNode;
}) {
  return <article className={`ability-stat-group is-${tone}`} aria-labelledby={`ability-${tone}-title`} style={{ backgroundImage: `url(${art})` }}>
    <h3 id={`ability-${tone}-title`}>{title}</h3>
    <div className="ability-stat-rows">{children}</div>
  </article>;
}

/* 이름이 길면 두 줄로 접히는 대신 글자가 작아져야 한다. 글자마다 차지하는 폭이 달라
   글자 수로는 못 센다. 실제로 재 보니 한글은 한 칸의 .9, 라틴 대문자는 .95(W 가 가장
   넓다), 소문자와 숫자는 .6 쯤을 쓴다. 닉네임은 최대 스무 자다. */
const WIDE_GLYPH = /[ᄀ-ᇿ⺀-〿㄰-㆏㐀-䶿一-鿿가-힯＀-｠]/;
export function nicknameWidth(nickname: string): number {
  let width = 0;
  for (const glyph of nickname) width += WIDE_GLYPH.test(glyph) ? .9 : /[A-Z]/.test(glyph) ? .95 : .6;
  return Math.max(Math.round(width * 100) / 100, 1);
}

function ProfilePanel({ data, equipment, catalog, combatPower }: { data: CharacterStats; combatPower?: number | null } & CharacterAppearance) {
  const xp = experienceProgress(data.level, data.experience);
  const power = combatPower ?? data.combatPower ?? data.stats.reduce((total, stat) => total + Math.max(0, stat.total), 0);
  return <article className="ability-summary-profile" style={{ backgroundImage: `url(${profileSummaryPanel})` }}>
    <div className="ability-summary-portrait"><AbilityHero equipment={equipment} catalog={catalog} /></div>
    <div className="ability-summary-copy">
      <strong className="ability-summary-nickname" style={{ "--nickname-width": nicknameWidth(data.nickname) } as CSSProperties}>{data.nickname}</strong>
      <span className="ability-summary-level">LV.{data.level.toLocaleString()}</span>
      <div className="ability-summary-exp">
        <b>EXP</b>
        <div className="ability-summary-exp-meter">
          <div className="ability-summary-exp-track" role="progressbar" aria-label="현재 레벨 경험치" aria-valuemin={0} aria-valuemax={Math.max(1, xp.required)} aria-valuenow={xp.current} style={{ "--ability-exp-track": `url(${expTrack})` } as CSSProperties}>
            <i style={{ width: `${xp.percent}%`, backgroundImage: `url(${expFill})` }} />
          </div>
          <small>{xp.current.toLocaleString()} / {xp.required.toLocaleString()}</small>
        </div>
      </div>
    </div>
    <div className="ability-summary-power" style={{ backgroundImage: `url(${combatPowerPlaque})` }} aria-label={`전투력 ${power.toLocaleString()}`}>
      <img src={attackIcon} alt="" aria-hidden="true" />
      <span><b>전투력</b><strong>{power.toLocaleString()}</strong></span>
    </div>
  </article>;
}

export function CharacterAbilityTab({ data, equipment, catalog, combatPower }: { data: CharacterStats; combatPower?: number | null } & CharacterAppearance) {
  const byId = new Map(data.stats.map((stat) => [stat.statId, stat]));
  return <section className="ability-summary-layout" aria-label="캐릭터 능력치">
    <ProfilePanel data={data} equipment={equipment} catalog={catalog} combatPower={combatPower} />
    <StatGroup tone="primary" art={primaryStatsPanel} title="주 능력치">
      <DetailRow icon={hpIcon} label="최대 HP" stat={byId.get("maxHp")} />
      <DetailRow icon={attackIcon} label="공격력" stat={byId.get("attack")} />
      <DetailRow icon={penetrationIcon} label="관통력" stat={byId.get("penetration")} />
    </StatGroup>
    <StatGroup tone="support" art={supportStatsPanel} title="보조 능력치">
      <DetailRow icon={criticalIcon} label="치명타 확률" stat={byId.get("criticalChance")} fallback="0%" />
      <DetailRow icon={basicAttackIcon} label="기본공격 피해" stat={byId.get("basicAttackDamage")} fallback="0%" />
      <DetailRow icon={damageUpIcon} label="피해량 증가" stat={byId.get("allDamage")} fallback="0%" />
      <DetailRow icon={attackSpeedIcon} label="공격속도" stat={byId.get("attackSpeed")} fallback="0%" />
      <DetailRow icon={buffDurationIcon} label="버프 지속시간" stat={byId.get("buffDuration")} fallback="0초" />
    </StatGroup>
  </section>;
}
