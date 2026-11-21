// 아트가 넘겨준 프레임별 레이어를 우리가 쓰는 부위별 낱장으로 옮길 계획을 만든다.
// 겹치는 차례는 파일 이름 앞 번호에 이미 들어 있어서 우리가 짐작할 것이 없다.
const fs = require("fs"), path = require("path");

/** 폴더 이름 → 우리가 쓰는 슬러그. 클라이밍은 색만 다른 한 세트라 접미사로 가른다. */
const SLUGS = {
  "가죽경갑": "leather-guard", "고물기사": "scrap-knight", "죽창무사": "bamboo-spear",
  "거북이수호자": "turtle-guardian", "악마": "demon", "천사": "angel",
  "무지개떡": "rainbow-rice-cake", "청운": "cheongun",
  "요리사": "chef", "약과": "yakgwa", "클라이밍빨강": "climbing-red", "클라이밍파랑": "climbing-blue",
  "스시야": "sushi", "마법사": "mage", "목화화공": "cotton-painter", "달토끼": "moon-rabbit",
  "아프로": "afro", "블러셔": "blusher", "오드아이": "odd-eye", "오르골": "music-box",
};

/**
 * 아트 레이어 이름 → 우리 부위.
 * `character`와 `arms`는 어느 장비도 아니다. 모든 세트에서 같은 그림이라 한 벌만 따로 보관하고
 * 세트 폴더에서는 버린다. 신발은 좌우 두 장을 한 장으로 합친다.
 * 안경은 얼굴 슬롯을 쓴다. 볼터치·눈과 한 자리를 두고 다툰다.
 */
const PARTS = {
  back: "back", body: "body", sleeves: "sleeves", hat: "hat", weapon: "weapon", gloves: "gloves",
  face: "face", glasses: "face",
  shoe_left: "shoes", "shoe-screen-left": "shoes", shoe_right: "shoes", "shoe-screen-right": "shoes",
  character: null, base: null, arms: null,
};

function plan(workRoot) {
  const jobs = [];
  const shared = { body: new Map(), arms: new Map() };
  for (const folder of fs.readdirSync(workRoot)) {
    if (folder === "base") continue;
    // 폴더 이름은 반입 전에 슬러그로 바꿔 둔다. 한글 경로가 도구 사이를 오가면 깨진다.
    const slug = Object.values(SLUGS).includes(folder) ? folder : SLUGS[folder];
    if (!slug) throw new Error(`슬러그를 모르는 폴더: ${folder}`);
    const dir = path.join(workRoot, folder, "layers");
    const byFramePart = new Map();
    for (const name of fs.readdirSync(dir)) {
      const match = /^([a-z0-9]+_\d\d)-\d\d_(.+)\.png$/.exec(name);
      if (!match) throw new Error(`이름을 읽을 수 없는 레이어: ${folder}/${name}`);
      const [, frame, rawPart] = match;
      // 공용 마네킹과 팔은 한 벌만 챙긴다. 어느 세트에서 가져와도 같은 그림이다.
      if (rawPart === "character" || rawPart === "base") { shared.body.set(frame, path.join(dir, name)); continue; }
      if (rawPart === "arms") { shared.arms.set(frame, path.join(dir, name)); continue; }
      const part = PARTS[rawPart];
      if (part === undefined) throw new Error(`모르는 부위: ${folder}/${name}`);
      if (part === null) continue;
      const key = `${frame}-${part}`;
      if (!byFramePart.has(key)) byFramePart.set(key, []);
      byFramePart.get(key).push(path.join(dir, name));
    }
    for (const [key, sources] of byFramePart) {
      jobs.push({ out: `${slug}/${key}.png`, sources: sources.sort() });
    }
  }
  for (const [frame, source] of shared.body) jobs.push({ out: `body/${frame}.png`, sources: [source], dedupe: true });
  for (const [frame, source] of shared.arms) jobs.push({ out: `arms/${frame}.png`, sources: [source], dedupe: true });
  // 같은 공용 판이 세트마다 한 번씩 들어왔다. 마지막 하나만 남기면 된다.
  const seen = new Set();
  return jobs.filter(job => !seen.has(job.out) && seen.add(job.out));
}

module.exports = { plan, SLUGS, PARTS };
if (require.main === module) {
  const jobs = plan(process.argv[2]);
  fs.writeFileSync(process.argv[3], JSON.stringify(jobs, null, 1));
  const bySlug = {};
  for (const job of jobs) { const slug = job.out.split("/")[0]; bySlug[slug] = (bySlug[slug] || 0) + 1; }
  console.log(`작업 ${jobs.length}개`);
  for (const [slug, count] of Object.entries(bySlug).sort()) console.log(` ${slug.padEnd(20)} ${count}`);
}
