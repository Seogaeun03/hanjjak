import { useQuery } from "@tanstack/react-query";
import { materialPreferenceApi, type MaterialType } from "../material-preference/api";
import type { RefObject } from "react";
import type { CharacterStats } from "./api";
import accentRaysCoral from "./assets-cozy-pixel/accent-rays-coral.png";
import statsTabIcon from "./assets-cozy-pixel/sword-icon-bold-96.png";
import chopstickHead from "../../shared/assets/cozy-hud-v1-webp/icons/chopstick-head.webp";
import cosmeticsTabIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/equipment.webp";
import galleryTabIcon from "../../shared/assets/cozy-hud-v1-webp/bottom-navigation/skill.webp";
import closeIcon from "../../shared/assets/cozy-hud-v9/close-button-v9.png";
import tabDefault from "./assets-main-hud-v7/top-tab-default-v7.png";
import tabSelected from "./assets-main-hud-v7/top-tab-selected-v7.png";

export type CharacterTab = "stats" | "cosmetics" | "gallery";

const TABS: Array<[CharacterTab, string]> = [
  ["stats", "능력치"],
  ["cosmetics", "치장"],
  ["gallery", "도감"],
];

function CharacterTabIcon({ tab }: { tab: CharacterTab }) {
  const source = tab === "stats" ? statsTabIcon : tab === "cosmetics" ? cosmeticsTabIcon : galleryTabIcon;
  return <img src={source} alt="" aria-hidden="true" />;
}

type HeaderProps = {
  activeTab: CharacterTab;
  closeButton: RefObject<HTMLButtonElement | null>;
  data?: CharacterStats;
  onClose: () => void;
  onTabChange: (tab: CharacterTab) => void;
};

/*
 * 주력 재료는 처음 한 번 고르고 나면 어디에도 적히지 않아, 한참 뒤에 내가 무엇을
 * 골랐는지 확인할 데가 없었다. 이름 옆에 재료의 색으로 달아 둔다.
 */
const MATERIAL_LABELS: Record<MaterialType, string> = { POTATO: "감자", SWEET_POTATO: "고구마", CORN: "옥수수" };

export function CharacterWindowHeader({ activeTab, closeButton, data, onClose, onTabChange }: HeaderProps) {
  const preference = useQuery({ queryKey: ["material-preference"], queryFn: materialPreferenceApi.get, retry: false, staleTime: 5 * 60_000 });
  const material = preference.data?.primaryMaterialType ?? null;
  return <header className="character-header">
    <div className="character-heading">
      <img className="character-heading__sprout" src={chopstickHead} alt="" />
      <h2 id="character-title">캐릭터</h2>
      {material && <span className={`character-material character-material-${material.toLowerCase().replace("_", "-")}`}>{MATERIAL_LABELS[material]}</span>}
      <img className="character-heading__accent" src={accentRaysCoral} alt="" />
    </div>
    <div role="tablist" aria-label="캐릭터 정보" className="character-tabs">
      {TABS.map(([id, label], index) => {
        const locked = Boolean(data && !data.cosmeticsUnlocked && id !== "stats");
        return <button
        key={id}
        role="tab"
        id={`character-tab-${id}`}
        aria-controls={`character-panel-${id}`}
        aria-label={locked ? `${label} (잠김)` : label}
        aria-selected={activeTab === id}
        tabIndex={activeTab === id ? 0 : -1}
        onClick={() => onTabChange(id)}
        onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
            : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
              : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault();
          const nextTab = TABS[next][0];
          onTabChange(nextTab);
          document.getElementById(`character-tab-${nextTab}`)?.focus();
        }}
      >
        <img className="character-tab-plate" src={activeTab === id ? tabSelected : tabDefault} alt="" aria-hidden="true" />
        <span className="character-tab-icon"><CharacterTabIcon tab={id} /></span>
        <span>{label}</span>
      </button>;
      })}
    </div>
    <button ref={closeButton} className="character-close paper-close" type="button" onClick={onClose} aria-label="캐릭터 창 닫기"><img src={closeIcon} alt="" aria-hidden="true" /></button>
  </header>;
}

export function CharacterLoadPanel({ kind, onRetry }: { kind: "loading" | "error"; onRetry?: () => void }) {
  return <section className={`character-load-panel character-load-panel--${kind}`} aria-live="polite" role={kind === "error" ? "alert" : "status"}>
    <span className="character-load-panel__stamp" aria-hidden="true">한</span>
    <div>
      <strong>{kind === "loading" ? "캐릭터 기록을 펼치는 중" : "캐릭터 기록을 열지 못했습니다"}</strong>
      <p>{kind === "loading" ? "성장 기록과 착용 정보를 정리하고 있습니다." : "잠시 뒤 다시 시도해 주세요. 계속 실패하면 서버의 DB 적용 상태를 확인해야 합니다."}</p>
    </div>
    {kind === "error" && onRetry && <button type="button" onClick={onRetry}>다시 불러오기</button>}
  </section>;
}
