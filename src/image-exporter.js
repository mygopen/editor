import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

export async function saveExtractedImages({ docId, images, rootDir }) {
  const docImageDir = path.join(rootDir, docId);
  await mkdir(docImageDir, { recursive: true });

  const saved = new Map();
  let skippedCount = 0;

  for (const image of images) {
    const parsed = parseDataImage(image.src);
    if (!parsed) {
      skippedCount += 1;
      continue;
    }

    const fileName = `image-${String(image.index + 1).padStart(2, "0")}.${parsed.extension}`;
    const absolutePath = path.join(docImageDir, fileName);
    await writeFile(absolutePath, parsed.buffer);

    saved.set(image.index, {
      absolutePath,
      fileName,
      mimeType: parsed.mimeType,
      relativePath: path.join("exported-images", docId, fileName),
      sizeBytes: parsed.buffer.byteLength,
      url: `/exported-images/${encodeURIComponent(docId)}/${encodeURIComponent(fileName)}`
    });
  }

  return {
    directory: docImageDir,
    relativeDirectory: path.join("exported-images", docId),
    saved,
    savedCount: saved.size,
    skippedCount
  };
}

function parseDataImage(src) {
  const match = String(src || "").match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) return null;

  return {
    buffer: Buffer.from(match[2], "base64"),
    extension,
    mimeType
  };
}
