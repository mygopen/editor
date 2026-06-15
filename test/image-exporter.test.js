import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { saveExtractedImages } from "../src/image-exporter.js";

test("saveExtractedImages writes data URL images to doc-specific folder", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "blogger-images-"));

  try {
    const result = await saveExtractedImages({
      docId: "doc_123",
      rootDir,
      images: [
        {
          index: 0,
          src: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
        },
        {
          index: 1,
          src: "https://example.com/not-inline.jpg"
        }
      ]
    });

    assert.equal(result.savedCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.relativeDirectory, path.join("exported-images", "doc_123"));

    const saved = result.saved.get(0);
    assert.equal(saved.fileName, "image-01.png");
    assert.equal(saved.mimeType, "image/png");
    assert.equal(saved.relativePath, path.join("exported-images", "doc_123", "image-01.png"));
    assert.equal(await readFile(saved.absolutePath, "utf8"), "png-bytes");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
