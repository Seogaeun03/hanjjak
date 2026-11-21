const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const importer = fs.readFileSync(path.join(__dirname, "import-expanded-cosmetics.cjs"), "utf8");

test("싸피 후드 몸통은 바지 위에 상의를 합성한다", () => {
  assert.match(
    importer,
    /merge\(\[layer\(folder, frame, "pants"\), layer\(folder, frame, "body"\)\]/,
  );
});
