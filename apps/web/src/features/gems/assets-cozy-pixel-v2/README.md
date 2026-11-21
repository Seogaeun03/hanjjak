# Gem dungeon cozy pixel v2 assets

Status: `runtime-wired`; dungeon selection UI and per-dungeon ranking API are connected.

This is the production-oriented asset pack selected from the dungeon design exploration. It keeps the approved book and food-monster direction, while using the quieter battle backgrounds and simpler paper UI requested in the final review.

## Included assets

| Area | Assets | Runtime use |
| --- | --- | --- |
| Dungeon selection | Open-book scene, three legacy vertical bookmark panels, three horizontal tab shells and symbols, empty red `OPEN` ribbon shell and sun icon | The approved compact layout uses the horizontal tab shells and separate symbols. Compose the ribbon shell, sun icon, and runtime `OPEN` text. Render names, type labels, open/locked state, tickets, time, rewards, and CTA as HTML/CSS. |
| Battle scene | Three 1672 × 941 backgrounds | Select by the current daily boss. |
| Bosses | Three transparent key arts plus three 4 × 5 motion sheets | Key art is suitable for selection/result compositions; motion sheets are for battle animation. |
| Battle UI | Timer shell, skill-card shell, victory and defeat badge shells | Render dungeon/stage, seconds, cooldown, result text, and values in HTML/CSS. |
| Icons | Ticket, gem chest, broom, survival, berserk, armored, dungeon lock, opening clock, opening sun, compact dungeon rank markers | The six original transparent 512 × 512 icons remain unchanged. The lock, clock, sun, and gold/silver/bronze dungeon rank markers are transparent source assets intended to be rendered down at UI size. The original 3 × 2 sheet is also retained. |
| Effects | Three transparent 4 × 2 attack sheets | Eight frames per boss; see `effects/attack-sheets.json`. |

## Boss sprite contract

- Sheet: 1120 × 1400 pixels.
- Cell: 280 × 280 pixels.
- Grid: 4 columns × 5 rows.
- Rows: `idle`, `move`, `attack`, `hit`, `defeat`.
- Playback order: left to right within each row.
- Transparent background.
- Run motion and anchor-point QA in the actual battle viewport before treating the animations as final.

## Reuse instead of generating more

The following pieces already exist elsewhere in the project and should be composed with this pack:

- Player and boss HP containers: `shared/assets/cozy-hud-v1/paper/status-panel-shell-9slice.png` plus CSS progress fills.
- Battle log and progress: `shared/assets/cozy-hud-v1/paper/battle-log-panel-shell-9slice.png`, `stage-progress-shell-9slice.png`, and `controls/progress-fill-coral-9slice.png`.
- Challenge/quit buttons: `shared/assets/onboarding-cozy-pixel/primary-button-shell-9slice.png` and `secondary-button-shell-9slice.png`.
- Player skill icons: `features/skills/assets-cozy-pixel/`.
- Dungeon ranking uses the compact crown markers `icons/icon-dungeon-rank-gold-v1.png`, `icon-dungeon-rank-silver-v1.png`, and `icon-dungeon-rank-bronze-v1.png`. They intentionally differ from the ornate round medals used by the global ranking screen. Rank numbers remain HTML text over the blank centers.

## Locked dungeon presentation

- Keep the title and dungeon bookmarks sharp so the selected destination remains clear.
- Apply dimming, reduced saturation, and a light blur only to the selected boss content area.
- Render `icons/icon-dungeon-lock-large-v1.png` and the unavailable message above that veil.
- Render `icons/icon-dungeon-open-clock-v1.png` beside the server-derived time remaining until the next open slot.
- Keep challenge and sweep controls visible but disabled, and omit the ticket badge while the selected dungeon is closed.
- The blur, veil, selection outline, mutable copy, countdown, rank numbers, and reward values remain HTML/CSS rather than baked image content.

## Horizontal dungeon tabs

- Use `ui/dungeon-tabs-v3.png` as the single three-frame horizontal sprite sheet. Its three 720×360 cells contain the gold, burgundy, and forest-green shells with one shared geometry and alignment; render them with `background-size: 300% 100%` at positions `0%`, `50%`, and `100%`.
- Overlay the matching `icons/icon-dungeon-tab-*-v1.png` symbol, dungeon name, and mechanic label as separate elements.
- The shells contain no baked text so selection, lock state, accessibility labels, and localization remain runtime concerns.
- Use `ui/dungeon-challenge-button-v1.png` for the red challenge action. Its right-side yellow tag is intentionally empty so the ticket icon and live `current / maximum` value can be overlaid at runtime. Use `ui/dungeon-sweep-button-v1.png` for the cream sweep action; both were generated in one source sheet and share the same vertical geometry.

## Open ribbon

- Use `ui/dungeon-open-ribbon-v1.png` as the empty red ribbon shell and overlay `icons/icon-dungeon-open-sun-v1.png` with the runtime text `OPEN`.
- Keep the word out of the bitmap so localization and daily availability state remain accessible runtime content.

This avoids baking mutable text, values, cooldowns, HP, daily state, or localized copy into images.

## Content mapping

The SSOT daily rotation maps mechanic types in this order: survival → berserk → armored. The user-selected presentation maps them to:

- Udon Monster → survival.
- Quail Egg Jangjorim Monster → berserk.
- Acorn Jelly Monster → armored.

Names and presentation are asset labels only until the working content document is reconciled with the SSOT.

Generated and normalized on 2026-09-11. Source design drafts remain under `design-drafts/`; the rejected ornate direction remains archived separately for traceability.
