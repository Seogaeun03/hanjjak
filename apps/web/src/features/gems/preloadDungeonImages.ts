import { preloadImages } from "../../shared/preloadImages";

import dungeonBook from "./assets-cozy-pixel-v2/dungeon-selection-book.png";
import dungeonTabSheet from "./assets-cozy-pixel-v2/ui/dungeon-tabs-v3.png";
import openRibbon from "./assets-cozy-pixel-v2/ui/dungeon-open-ribbon-v1.png";
import challengeButtonShell from "./assets-cozy-pixel-v2/ui/dungeon-challenge-button-v1.png";
import sweepButtonShell from "./assets-cozy-pixel-v2/ui/dungeon-sweep-button-v1.png";
import battleTimerShell from "./assets-cozy-pixel-v2/ui/battle-timer-shell.png";
import skillCardShell from "./assets-cozy-pixel-v2/ui/skill-card-shell.png";
import victoryBadge from "./assets-cozy-pixel-v2/ui/result-victory-badge.png";
import defeatBadge from "./assets-cozy-pixel-v2/ui/result-defeat-badge.png";
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
import activeHasteIcon from "../skills/assets-cozy-pixel/skill-active-haste.png";
import activeBasicAmpIcon from "../skills/assets-cozy-pixel/skill-active-basic-amp.png";
import activeHeavyIcon from "../skills/assets-cozy-pixel/skill-active-heavy.png";
import activeDotIcon from "../skills/assets-cozy-pixel/skill-active-dot.png";

const dungeonBattleEffectImages = [
  "/assets/effects/skills-v1/active-heavy-target-8f.png?v=20260911",
  "/assets/effects/skills-v1/active-dot-target-8f.png",
  "/assets/effects/skills-v1/haste-caster-8f.png",
  "/assets/effects/skills-v1/active-basic-amp-caster-8f.png",
] as const;

const defaultHeroRestImages = [
  "/cosmetics/motion/body/rest_01.png",
  "/cosmetics/motion/arms/rest_01.png",
  "/cosmetics/motion/weapon-default/rest_01.png",
] as const;

const dungeonImages = [
  dungeonBook,
  dungeonTabSheet,
  openRibbon,
  challengeButtonShell,
  sweepButtonShell,
  battleTimerShell,
  skillCardShell,
  victoryBadge,
  defeatBadge,
  udonKeyArt,
  quailKeyArt,
  acornKeyArt,
  udonSpriteSheet,
  quailSpriteSheet,
  acornSpriteSheet,
  udonAttackSheet,
  quailAttackSheet,
  acornAttackSheet,
  udonBattleBackground,
  quailBattleBackground,
  acornBattleBackground,
  ticketIcon,
  chestIcon,
  broomIcon,
  lockIcon,
  openClockIcon,
  openSunIcon,
  rankGoldIcon,
  rankSilverIcon,
  rankBronzeIcon,
  udonTabIcon,
  quailTabIcon,
  acornTabIcon,
  activeHasteIcon,
  activeBasicAmpIcon,
  activeHeavyIcon,
  activeDotIcon,
  ...dungeonBattleEffectImages,
  ...defaultHeroRestImages,
] as const;

/** Warm only the static art used on dungeon selection and combat screens. */
export function preloadDungeonImages(): void {
  preloadImages(dungeonImages);
}
