const path = require("node:path");
const sharp = require(path.resolve(__dirname, "../../apps/web/node_modules/sharp"));

const assetDirectory = path.resolve(
  __dirname,
  "../../apps/web/src/features/character/assets-cozy-pixel/empty-slots-v1",
);
const source = path.join(assetDirectory, "source-sheet.png");

// The approved concept sheet is a 1536x1024 transparent canvas with four
// icons on the first row and three on the second. Keep the crop coordinates
// here so the production assets can be recreated without manual editing.
const slots = {
  head: { left: 0, top: 128, width: 400, height: 420 },
  top: { left: 376, top: 128, width: 400, height: 420 },
  weapon: { left: 772, top: 128, width: 360, height: 420 },
  gloves: { left: 1120, top: 128, width: 415, height: 420 },
  shoes: { left: 96, top: 544, width: 448, height: 448 },
  cape: { left: 544, top: 544, width: 456, height: 448 },
  face: { left: 992, top: 544, width: 512, height: 448 },
};

async function main() {
  for (const [slot, crop] of Object.entries(slots)) {
    // Decode the crop first. Keeping crop and trim in separate pipelines avoids
    // libvips reordering trim ahead of an edge-aligned extract.
    const cropped = await sharp(source).extract(crop).png().toBuffer();
    const { data: icon, info } = await sharp(cropped)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
      .resize(216, 216, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    const horizontalPadding = 256 - info.width;
    const verticalPadding = 256 - info.height;
    await sharp(icon)
      .extend({
        top: Math.floor(verticalPadding / 2),
        bottom: Math.ceil(verticalPadding / 2),
        left: Math.floor(horizontalPadding / 2),
        right: Math.ceil(horizontalPadding / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(path.join(assetDirectory, `empty-slot-${slot}.png`));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
