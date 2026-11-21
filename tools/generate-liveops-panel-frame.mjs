/**
 * 이벤트 창 양옆 칸이 쓸 종이 액자를 채팅창 종이에서 뽑아낸다.
 *
 * 채팅 그림(1290×1219)을 좁고 긴 칸에 `100% 100%` 로 늘리면 가로는 0.22 배, 세로는 0.45 배로
 * 줄어 위아래 톱니만 두 배로 빽빽해진다. 늘이는 대신 9 조각으로 잘라 모서리는 그대로 두고
 * 가장자리는 톱니 한 주기만 반복시키면, 네 변의 톱니 크기가 같아진다.
 *
 * 톱니 주기는 원본에서 45px 다(위쪽 전이점 410→680 이 여섯 주기). 그 한 주기만 떼어 쓴다.
 *
 * 집게는 가장자리 조각에 들어가면 변마다 되풀이되므로 액자에서 빼고 따로 낸다. CSS 가
 * 칸 위에 두 개만 얹는다.
 *
 * 실행: node tools/generate-liveops-panel-frame.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(resolve(root, "apps/web/package.json"))("sharp");

const SRC = resolve(root, "apps/web/src/features/chat/assets-cozy-pixel/chat-panel-expanded-fine-v4.png");
const OUT = resolve(root, "apps/web/src/features/liveops/assets-cozy-pixel");

/** 모서리 조각 한 변. 둥근 모서리와 톱니 두 개가 들어갈 만큼. */
const CORNER = 90;
/** 톱니 한 주기. */
const TILE = 45;
/** 집게가 없고 톱니 위상이 맞는 지점. */
const CLEAN_X = 410;
const CLEAN_Y = 415;

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const opaque = (x, y) => data[(y * W + x) * 4 + 3] > 120;

/* 집게는 종이 위로 솟아 있어 그냥 경계를 재면 종이 대신 집게를 잡는다. 집게가 없는
   가운데 구간만 훑는다. */
let top = H, bottom = 0;
for (let x = 250; x < 1050; x += 1) {
  let y = 0; while (y < H && !opaque(x, y)) y += 1;
  if (y < top) top = y;
  let z = H - 1; while (z > 0 && !opaque(x, z)) z -= 1;
  if (z > bottom) bottom = z;
}
let left = W, right = 0;
for (let y = 400; y < 800; y += 1) {
  let x = 0; while (x < W && !opaque(x, y)) x += 1;
  if (x < left) left = x;
  let z = W - 1; while (z > 0 && !opaque(z, y)) z -= 1;
  if (z > right) right = z;
}
const paper = { left, top, width: right - left + 1, height: bottom - top + 1 };
console.log("paper bounds", paper);

const crop = (x, y, w, h) => sharp(SRC).extract({ left: Math.round(x), top: Math.round(y), width: w, height: h }).png().toBuffer();

const rightX = paper.left + paper.width - CORNER;
const bottomY = paper.top + paper.height - CORNER;

const tiles = await Promise.all([
  crop(paper.left, paper.top, CORNER, CORNER),            // 왼위
  crop(CLEAN_X, paper.top, TILE, CORNER),                 // 위
  crop(rightX, paper.top, CORNER, CORNER),                // 오른위
  crop(paper.left, CLEAN_Y, CORNER, TILE),                // 왼
  crop(600, 600, TILE, TILE),                             // 가운데(종이 결)
  crop(rightX, CLEAN_Y, CORNER, TILE),                    // 오른
  crop(paper.left, bottomY, CORNER, CORNER),              // 왼아래
  crop(CLEAN_X, bottomY, TILE, CORNER),                   // 아래
  crop(rightX, bottomY, CORNER, CORNER),                  // 오른아래
]);

const size = CORNER * 2 + TILE;
const at = [
  [0, 0], [CORNER, 0], [CORNER + TILE, 0],
  [0, CORNER], [CORNER, CORNER], [CORNER + TILE, CORNER],
  [0, CORNER + TILE], [CORNER, CORNER + TILE], [CORNER + TILE, CORNER + TILE],
];
await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles.map((input, i) => ({ input, left: at[i][0], top: at[i][1] })))
  .png()
  .toFile(resolve(OUT, "panel-paper-frame-v1.png"));

/* 집게 한 개. y=8 행에서 잰 두 덩어리 중 왼쪽(x 145~190)을, 종이 윗변(y=60) 위쪽만 떠 온다
   — 종이 가장자리까지 들어오면 액자의 톱니 위에 평평한 갈색 덩어리가 겹친다. */
await crop(143, 0, 50, paper.top).then((buf) => sharp(buf).png().toFile(resolve(OUT, "panel-paper-clip-v1.png")));

console.log(`wrote panel frame ${size}x${size} and clip`);
