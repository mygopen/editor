import express from "express";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { convertGoogleDocHtml, extractGoogleDocId } from "./src/converter.js";
import { saveExtractedImages } from "./src/image-exporter.js";
import { createStoredZip } from "./src/zip.js";

const app = express();
const port = process.env.PORT || 5173;
const imageExportRoot = path.resolve("exported-images");

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use("/exported-images", express.static(imageExportRoot));

app.get("/api/images/:docId.zip", async (req, res) => {
  try {
    const docId = extractGoogleDocId(req.params.docId || "");
    if (!docId) {
      res.status(400).send("Invalid Google document id.");
      return;
    }

    const imageDir = path.join(imageExportRoot, docId);
    const files = (await readdir(imageDir, { withFileTypes: true }))
      .filter((file) => file.isFile() && /^image-\d+\.(?:gif|jpe?g|png|webp)$/i.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    if (files.length === 0) {
      res.status(404).send("No exported images found.");
      return;
    }

    const entries = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        data: await readFile(path.join(imageDir, file.name))
      }))
    );
    const zip = createStoredZip(entries);
    const fileName = `${docId}-images.zip`;

    res.setHeader("content-type", "application/zip");
    res.setHeader("content-disposition", `attachment; filename="${fileName}"`);
    res.setHeader("content-length", String(zip.byteLength));
    res.send(zip);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.status(404).send("No exported images found.");
      return;
    }
    res.status(500).send(error.message || "Failed to build image zip.");
  }
});

app.post("/api/convert", async (req, res) => {
  try {
    const { docUrl, coverImageUrl = "", imageUrls = [] } = req.body || {};
    const docId = extractGoogleDocId(docUrl || "");

    if (!docId) {
      res.status(400).json({ error: "請貼上有效的 Google 文件連結。" });
      return;
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(exportUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 GoogleDocsBloggerEditor/1.0"
      },
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      res.status(response.status).json({
        error:
          response.status === 401 || response.status === 403
            ? "無法讀取文件。請確認 Google 文件已開啟「知道連結的使用者可查看」。"
            : `Google 文件匯出失敗：HTTP ${response.status}`
      });
      return;
    }

    const sourceHtml = await response.text();
    const result = convertGoogleDocHtml(sourceHtml, {
      coverImageUrl,
      imageUrls
    });
    const imageExport = await saveExtractedImages({
      docId,
      images: result.images,
      rootDir: imageExportRoot
    });
    const images = result.images.map((image) => ({
      ...image,
      saved: imageExport.saved.get(image.index) || null
    }));

    res.json({
      docId,
      exportUrl,
      ...result,
      images,
      imageExport: {
        directory: imageExport.directory,
        relativeDirectory: imageExport.relativeDirectory,
        savedCount: imageExport.savedCount,
        skippedCount: imageExport.skippedCount,
        zipUrl: imageExport.savedCount > 0 ? `/api/images/${encodeURIComponent(docId)}.zip` : ""
      }
    });
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? "Google 文件讀取逾時，請稍後再試。"
        : error.message || "轉換失敗。";

    res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Google Docs Blogger editor is running at http://localhost:${port}`);
});
