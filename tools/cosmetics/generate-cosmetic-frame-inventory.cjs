#!/usr/bin/env node
// Run from repository root: node tools/cosmetics/generate-cosmetic-frame-inventory.cjs
// The generated admin import contains metadata only; binaries stay in apps/web/public.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const motionRoot = path.join(root, "apps/web/public/cosmetics/motion");
const charactersRoot = path.join(root, "apps/web/public/assets/characters");
const outputPath = path.join(root, "apps/admin-console/src/cosmeticFrameInventory.json");

function directories(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function filesRecursively(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesRecursively(absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) found.push(absolute);
  }
  return found;
}

function readPngDimensions(file) {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(24);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length ||
        !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        header.toString("ascii", 12, 16) !== "IHDR") {
      throw new Error(`Not a PNG with an IHDR header: ${path.relative(root, file)}`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function parseMotionFrame(filename) {
  const match = /^(.*)[_-](\d+)(?:-(.+))?$/u.exec(filename.replace(/\.png$/iu, ""));
  if (!match || !match[1]) throw new Error(`Unrecognized frame filename: ${filename}`);
  return { motion: match[1], frame: Number(match[2]), layer: match[3] || "base" };
}

function safeSegment(value) {
  if (!value || value === "." || value === ".." || /[\\/\0]/u.test(value)) {
    throw new Error(`Unsafe inventory path segment: ${value}`);
  }
  return value;
}

function buildMotionFrames() {
  const frames = [];
  for (const group of directories(motionRoot)) {
    for (const file of filesRecursively(path.join(motionRoot, group))) {
      const relativePath = path.relative(motionRoot, file).split(path.sep).join("/");
      const group = relativePath.split("/")[0];
      const { motion, frame, layer } = parseMotionFrame(path.basename(file));
      const dims = readPngDimensions(file);
      frames.push({
        id: `motion:${relativePath}`,
        collection: "game-motion",
        group: safeSegment(group),
        motion,
        frame,
        layer,
        url: `/cosmetics/motion/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
        width: dims.width,
        height: dims.height,
      });
    }
  }
  return frames;
}

function buildRuntimeFrames() {
  const frames = [];
  for (const collection of directories(charactersRoot)) {
    const packageDirectory = path.join(charactersRoot, collection, "runtime-equipment-v1");
    const manifestPath = path.join(packageDirectory, `${collection}-equipment-manifest.json`);
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.schemaVersion !== "hanjjak.hero-equipment-atlas/v1") {
      throw new Error(`Unexpected runtime manifest schema: ${path.relative(root, manifestPath)}`);
    }
    const { frameWidth, frameHeight } = manifest.coordinateSpace;
    const { columns, frameOrder } = manifest.atlasGrid;
    if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || !Number.isInteger(columns) || !Array.isArray(frameOrder)) {
      throw new Error(`Invalid frame grid in ${path.relative(root, manifestPath)}`);
    }
    for (const [group, atlas] of Object.entries(manifest.atlases)) {
      for (const [motion, sheetRelativePath] of Object.entries(atlas.motionSheets || {})) {
        const sheetFile = path.join(packageDirectory, sheetRelativePath);
        if (!fs.existsSync(sheetFile)) throw new Error(`Missing runtime motion sheet: ${path.relative(root, sheetFile)}`);
        const sheetDims = readPngDimensions(sheetFile);
        if (sheetDims.width !== columns * frameWidth || sheetDims.height !== frameHeight) {
          throw new Error(`Runtime sheet dimensions do not match manifest grid: ${path.relative(root, sheetFile)}`);
        }
        for (const frame of frameOrder) {
          const key = `${motion}_${String(frame).padStart(2, "0")}`;
          const mapping = manifest.frames[key];
          if (!mapping || mapping.motion !== motion || mapping.frame !== frame) {
            throw new Error(`Manifest has no mapped frame ${key} for ${collection}/${group}`);
          }
          const x = mapping.column * frameWidth;
          if (x < 0 || x + frameWidth > sheetDims.width) throw new Error(`Crop outside runtime sheet: ${collection}/${group}/${key}`);
          frames.push({
            id: `runtime:${collection}:${group}:${key}`,
            collection: safeSegment(collection),
            group: safeSegment(group),
            motion,
            frame,
            layer: group,
            url: `/assets/characters/${encodeURIComponent(collection)}/runtime-equipment-v1/${sheetRelativePath.split("/").map(encodeURIComponent).join("/")}`,
            crop: { x, y: 0, width: frameWidth, height: frameHeight },
            width: frameWidth,
            height: frameHeight,
            sheetWidth: sheetDims.width,
            sheetHeight: sheetDims.height,
          });
        }
      }
    }
  }
  return frames;
}

const allFrames = [...buildMotionFrames(), ...buildRuntimeFrames()]
  .sort((a, b) => a.collection.localeCompare(b.collection) || a.group.localeCompare(b.group) || a.motion.localeCompare(b.motion) || a.frame - b.frame || a.layer.localeCompare(b.layer));
const ids = new Set();
for (const frame of allFrames) {
  if (ids.has(frame.id)) throw new Error(`Duplicate inventory id: ${frame.id}`);
  ids.add(frame.id);
}

const motionGroups = {};
const runtimeGroups = {};
for (const frame of allFrames) {
  if (frame.crop) {
    const groups = runtimeGroups[frame.collection] ??= {};
    const group = groups[frame.group] ??= {};
    const sheet = group[frame.motion] ??= {
      url: frame.url,
      sheetWidth: frame.sheetWidth,
      sheetHeight: frame.sheetHeight,
      frames: [],
    };
    sheet.frames.push([frame.frame, frame.crop.x, frame.crop.y, frame.crop.width, frame.crop.height]);
  } else {
    const group = motionGroups[frame.group] ??= [];
    const relativePath = frame.id.slice("motion:".length);
    group.push([frame.motion, frame.frame, frame.layer, relativePath, frame.width, frame.height]);
  }
}

const inventory = {
  schemaVersion: 1,
  generatedFrom: ["apps/web/public/cosmetics/motion", "apps/web/public/assets/characters/*/runtime-equipment-v1"],
  motionGroups,
  runtimeGroups,
};
fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Wrote ${allFrames.length} PNG frame records in ${Object.keys(motionGroups).length + Object.values(runtimeGroups).reduce((count, groups) => count + Object.keys(groups).length, 0)} groups to ${path.relative(root, outputPath)}`);
