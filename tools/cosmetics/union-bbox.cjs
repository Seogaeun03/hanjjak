// 모든 레이어의 그림 범위를 합쳐 하나의 테두리로 만든다. 런타임 캔버스를 어디까지
// 잘라도 되는지 재려는 것이다. 빈 여백을 들고 다니면 그만큼 파일이 커진다.
const fs = require("fs"), path = require("path");
const { bbox } = require("../ink-bbox.cjs");
const root = process.argv[2];
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
const worst = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "item-icons") walk(full); continue; }
    if (!entry.name.endsWith(".png")) continue;
    if (only && !only.test(entry.name)) continue;
    const box = bbox(full);
    if (box.empty) continue;
    n++;
    if (box.minX < minX) { minX = box.minX; worst.push(["left", full, box.minX]); }
    if (box.minY < minY) { minY = box.minY; worst.push(["top", full, box.minY]); }
    if (box.maxX > maxX) { maxX = box.maxX; worst.push(["right", full, box.maxX]); }
    if (box.maxY > maxY) { maxY = box.maxY; worst.push(["bottom", full, box.maxY]); }
  }
};
walk(root);
console.log(JSON.stringify({ files: n, minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }));
for (const [side, file, value] of worst.slice(-8)) console.log(" ", side, value, path.relative(root, file));
