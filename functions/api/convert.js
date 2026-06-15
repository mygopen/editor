import { convertGoogleDocHtml, extractGoogleDocId } from "../../src/converter.js";

export async function onRequestPost(context) {
  try {
    const { docUrl, coverImageUrl = "", imageUrls = [] } = await context.request.json();
    const docId = extractGoogleDocId(docUrl || "");

    if (!docId) {
      return json({ error: "請貼上有效的 Google 文件連結。" }, 400);
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;
    const response = await fetch(exportUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 GoogleDocsBloggerEditor/1.0"
      }
    });

    if (!response.ok) {
      return json(
        {
          error:
            response.status === 401 || response.status === 403
              ? "無法讀取文件。請確認 Google 文件已開啟「知道連結的使用者可查看」。"
              : `Google 文件匯出失敗：HTTP ${response.status}`
        },
        response.status
      );
    }

    const sourceHtml = await response.text();
    const result = convertGoogleDocHtml(sourceHtml, {
      coverImageUrl,
      imageUrls
    });

    return json({
      docId,
      exportUrl,
      ...result,
      imageExport: {
        directory: "",
        relativeDirectory: "",
        savedCount: 0,
        skippedCount: result.images.length,
        zipUrl: "",
        note: "Cloudflare Pages 部署版不提供本機圖片資料夾 ZIP；請使用單張下載或本機版匯出全部圖片。"
      }
    });
  } catch (error) {
    return json({ error: error.message || "轉換失敗。" }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: "請用 POST /api/convert 轉換 Google 文件。" }, 405);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
