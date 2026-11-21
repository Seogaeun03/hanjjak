import "./SkillArtwork.css";

/* 스킬 그림은 스킬 화면만의 것이 아니다. 전투 HUD 의 쿨타임 줄과 거래소의 스킬북
   칸도 같은 그림을 쓴다. 스킬 화면은 눌러야 받아 오는 청크라, 그림 한 장만 따로
   두어 첫 화면이 스킬 화면을 통째로 끌어오지 않게 한다. */
const SKILL_ART_FILES: Record<string, string> = {
  active_heavy: "skill-active-heavy.png",
  active_dot: "skill-active-dot.png",
  active_haste: "skill-active-haste.png",
  active_basic_amp: "skill-active-basic-amp.png",
  passive_critical: "skill-passive-critical.png",
  passive_all_damage: "skill-passive-all-damage.png",
};
const skillArtModules = import.meta.glob("./assets-cozy-pixel/skill-*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export function SkillArtwork({ skillId, name, compact = false }: { skillId: string; name: string; compact?: boolean }) {
  const file = SKILL_ART_FILES[skillId];
  const source = file ? skillArtModules[`./assets-cozy-pixel/${file}`] : undefined;
  return source
    ? <img className={`skill-artwork ${compact ? "compact" : ""}`} src={source} alt={`${name} 스킬 아이콘`} />
    : <span className={`skill-artwork skill-artwork-missing ${compact ? "compact" : ""}`} role="img" aria-label={`${name} 스킬 아이콘 준비 중`}><b>?</b><small>에셋 준비 중</small></span>;
}
