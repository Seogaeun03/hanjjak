const fs = require("fs");
const path = require("path");
const sharp = require(path.resolve(__dirname, "../../apps/web/node_modules/sharp"));

const ROOT = path.resolve(__dirname, "../..");
const OUTPUT = path.join(ROOT, "apps/web/public/cosmetics");
const inputRoot = process.argv[2];
if (!inputRoot) throw new Error("사용법: node tools/cosmetics/import-expanded-cosmetics.cjs <ZIP-해제-폴더>");

const sets = [
  ["골판지크레용", "cardboard-crayon"], ["구미호", "white-fox-spirit"], ["도깨비", "dokkaebi"],
  ["마법소녀", "magical-girl"], ["뱀물수호자", "snake-water-guardian"], ["번개월계관", "lightning-laurel"],
  ["숲의정령", "forest-spirit"], ["왕실기사", "royal-knight"], ["임금", "king"], ["저승사자", "grim-reaper"],
  ["치어리더", "cheerleader"], ["치장05-나뭇잎", "leaf"], ["치장19-고기꼬치", "meat-skewer"],
];
const faces = [
  ["긱시크안경", "갈색안경", "geek-chic-glasses"], ["네온안경", "네온안경", "neon-glasses"],
  ["눈물", "눈물", "tears"], ["마스크", "마스크", "face-mask"], ["문어입", "문어", "octopus-mouth"],
  ["반창고", "반창고", "bandage"], ["산타코", "빨간코", "santa-nose"], ["아잉눈", "큰눈볼터치", "aing-eyes"],
  ["오리입", "오리부리", "duck-mouth"], ["쪽쪽이", "쪽쪽이", "pacifier"],
];
const frames = ["death_01", ...["rest", "run", "strike1"].flatMap(motion => [1, 2, 3, 4].map(frame => `${motion}_${String(frame).padStart(2, "0")}`))];

const need = file => {
  if (!fs.existsSync(file)) throw new Error(`에셋 누락: ${file}`);
  return file;
};
const parent = file => fs.mkdirSync(path.dirname(file), { recursive: true });
async function copy(source, target) {
  parent(target);
  await fs.promises.copyFile(need(source), target);
}
async function merge(sources, target) {
  const existing = sources.filter(fs.existsSync);
  if (existing.length === 0) throw new Error(`합성할 에셋 누락: ${target}`);
  parent(target);
  await sharp(existing[0]).composite(existing.slice(1).map(input => ({ input }))).png().toFile(target);
}
const icon = (folder, name) => path.join(inputRoot, folder, "item-icons", name);
const layer = (folder, frame, part) => path.join(inputRoot, folder, "layers", `${frame}-${part}.png`);

async function importSet(folder, slug) {
  const iconNames = fs.readdirSync(path.join(inputRoot, folder, "item-icons"));
  const icons = { head: "hat.png", top: "body.png", bottom: "weapon.png", gloves: iconNames.find(name => name === "gloves.png" || name.includes("팔찌")), shoes: "shoes.png", cape: "back.png" };
  for (const [slot, name] of Object.entries(icons)) {
    if (!name) throw new Error(`${folder} ${slot} 아이콘 누락`);
    await copy(icon(folder, name), path.join(OUTPUT, "item-icons", `${slug}-${slot}.png`));
  }
  for (const frame of frames) {
    const out = part => path.join(OUTPUT, "motion", slug, `${frame}-${part}.png`);
    await copy(layer(folder, frame, "back"), out("back"));
    await copy(layer(folder, frame, "hat"), out("hat"));
    await copy(layer(folder, frame, "weapon"), out("weapon"));
    await merge([layer(folder, frame, "shoe-screen-left"), layer(folder, frame, "shoe-screen-right")], out("shoes"));
    const body = [layer(folder, frame, "body")];
    const sleeves = [];
    const gloves = [layer(folder, frame, "glove-far"), layer(folder, frame, "glove-near")];
    if (slug === "royal-knight") body.push(layer(folder, frame, "chest"));
    if (slug === "snake-water-guardian") { body.push(layer(folder, frame, "pauldron-far")); sleeves.push(layer(folder, frame, "pauldron-near")); }
    if (slug === "magical-girl") sleeves.push(layer(folder, frame, "sleeves"));
    if (slug === "king") { body.push(layer(folder, frame, "sleeve-far")); sleeves.push(layer(folder, frame, "sleeve-near")); gloves.push(layer(folder, frame, "wrist-beads")); }
    await merge(body, out("body"));
    await merge(gloves, out("gloves"));
    if (sleeves.length) await merge(sleeves, out("sleeves"));
  }
}

async function importFaces() {
  const folder = "얼굴치장10종";
  for (const [iconName, layerName, slug] of faces) {
    await copy(icon(folder, `${iconName}.png`), path.join(OUTPUT, "item-icons", `${slug}-face.png`));
    for (const frame of frames) await copy(layer(folder, frame, layerName), path.join(OUTPUT, "motion", slug, `${frame}-face.png`));
  }
  await copy(icon("골판지크레용", "face.png"), path.join(OUTPUT, "item-icons", "cardboard-brows-face.png"));
  for (const frame of frames) await copy(layer("골판지크레용", frame, "brows"), path.join(OUTPUT, "motion", "cardboard-brows", `${frame}-face.png`));
}

async function importHoods() {
  const iconRoot = path.join(inputRoot, "싸피후드집업", "item-icons");
  const folders = { black: "싸피후드-검정", blue: "싸피후드-파랑", white: "싸피후드-하양" };
  for (const [color, folder] of Object.entries(folders)) {
    const slug = `ssafy-hood-${color}`;
    await copy(path.join(iconRoot, `body-${color}.png`), path.join(OUTPUT, "item-icons", `${slug}-top.png`));
    for (const frame of frames) {
      await merge([layer(folder, frame, "pants"), layer(folder, frame, "body")], path.join(OUTPUT, "motion", slug, `${frame}-body.png`));
      await merge([layer(folder, frame, "sleeves-far"), layer(folder, frame, "sleeves-near")], path.join(OUTPUT, "motion", slug, `${frame}-sleeves.png`));
    }
  }
}

async function main() {
  for (const [folder, slug] of sets) await importSet(folder, slug);
  await importFaces();
  await importHoods();
  console.log(`세트 ${sets.length}종, 얼굴 ${faces.length + 1}종, 이벤트 후드 3종 에셋 반입 완료`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
