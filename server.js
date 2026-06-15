import express from "express";
import path from "node:path";
import { convertGoogleDocHtml, extractGoogleDocId } from "./src/converter.js";
import { saveExtractedImages } from "./src/image-exporter.js";

const app = express();
const port = process.env.PORT || 5173;
const imageExportRoot = path.resolve("exported-images");

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use("/exported-images", express.static(imageExportRoot));

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
        skippedCount: imageExport.skippedCount
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
