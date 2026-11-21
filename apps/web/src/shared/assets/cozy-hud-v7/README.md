# Cozy HUD v7 생성 기록

2026-09-21에 Codex 내장 이미지 생성 도구로 만든 관리 화면·보조 패널 에셋이다. 글자, 수치, 아이콘과 상호작용 상태는 에셋에 굽지 않고 DOM으로 조합한다.

## 결과 파일

- `features/character/assets-main-hud-v7/top-tab-default-v7.png`
- `features/character/assets-main-hud-v7/top-tab-selected-v7.png`
- `shared/assets/cozy-hud-v7/battle-history-panel-v7.png`
- `shared/assets/cozy-hud-v7/offline-reward-panel-v7.png`

`costume-stage-frame-v7.png`과 `costume-set-summary-v7.png`은 이후 v8~v11 에셋으로 교체되어 2026-09-25 미사용 에셋 정리에서 제거했다. 아래 프롬프트는 생성 이력으로만 보존한다.

## 사용 프롬프트

### `top-tab-default-v7.png`

> Create a production-ready transparent PNG UI asset for a Korean cozy pixel-art RPG. This is the UNSELECTED top navigation tab base only, no text and no icon. Match the attached chosen reference's first tab concept: a wide bookmark tab physically attached to a horizontal header rule, with a thin dark espresso 2–3 pixel outline, pale warm ivory paper fill, subtle cream paper grain, and one thin muted honey-gold inner line. Exact silhouette: wide 3:1 tab, only the two upper corners have very small stepped pixel cuts (about 2–3 staircase steps); both side edges are straight; the entire bottom edge is perfectly straight and square with NO rounded or clipped lower corners. No drop shadow, no thick border, no serrated edge, no decorations, no letters, no symbols. Keep a generous blank center for a DOM icon and Korean label. Transparent canvas outside the tab. Crisp readable pixel edges at UI size. Preserve the same wide proportions as the reference tab. Export only the isolated base asset.

### `top-tab-selected-v7.png`

> Create a production-ready transparent PNG UI asset for a Korean cozy pixel-art RPG. This is the SELECTED top navigation tab base only, no text and no icon. Match the attached chosen reference's coral middle tab concept: a wide bookmark tab physically attached to a horizontal header rule, with a thin dark espresso 2–3 pixel outline, soft muted coral-red fill (#dc6f62 family), subtle paper grain, a fine cream inner highlight, and a very small warm honey-gold accent line. Exact silhouette: wide 3:1 tab, only the two upper corners have very small stepped pixel cuts (about 2–3 staircase steps); both side edges are straight; the entire bottom edge is perfectly straight and square with NO rounded or clipped lower corners. No drop shadow, no thick border, no serrated edge, no decorations, no letters, no symbols. Keep a generous blank center for a DOM icon and Korean label. Transparent canvas outside the tab. Crisp readable pixel edges at UI size. Preserve the same wide proportions as the reference tab. Export only the isolated base asset.

### `costume-stage-frame-v7.png`

> Edit the attached character costume stage frame into a production-ready transparent PNG UI frame for a Korean cozy pixel-art RPG. Preserve EXACTLY the original 710:940 tall aspect ratio, transparent outer canvas, the large transparent central opening, and the bottom nickname plate proportions so existing layout content still fits. Restyle it to match the game's current bright battle HUD paper: pale warm ivory paper, very fine subtle fiber grain, thin espresso-brown 2–3 pixel outer line and a thin muted honey-gold inner line. Replace the many large zigzag/scalloped teeth with a calm mostly-smooth stepped pixel outline: only tiny sparse pixel notches at the four outer corners, straight sides, no sawtooth perimeter. Keep the inner opening large and clean with softly clipped pixel corners. Bottom name plate remains blank, no text, no level, no leaves, no icons, no decorations. Do not add any character, room, clothing, UI text or symbols. Crisp pixel-art edges, restrained depth, no heavy shadow. Export only this isolated frame with true transparency in the opening and outside.

### `costume-set-summary-v7.png`

> Edit the attached long costume set summary frame into a production-ready transparent PNG UI asset for a Korean cozy pixel-art RPG. Preserve the original 800:300 wide ratio and all functional zones: a large blank warm-ivory panel, a clearly defined blank square thumbnail well on the left, generous blank center area for DOM title/progress dots/count, and a blank right-side zone for a separate DOM button. Restyle it to match the current bright battle HUD paper: pale warm ivory, subtle paper fiber grain, thin espresso-brown 2–3 pixel outline, one thin muted honey-gold inner line, restrained depth. Replace the many large zigzag teeth with a smooth mostly rectangular pixel silhouette, using only tiny 2–3 step clipped corners. No leaves, no lines, no icons, no text, no dots, no button graphic, no decorations. Transparent outside. Crisp readable pixel edges and a calm clean hierarchy. Export only the isolated blank panel.

### `battle-history-panel-v7.png`

> Create a production-ready transparent PNG background asset for the expanded Battle History modal in a Korean cozy pixel-art RPG. Match the exact broad panel proportion of the attached battle-history screenshot, approximately 4:3 (about 1024×770). The panel is a large blank warm ivory paper sheet for live DOM content. Style must match the current main battle HUD: crisp pixel art, pale bright ivory paper, very subtle fiber grain, fine dark espresso outline about 2–3 pixels, a thin muted honey-gold inner inset line, and small evenly spaced 4–5 pixel paper teeth around the OUTER perimeter only (dense and delicate like the other main HUD sheets, never chunky). Keep the interior completely blank—no header text, no close button, no list, no scrollbar, no lines, no icons. Transparent outside the sheet. Minimal shadow, no rounded modern card, no large zigzags. Adequate clean inset margin around all edges. Export only the isolated blank panel.

### `offline-reward-panel-v7.png`

> Create a production-ready transparent PNG background asset for the Offline Reward modal in a Korean cozy pixel-art RPG. Match the exact tall narrow proportion of the attached offline reward screenshot, approximately 560×730. Make a blank pale warm-ivory paper panel for live DOM content, with subtle fiber grain, a fine espresso-brown 2–3 pixel outline, a thin muted honey-gold inner line, softly clipped pixel corners, and restrained depth. Crucially, attach TWO small symmetrical wooden clipboard clips along the top edge, one near the upper-left and one near the upper-right, matching the wood-and-brass clips on the attached chat panel. The clips should sit partly outside the paper without reducing usable content space. Keep the interior completely blank: no title, no item rows, no button, no text, no icons. Do not add any extra header flap. Transparent canvas outside the panel and clips. Crisp cozy pixel-art edges, bright not dark, no modern vector gloss, no large zigzags. Export only the isolated blank panel.
