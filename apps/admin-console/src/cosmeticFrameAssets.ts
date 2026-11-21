import inventory from "./cosmeticFrameInventory.json";

type FrameCrop = { x: number; y: number; width: number; height: number };
export type GameFrame = {
  id: string;
  collection: string;
  group: string;
  motion: string;
  frame: number;
  layer: string;
  url: string;
  crop?: FrameCrop;
  width: number;
  height: number;
  sheetWidth?: number;
  sheetHeight?: number;
};
type WebpZipEntry = { path: string; blob: Blob };

type MotionTuple = [motion: string, frame: number, layer: string, relativePath: string, width: number, height: number];
type RuntimeSheet = {
  url: string;
  sheetWidth: number;
  sheetHeight: number;
  frames: Array<[frame: number, x: number, y: number, width: number, height: number]>;
};
type FrameInventory = {
  motionGroups: Record<string, MotionTuple[]>;
  runtimeGroups: Record<string, Record<string, Record<string, RuntimeSheet>>>;
};

const source = inventory as unknown as FrameInventory;
export const gameFrames: GameFrame[] = [
  ...Object.entries(source.motionGroups).flatMap(([group, frames]) => frames.map(([motion, frame, layer, relativePath, width, height]) => ({
    id: `motion:${relativePath}`,
    collection: "game-motion",
    group,
    motion,
    frame,
    layer,
    url: `/cosmetics/motion/${relativePath.replace(/\.png$/, ".webp").split("/").map(encodeURIComponent).join("/")}`,
    width,
    height,
  }))),
  ...Object.entries(source.runtimeGroups).flatMap(([collection, groups]) =>
    Object.entries(groups).flatMap(([group, motions]) =>
      Object.entries(motions).flatMap(([motion, sheet]) => sheet.frames.map(([frame, x, y, width, height]) => ({
        id: `runtime:${collection}:${group}:${motion}_${String(frame).padStart(2, "0")}`,
        collection,
        group,
        motion,
        frame,
        layer: group,
        url: sheet.url.replace(/\.png$/, ".webp"),
        crop: { x, y, width, height },
        width,
        height,
        sheetWidth: sheet.sheetWidth,
        sheetHeight: sheet.sheetHeight,
      }))),
    ),
  ),
];

const MAX_PARALLEL_DOWNLOADS = 6;
const MAX_ARCHIVE_INPUT_BYTES = 256 * 1024 * 1024;
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC_TABLE.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[i] = value >>> 0;
}

async function crc32(blob: Blob): Promise<number> {
  let crc = 0xffffffff;
  for (let offset = 0; offset < blob.size; offset += 64 * 1024) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + 64 * 1024).arrayBuffer());
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function webpDimensions(blob: Blob, label: string): Promise<{ width: number; height: number }> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") {
    throw new Error(`${label} is not a valid WebP image.`);
  }
  const bitmap = await createImageBitmap(blob);
  try { return { width: bitmap.width, height: bitmap.height }; }
  finally { bitmap.close(); }
}

export async function encodeWebp(blob: Blob, label: string): Promise<Blob> {
  if (blob.type === "image/webp") { await webpDimensions(blob, label); return blob; }
  const bitmap = await createImageBitmap(blob);
  try { return await cropWebp(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, label); }
  finally { bitmap.close(); }
}

function checkedZipPath(path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\") || /[\0-\x1f\x7f]/u.test(path)) {
    throw new Error(`Unsafe ZIP entry path: ${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) {
    throw new Error(`Unsafe ZIP entry path: ${path}`);
  }
  return path;
}

function zipFilename(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|\0-\x1f\x7f]/gu, "-").replace(/[. ]+$/gu, "").slice(0, 100);
  const base = cleaned || "cosmetic-frames";
  return base.toLowerCase().endsWith(".zip") ? base : `${base}.zip`;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function assertZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`The selected images exceed the ZIP32 ${label} limit.`);
  }
}

async function buildZip(entries: WebpZipEntry[]): Promise<Blob> {
  if (!entries.length) throw new Error("Select at least one WebP frame to download.");

  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  const now = dosDateTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(checkedZipPath(entry.path));
    if (nameBytes.byteLength > 0xffff) throw new Error(`ZIP entry path is too long: ${entry.path}`);
    assertZip32(entry.blob.size, "entry size");
    const checksum = await crc32(entry.blob);
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, now.time, true);
    localView.setUint16(12, now.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.blob.size, true);
    localView.setUint32(22, entry.blob.size, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader.buffer as ArrayBuffer, entry.blob);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, now.time, true);
    centralView.setUint16(14, now.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.blob.size, true);
    centralView.setUint32(24, entry.blob.size, true);
    centralView.setUint16(28, nameBytes.byteLength, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + entry.blob.size;
    assertZip32(offset, "local data size");
  }

  let centralSize = 0;
  for (const part of centralParts) centralSize += part.byteLength;
  assertZip32(centralSize, "central directory size");
  assertZip32(offset, "central directory offset");
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts.map((part) => part.buffer as ArrayBuffer), end.buffer as ArrayBuffer], { type: "application/zip" });
}

function triggerDownload(blob: Blob, name: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = zipFilename(name);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function downloadWebpZip(entries: WebpZipEntry[], name: string): Promise<void> {
  if (!entries.length) throw new Error("Select at least one WebP frame to download.");
  const paths = new Set<string>();
  let totalBytes = 0;
  const webpEntries: WebpZipEntry[] = [];
  for (const { path, blob: sourceBlob } of entries) {
    const blob = await encodeWebp(sourceBlob, path);
    const safePath = checkedZipPath(path);
    if (paths.has(safePath)) throw new Error(`Duplicate ZIP entry path: ${safePath}`);
    paths.add(safePath);
    totalBytes += blob.size;
    if (totalBytes > MAX_ARCHIVE_INPUT_BYTES) throw new Error("Selected WebPs exceed the 256 MiB ZIP limit.");
    if (!safePath.endsWith(".webp")) throw new Error(`ZIP image path must end in .webp: ${safePath}`);
    await webpDimensions(blob, safePath);
    webpEntries.push({ path: safePath, blob });
  }
  triggerDownload(await buildZip(webpEntries), name);
}

function frameZipPath(frame: GameFrame): string {
  const frameNumber = String(frame.frame).padStart(2, "0");
  return checkedZipPath(`${frame.collection}/${frame.group}/${frame.motion}/${frameNumber}-${frame.layer}.webp`);
}

function validatedSourceUrl(frame: GameFrame): string {
  const url = new URL(frame.url, window.location.href);
  if (url.origin !== window.location.origin || url.search || url.hash) throw new Error(`Frame URL must be a same-origin asset path: ${frame.id}`);
  const expectedPrefix = frame.crop
    ? `/assets/characters/${encodeURIComponent(frame.collection)}/runtime-equipment-v1/motion-sheets/`
    : "/cosmetics/motion/";
  if (!url.pathname.startsWith(expectedPrefix)) throw new Error(`Frame URL is outside the game asset roots: ${frame.id}`);
  return url.href;
}

async function fetchWebp(url: string, signal: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "same-origin" });
  } catch (error) {
    throw new Error(`Unable to fetch game WebP ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Unable to fetch game WebP ${url}: HTTP ${response.status}.`);
  const blob = await response.blob();
  await webpDimensions(blob, url);
  return blob;
}

async function cropWebp(bitmap: ImageBitmap, crop: FrameCrop, label: string): Promise<Blob> {
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > bitmap.width || crop.y + crop.height > bitmap.height) {
    throw new Error(`Frame crop is outside its WebP sheet: ${label}`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot crop runtime motion sheets.");
  context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
    if (value) resolve(value);
    else reject(new Error(`Could not encode runtime WebP crop: ${label}`));
  }, "image/webp", 0.82));
  await webpDimensions(blob, label);
  return blob;
}

async function selectedFrameWebpZipEntries(selected: GameFrame[]): Promise<WebpZipEntry[]> {
  if (!selected.length) throw new Error("Select at least one WebP frame to download.");
  for (const frame of selected) {
    validatedSourceUrl(frame);
    frameZipPath(frame);
  }
  const controller = new AbortController();
  const bitmapPromises = new Map<string, Promise<ImageBitmap>>();
  const remainingBitmapUses = new Map<string, number>();
  for (const frame of selected) {
    if (!frame.crop) continue;
    const url = validatedSourceUrl(frame);
    remainingBitmapUses.set(url, (remainingBitmapUses.get(url) ?? 0) + 1);
  }
  let totalBytes = 0;
  const storeEntry = (index: number, entry: WebpZipEntry): void => {
    totalBytes += entry.blob.size;
    if (totalBytes > MAX_ARCHIVE_INPUT_BYTES) throw new Error("Selected WebPs exceed the 256 MiB ZIP limit.");
    result[index] = entry;
  };
  const result = new Array<WebpZipEntry>(selected.length);
  let nextIndex = 0;
  let firstError: unknown;

  const getBitmap = (url: string): Promise<ImageBitmap> => {
    let pending = bitmapPromises.get(url);
    if (!pending) {
      pending = (async () => {
        const blob = await fetchWebp(url, controller.signal);
        const bitmap = await createImageBitmap(blob);
        return bitmap;
      })();
      bitmapPromises.set(url, pending);
    }
    return pending;
  };
  const releaseBitmap = async (url: string): Promise<void> => {
    const remaining = remainingBitmapUses.get(url);
    if (remaining === undefined || remaining > 1) {
      if (remaining !== undefined) remainingBitmapUses.set(url, remaining - 1);
      return;
    }
    remainingBitmapUses.delete(url);
    const pending = bitmapPromises.get(url);
    bitmapPromises.delete(url);
    if (pending) {
      try {
        (await pending).close();
      } catch {
        // The worker reports the original frame failure.
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (!firstError) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selected.length) return;
      const frame = selected[index];
      let runtimeUrl: string | undefined;
      try {
        const url = validatedSourceUrl(frame);
        const zipPath = frameZipPath(frame);
        if (frame.crop) {
          runtimeUrl = url;
          const bitmap = await getBitmap(url);
          if (bitmap.width !== frame.sheetWidth || bitmap.height !== frame.sheetHeight) {
            throw new Error(`Runtime sheet dimensions changed for frame ${frame.id}.`);
          }
          storeEntry(index, { path: zipPath, blob: await cropWebp(bitmap, frame.crop, frame.id) });
        } else {
          const blob = await fetchWebp(url, controller.signal);
          const dimensions = await webpDimensions(blob, frame.id);
          if (dimensions.width !== frame.width || dimensions.height !== frame.height) {
            throw new Error(`Game WebP dimensions changed for frame ${frame.id}.`);
          }
          storeEntry(index, { path: zipPath, blob });
        }
      } catch (error) {
        if (!firstError) {
          firstError = error;
          controller.abort();
        }
      } finally {
        if (runtimeUrl) await releaseBitmap(runtimeUrl);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_DOWNLOADS, selected.length) }, () => worker()));
  const settledBitmaps = await Promise.allSettled(Array.from(bitmapPromises.values()));
  for (const settled of settledBitmaps) {
    if (settled.status === "fulfilled") settled.value.close();
  }
  if (firstError) throw firstError;
  const paths = new Set<string>();
  for (const entry of result) {
    if (!entry) throw new Error("A selected WebP frame was not downloaded.");
    if (paths.has(entry.path)) throw new Error(`Duplicate selected frame path: ${entry.path}`);
    paths.add(entry.path);
  }
  return result;
}

export async function exportGameFrames(selected: GameFrame[], name: string): Promise<void> {
  const entries = await selectedFrameWebpZipEntries(selected);
  await downloadWebpZip(entries, name);
}
