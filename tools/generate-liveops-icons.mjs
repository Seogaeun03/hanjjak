/**
 * 이벤트 뽑기 확률표의 동그란 아이콘과 보상 패널 배지를 만든다.
 *
 * CSS 로 그린 원(`.liveops-mini-capsule`)은 색만 달랐다. 종류를 색으로만 구분하면
 * 색을 구분하기 어려운 사람에게는 세 줄이 같은 그림이 된다. 안에 실제 물건을 넣어
 * 모양으로도 읽히게 한다.
 *
 * 픽셀 그리드(32×32)를 4배 확대해 테두리를 또렷하게 남기고, 이미 있는 아이템 아트는
 * 그 위에 부드럽게 줄여 얹는다. 둘을 같은 방식으로 늘리면 한쪽이 반드시 뭉개진다.
 *
 * 실행: node tools/generate-liveops-icons.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/* sharp 은 apps/web 의 devDependency 다. 저장소 루트에서는 찾지 못한다. */
const sharp = createRequire(resolve(root, "apps/web/package.json"))("sharp");
const web = (p) => resolve(root, "apps/web/src", p);

const GRID = 32;
const SCALE = 4;
const SIZE = GRID * SCALE;

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

/** 32×32 RGBA 버퍼. 픽셀 하나를 원소 4개로 본다. */
function canvas() {
  return Buffer.alloc(GRID * GRID * 4, 0);
}

function put(buf, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
  const [r, g, b] = hex(color);
  const at = (y * GRID + x) * 4;
  buf[at] = r; buf[at + 1] = g; buf[at + 2] = b; buf[at + 3] = alpha;
}

/**
 * 테두리가 굵은 원형 배지. 위가 밝고 아래가 어두워 캡슐 기계의 광택과 결이 맞는다.
 */
function badge({ ring, top, bottom, gloss }) {
  const buf = canvas();
  const c = (GRID - 1) / 2;
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const d = Math.hypot(x - c, y - c);
      if (d > 15.2) continue;
      if (d > 12.6) { put(buf, x, y, ring); continue; }
      put(buf, x, y, y < GRID / 2 ? top : bottom);
    }
  }
  /* 왼쪽 위 광택. 원의 곡률을 따라 두 칸만 찍는다 — 더 넣으면 아이템과 겹쳐 지저분해진다. */
  for (const [x, y] of [[10, 7], [11, 6], [12, 6], [13, 6], [9, 8], [9, 9]]) put(buf, x, y, gloss);
  return buf;
}

/** 각 행의 중심에서 좌우로 뻗는 길이. 오목한 변을 가진 4각 반짝임이 된다. */
const SPARKLE_HALF = [7, 5, 3, 2, 2, 1, 1, 0];

function sparkle(buf, cx, cy, color, edge) {
  for (let dy = -7; dy <= 7; dy += 1) {
    const half = SPARKLE_HALF[Math.abs(dy)];
    for (let dx = -half; dx <= half; dx += 1) {
      const rim = Math.abs(dx) === half && half > 0;
      put(buf, cx + dx, cy + dy, rim ? edge : color);
    }
  }
}

const BURGER = {
  palette: { O: "#6b3a22", B: "#e9a860", H: "#ffd9a0", C: "#f6c84f", L: "#86bb6a", P: "#8a4a2c" },
  rows: [
    ".....OOOOOOOO.....",
    "...OOBBHHBBBBOO...",
    "..OBBBBHBBBBBBBO..",
    ".OBBBBBBBBBBBBBBO.",
    ".OOOOOOOOOOOOOOOO.",
    ".OCCCCCCCCCCCCCCO.",
    ".OLLLLLLLLLLLLLLO.",
    ".OPPPPPPPPPPPPPPO.",
    ".OPPPPPPPPPPPPPPO.",
    ".OOOOOOOOOOOOOOOO.",
    ".OBBBBBBBBBBBBBBO.",
    "..OBBBBBBBBBBBBO..",
    "...OOOOOOOOOOOO...",
  ],
};

function stamp(buf, art, ox, oy) {
  art.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = art.palette[ch];
      if (color) put(buf, ox + x, oy + y, color);
    });
  });
}

const pixels = (buf) =>
  sharp(buf, { raw: { width: GRID, height: GRID, channels: 4 } })
    .resize(SIZE, SIZE, { kernel: "nearest" })
    .png();

/** 이미 있는 아이템 아트를 배지 안쪽에 맞춰 얹는다. 확대가 아니라 축소라 흐려지지 않는다. */
async function withArt(base, artPath, box) {
  const art = await sharp(web(artPath)).resize(box, box, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const offset = Math.round((SIZE - box) / 2);
  return sharp(await base.toBuffer()).composite([{ input: art, top: offset, left: offset }]).png();
}

const out = (name) => web(`features/liveops/assets-cozy-pixel/${name}`);

/* 금색 위에 크림색 별을 얹으면 명도가 붙어 별이 사라진다. 바탕을 한 단 낮추고 별을 흰색까지 올린다. */
const star = badge({ ring: "#8a5a2b", top: "#edb94c", bottom: "#d99a30", gloss: "#f8d685" });
sparkle(star, 15, 15, "#fffdf4", "#ffe9b4");

const burger = badge({ ring: "#b4503f", top: "#fff1e2", bottom: "#ffdcc8", gloss: "#fffaf3" });
stamp(burger, BURGER, 7, 10);

await pixels(star).toFile(out("reward-star-badge-v1.png"));
await pixels(burger).toFile(out("odds-prize-burger-v1.png"));
await (await withArt(pixels(badge({ ring: "#7e5a93", top: "#f7ecfb", bottom: "#e7d3f0", gloss: "#fffdff" })), "features/cosmetics/assets-cozy-pixel/cosmetic-draw-ticket-v1.png", 76)).toFile(out("odds-cosmetic-ticket-v1.png"));
await (await withArt(pixels(badge({ ring: "#b58128", top: "#fdf1cf", bottom: "#f6dfa4", gloss: "#fffdf2" })), "features/equipment/assets-cozy-pixel/currency-rice-gold-v2.png", 74)).toFile(out("odds-rice-v1.png"));
await (await withArt(pixels(badge({ ring: "#3f7f93", top: "#e4f3f7", bottom: "#c9e6ee", gloss: "#fbffff" })), "features/inventory/assets-gem-box-chest.png", 78)).toFile(out("odds-gem-box-v1.png"));

/* 결과 카드의 경품 칸은 이모지(☕)였다. 햄버거 기프티콘으로 바뀌므로 카드 크기에 맞춘
   큰 그림을 따로 낸다. 배지 테두리 없이, 그림에 딱 맞는 판에 그린다 — 32×32 판에 그대로
   그리면 여백까지 함께 줄어들어 쌀·뽑기권 아이콘보다 한참 작아 보인다. */
const bw = BURGER.rows[0].length;
const bh = BURGER.rows.length;
const bigBurger = Buffer.alloc(bw * bh * 4, 0);
BURGER.rows.forEach((row, y) => {
  [...row].forEach((ch, x) => {
    const color = BURGER.palette[ch];
    if (!color) return;
    const [r, g, b] = hex(color);
    const at = (y * bw + x) * 4;
    bigBurger[at] = r; bigBurger[at + 1] = g; bigBurger[at + 2] = b; bigBurger[at + 3] = 255;
  });
});
await sharp(bigBurger, { raw: { width: bw, height: bh, channels: 4 } })
  .resize(bw * 14, bh * 14, { kernel: "nearest" }).png().toFile(out("prize-burger-gifticon-v1.png"));

console.log("wrote liveops icons");
