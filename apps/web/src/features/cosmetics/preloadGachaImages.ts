import { preloadImages } from "../../shared/preloadImages";
import { cosmeticsApi } from "./api";
import cosmeticCardEpic from "./assets-cozy-pixel/cosmetic-card-epic-v1.png";
import cosmeticCardLegendary from "./assets-cozy-pixel/cosmetic-card-legendary-v1.png";
import cosmeticCardNormal from "./assets-cozy-pixel/cosmetic-card-normal-v1.png";
import cosmeticCardRare from "./assets-cozy-pixel/cosmetic-card-rare-v1.png";
import cosmeticDrawButtonShell from "./assets-cozy-pixel/cosmetic-draw-button-shell-cropped-v1.png";
import cosmeticDrawTicket from "./assets-cozy-pixel/cosmetic-draw-ticket-v1.png";
import cosmeticNewRibbon from "./assets-cozy-pixel/cosmetic-new-ribbon-v1.png";
import cosmeticPaperSheet from "./assets-cozy-pixel/cosmetic-paper-sheet-v2.webp";
import cosmeticRevealBackground from "./assets-cozy-pixel/cosmetic-reveal-background-v1.png";
import cosmeticSelectorBox from "./assets-cozy-pixel/cosmetic-selector-box-v1.png";
import cosmeticShowcaseFrame from "./assets-cozy-pixel/cosmetic-showcase-frame-walnut-v1.png";
import cosmeticTicketHero from "./assets-cozy-pixel/cosmetic-ticket-hero-v1.png";
import primaryButtonShell from "../profile/assets-cozy-pixel-v2/primary-button-9slice.png";
import modalPaperShell from "../character/assets-cozy-pixel/modal-paper-decorated-v2.png";
import riceIcon from "../equipment/assets-cozy-pixel/currency-rice-gold-v2.png";

const gachaPageImages = [
  cosmeticCardEpic,
  cosmeticCardLegendary,
  cosmeticCardNormal,
  cosmeticCardRare,
  cosmeticDrawButtonShell,
  cosmeticDrawTicket,
  cosmeticNewRibbon,
  cosmeticPaperSheet,
  cosmeticRevealBackground,
  cosmeticSelectorBox,
  cosmeticShowcaseFrame,
  cosmeticTicketHero,
  modalPaperShell,
  primaryButtonShell,
  riceIcon,
] as const;

/** Warm the gacha board, reveal, and the shared shells used by their dialogs. */
export function preloadGachaImages(): void {
  preloadImages(gachaPageImages);

  void Promise.resolve()
    .then(() => cosmeticsApi.showcase())
    .then((showcase) => preloadImages(showcase.sets.map((set) => set.imageUrl)))
    .catch(() => undefined);
}
