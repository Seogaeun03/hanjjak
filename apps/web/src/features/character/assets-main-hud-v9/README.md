# Character main HUD v9 assets

Built with the built-in image generation tool on 2026-09-21. Runtime text, icons, dots, counts, item art, and button state remain DOM content.

## `costume-set-summary-base-v9.png`

Blank selected-cosmetic summary base for the real approximately `6:1` display ratio. The raw image is alpha-trimmed and used with CSS `border-image`, so its thin frame and plain corners keep their thickness instead of stretching with the card.

> Use case: ui-mockup. Asset type: production blank 9-slice base for an extremely wide selected-cosmetic/set-summary card in a pixel-art game. Image 1 shows the target card at its real on-screen proportion of approximately 6:1; Image 2 is the approved neutral-white paper color and fine line-style reference. Create only ONE completely blank horizontal paper card base. Use clean neutral-white warm ivory, very subtle paper fibers, a crisp dark espresso pixel outline, and one thin muted beige-gold inner keyline. The shape must be extremely simple: straight top, bottom, left, and right rails with small plain square or gently clipped corners. Absolutely no ornamental corner caps, crosses, protruding tabs, notches, scallops, leaves, or decorative flourishes at any corner. No clips in this base because clips will be overlaid separately. Make all four corners identical and all straight edge regions uniform for CSS 9-slice stretching to a 6:1 display ratio. Transparent background outside. No text, icon, thumbnail box, button box, divider, dots, count, item, shadow, scenery, or baked UI content. Keep the entire interior one uninterrupted bright paper surface. Crisp pixel-art edges suitable for a roughly 750×120 UI display.

## `paper-top-clip-v9.png`

One alpha-trimmed reusable top clip. CSS places two copies independently, which keeps the summary base clean and lets clip spacing follow the rendered width.

> Use case: background-extraction. Asset type: reusable single top binder-clip UI cutout for a pixel-art game. Use the small gold/brass rectangular clips along the top edge of the reference as the exact style reference. Create ONE isolated vertical rectangular gold/brass binder clip, front-facing, centered, with a crisp dark espresso pixel outline, warm gold highlight, and tiny inner bevel. Transparent background on every side. No paper, no card edge, no text, no shadow, no second clip, no screw plate, no hinge extending sideways, no scenery. Keep the silhouette compact and simple so it remains readable when displayed around 18×24 CSS pixels.
