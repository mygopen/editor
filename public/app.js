const form = document.querySelector("#convertForm");
const docUrlInput = document.querySelector("#docUrl");
const coverImageUrlInput = document.querySelector("#coverImageUrl");
const convertButton = document.querySelector("#convertButton");
const copyButton = document.querySelector("#copyButton");
const outputHtml = document.querySelector("#outputHtml");
const outputPanel = document.querySelector("#outputPanel");
const outputMeta = document.querySelector("#outputMeta");
const statusNode = document.querySelector("#status");
const statusBadge = document.querySelector("#statusBadge");
const htmlStats = document.querySelector("#htmlStats");
const imageOptions = document.querySelector("#imageOptions");
const imageList = document.querySelector("#imageList");
const imageCount = document.querySelector("#imageCount");
const imageTemplate = document.querySelector("#imageTemplate");
const downloadImagesButton = document.querySelector("#downloadImagesButton");

let lastImages = [];
let lastDocId = "";
let lastImageZipUrl = "";
let refreshTimer = 0;
const initialDocUrl = new URLSearchParams(window.location.search).get("docUrl");
const localAppUrl = new URL("http://localhost:5173/");

if (initialDocUrl) {
  docUrlInput.value = initialDocUrl;
}

if (window.location.protocol === "file:") {
  if (docUrlInput.value) {
    localAppUrl.searchParams.set("docUrl", docUrlInput.value);
  }

  setStatus("目前是用檔案方式開啟，正在切換到本機服務頁面...");
  setBadge("切換中");
  window.location.replace(localAppUrl.toString());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await convert();
});

copyButton.addEventListener("click", async () => {
  if (!outputHtml.value.trim()) return;
  const copied = await copyToClipboard(outputHtml.value);
  setStatus(copied ? "已複製 HTML，可貼到 Blogger。" : "已選取 HTML，請使用鍵盤複製。");
  setBadge(copied ? "已複製" : "已選取", "ready");
});

imageList.addEventListener("input", async (event) => {
  if (!event.target.matches("input")) return;
  scheduleOptionalRefresh();
});

coverImageUrlInput.addEventListener("input", () => {
  scheduleOptionalRefresh();
});

downloadImagesButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  downloadAllImages();
});

outputHtml.addEventListener("input", () => {
  updateOutputState();
});

async function convert({ preserveImages = false, quiet = false, scrollToOutput = true } = {}) {
  const imageUrls = getImageUrls();

  setBusy(true);
  if (!quiet) {
    setStatus("轉換中...");
    setBadge("轉換中");
  }

  try {
    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        docUrl: docUrlInput.value,
        coverImageUrl: coverImageUrlInput.value,
        imageUrls
      })
    });

    const payload = await readApiResponse(response);
    if (!response.ok) throw new Error(payload.error || "轉換失敗。");

    outputHtml.value = payload.articleHtml || "";
    lastDocId = payload.docId || "";
    lastImageZipUrl = payload.imageExport?.zipUrl || "";
    updateOutputState();
    if (payload.imageExport?.savedCount > 0 && !quiet) {
      outputMeta.textContent = `HTML code 已產生，圖片可下載，也已暫存在 ${payload.imageExport.relativeDirectory}。`;
    }

    if (!preserveImages) {
      renderImages(payload.images || []);
    } else {
      lastImages = payload.images || lastImages;
      updateImageCount();
    }

    const warningText = payload.warnings?.length ? ` ${payload.warnings.join(" ")}` : "";
    setStatus(`完成。${warningText}`.trim(), payload.warnings?.length ? "warn" : "");
    setBadge("可複製", payload.warnings?.length ? "" : "ready");

    if (!quiet && scrollToOutput) {
      outputPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    setStatus(getFriendlyError(error), "error");
    setBadge("轉換失敗", "error");
  } finally {
    setBusy(false);
  }
}

function renderImages(images) {
  lastImages = images;
  imageList.replaceChildren();
  imageOptions.hidden = images.length === 0;

  for (const image of images) {
    const fragment = imageTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".image-item");
    const preview = fragment.querySelector(".image-preview");
    const label = fragment.querySelector("label");
    const input = fragment.querySelector("input");
    const meta = fragment.querySelector(".image-meta");
    const savedLink = fragment.querySelector(".saved-image-link");
    const downloadLink = fragment.querySelector(".download-image-link");
    const savedPath = fragment.querySelector(".saved-image-path");
    const download = getImageDownload(image);

    item.dataset.index = image.index;
    label.textContent = image.label;
    input.dataset.index = image.index;
    meta.textContent = [
      image.width && `${Math.round(image.width)}px`,
      image.height && `${Math.round(image.height)}px`,
      image.saved?.sizeBytes && formatBytes(image.saved.sizeBytes)
    ]
      .filter(Boolean)
      .join(" × ");

    if (image.saved?.url) {
      savedLink.href = image.saved.url;
      savedPath.textContent = image.saved.relativePath;
    } else {
      savedLink.hidden = true;
      savedPath.textContent = "未另存：圖片不是可解析的內嵌圖片。";
    }

    if (download.href) {
      downloadLink.href = download.href;
      downloadLink.download = download.fileName;
    } else {
      downloadLink.hidden = true;
    }

    const previewSrc = image.saved?.url || image.src;
    if (previewSrc) {
      const img = document.createElement("img");
      img.src = previewSrc;
      img.alt = image.alt || image.label;
      preview.append(img);
    }

    imageList.append(fragment);
  }

  updateImageCount();
}

function updateImageCount() {
  imageCount.textContent = `${lastImages.length} 張圖片`;
  downloadImagesButton.disabled = !lastImageZipUrl && !lastImages.some((image) => getImageDownload(image).href);
}

function downloadAllImages() {
  if (lastImageZipUrl) {
    triggerDownload(lastImageZipUrl, `${lastDocId || "google-doc"}-images.zip`);
    setStatus("已開始下載全部圖片 ZIP。");
    setBadge("下載中", "ready");
    return;
  }

  const downloads = lastImages.map(getImageDownload).filter((download) => download.href);
  if (downloads.length === 0) {
    setStatus("目前沒有可下載的圖片。", "warn");
    setBadge("無圖片");
    return;
  }

  downloads.forEach((download, index) => {
    window.setTimeout(() => {
      triggerDownload(download.href, download.fileName);
    }, index * 180);
  });
  setStatus(`已開始下載 ${downloads.length} 張圖片。`);
  setBadge("下載中", "ready");
}

function getImageDownload(image) {
  const href = image.saved?.url || image.src || "";
  if (!href) return { href: "", fileName: "" };

  return {
    href,
    fileName: image.saved?.fileName || `image-${String(image.index + 1).padStart(2, "0")}.${inferImageExtension(href)}`
  };
}

function triggerDownload(href, fileName) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

function updateOutputState() {
  const length = outputHtml.value.length;
  htmlStats.textContent = `${length.toLocaleString("zh-TW")} 字元`;
  outputMeta.textContent = length ? "HTML code 已產生。" : "轉換後的 HTML 會出現在這裡。";
  outputPanel.classList.toggle("has-output", length > 0);
  copyButton.disabled = convertButton.disabled || length === 0;
}

function getImageUrls() {
  const urls = [];
  imageList.querySelectorAll("input").forEach((input) => {
    urls[Number(input.dataset.index)] = input.value.trim();
  });
  return urls;
}

function setBusy(isBusy) {
  convertButton.disabled = isBusy;
  copyButton.disabled = isBusy || !outputHtml.value.trim();
}

function setStatus(message, tone = "") {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`.trim();
}

function setBadge(message, tone = "") {
  statusBadge.textContent = message;
  statusBadge.className = `signal-status ${tone}`.trim();
}

function scheduleOptionalRefresh() {
  if (!outputHtml.value.trim()) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    convert({ preserveImages: true, quiet: true, scrollToOutput: false });
  }, 350);
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }

  outputHtml.focus();
  outputHtml.select();
  return document.execCommand("copy");
}

function getApiUrl() {
  return window.location.protocol === "file:" ? "http://localhost:5173/api/convert" : "/api/convert";
}

async function readApiResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text || "{}");
    } catch {
      throw new Error("轉換服務回傳的 JSON 格式異常，請重新整理後再試。");
    }
  }

  if (!text.trim()) {
    throw new Error(`轉換服務沒有回傳內容（HTTP ${response.status}）。`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(describeNonJsonResponse(response, text));
  }
}

function describeNonJsonResponse(response, text) {
  const title = extractHtmlTitle(text);
  const statusText = response.status ? `HTTP ${response.status}` : "非 JSON 回應";

  if (/Worker exceeded resource limits/i.test(text)) {
    return `轉換服務超過 Cloudflare 資源限制（${statusText}）。通常是 Google 文件內嵌圖片太大，請稍後重試或先用本機版轉換。`;
  }

  if (response.status === 404) {
    return `找不到轉換 API（${statusText}）。請確認網站部署包含 Cloudflare Pages Functions。`;
  }

  if (/^<!doctype html/i.test(text.trim()) || /<html[\s>]/i.test(text)) {
    return `轉換 API 回傳 HTML 錯誤頁（${statusText}${title ? `：${title}` : ""}），不是 JSON。`;
  }

  return `轉換 API 回傳非 JSON 內容（${statusText}）。`;
}

function extractHtmlTitle(text) {
  const match = String(text || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";

  const textarea = document.createElement("textarea");
  textarea.innerHTML = match[1].replace(/\s+/g, " ").trim();
  return textarea.value;
}

function getFriendlyError(error) {
  if (window.location.protocol === "file:") {
    return "請用 http://localhost:5173 開啟工具，不要直接開 index.html 檔案。";
  }
  if (error instanceof TypeError) {
    return "轉換服務沒有回應，請確認本機服務正在執行。";
  }
  return error.message || "轉換失敗。";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function inferImageExtension(src) {
  const mimeMatch = String(src).match(/^data:image\/([a-z0-9.+-]+);/i);
  if (mimeMatch) {
    const mimeExtension = mimeMatch[1].toLowerCase();
    return mimeExtension === "jpeg" ? "jpg" : mimeExtension;
  }

  try {
    const pathname = new URL(src, window.location.href).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    if (/^(gif|jpe?g|png|webp)$/.test(extension || "")) return extension;
  } catch {
    // Keep the generic fallback below.
  }

  return "png";
}

updateOutputState();
