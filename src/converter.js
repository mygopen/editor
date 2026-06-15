import * as cheerio from "cheerio";

const MARKERS = {
  content: "內容",
  rumor: "原始謠傳版本",
  platform: "並在社群平台流傳",
  explanation: "查證解釋",
  sources: "資料來源",
  healthResources: "衛教資源",
  expert: "諮詢專家",
  furtherReading: "延伸閱讀"
};

export function extractGoogleDocId(input) {
  const value = String(input || "").trim();
  const urlMatch = value.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(value) ? value : "";
}

export function convertGoogleDocHtml(sourceHtml, options = {}) {
  const $ = cheerio.load(sourceHtml);
  const classStyles = parseClassStyles($("style").text() || "");
  const blocks = extractBlocks($, classStyles);
  const images = blocks
    .filter((block) => block.type === "image")
    .map(({ src, width, height, alt, imageIndex }) => ({
      index: imageIndex,
      label: `圖片 ${imageIndex + 1}`,
      width,
      height,
      alt,
      src
    }));

  const warnings = [];
  const articleHtml = buildBloggerHtml(blocks, options, warnings);
  const titleBlock = blocks.find((block) => block.type === "heading" && block.level === 2);

  return {
    title: titleBlock?.text || "",
    articleHtml,
    images,
    warnings
  };
}

function extractBlocks($, classStyles) {
  const blocks = [];
  let imageIndex = 0;

  $("body")
    .children()
    .each((_, element) => {
      const tag = element.tagName?.toLowerCase();

      if (tag === "hr") {
        blocks.push({ type: "hr" });
        return;
      }

      if (/^h[1-6]$/.test(tag || "")) {
        blocks.push({
          type: "heading",
          level: Number(tag.slice(1)),
          text: normalizeText($(element).text()),
          html: renderInlineChildren($, element, classStyles)
        });
        return;
      }

      if (tag !== "p") return;

      const images = $(element).find("img").toArray();
      const text = normalizeText($(element).text());
      const inlineHtml = renderInlineChildren($, element, classStyles);
      const links = extractLinks($, element);

      if (text) {
        blocks.push({
          type: "paragraph",
          text,
          html: inlineHtml,
          links
        });
      }

      for (const image of images) {
        const dimensions = getImageDimensions($, image);
        blocks.push({
          type: "image",
          imageIndex,
          src: $(image).attr("src") || "",
          alt: $(image).attr("alt") || "",
          ...dimensions
        });
        imageIndex += 1;
      }

      if (!text && images.length === 0) {
        blocks.push({ type: "blank" });
      }
    });

  return blocks;
}

function buildBloggerHtml(blocks, options, warnings) {
  if (isFieldTemplateDraft(blocks)) {
    return buildFieldTemplateHtml(blocks, options, warnings);
  }

  const parts = [];
  const quoteTitleIndex = findIndexFrom(
    blocks,
    0,
    (block) => (block.type === "heading" || block.type === "paragraph") && block.text.includes("你可以先知道")
  );

  if (quoteTitleIndex === -1) {
    warnings.push("找不到「你可以先知道」段落，已改用一般段落輸出。");
    return renderFallback(blocks, options);
  }

  const quoteTitle = blocks[quoteTitleIndex];
  const quoteItems = [];
  let cursor = quoteTitleIndex + 1;

  while (cursor < blocks.length) {
    const block = blocks[cursor];
    if (block.type === "blank") {
      cursor += 1;
      continue;
    }
    if (block.type === "paragraph" && /^[(（]\d+[)）]/.test(block.text)) {
      quoteItems.push(block);
      cursor += 1;
      continue;
    }
    break;
  }

  if (quoteItems.length === 0) {
    warnings.push("「你可以先知道」後面沒有找到（1）（2）格式的摘要。");
  }

  const introIndex = findIndexFrom(blocks, cursor, (block) => block.type === "paragraph");
  const introBlock = introIndex >= 0 ? blocks[introIndex] : null;

  parts.push(renderQuote(quoteTitle, quoteItems));

  if (introBlock) {
    parts.push(`<div class="intro_words">${introBlock.html}</div>`);
  } else {
    warnings.push("找不到導言段落。");
  }

  parts.push(renderCoverImage(options.coverImageUrl || ""));
  parts.push("<!--more-->");

  const articleStartIndex = Math.max(introIndex + 1, cursor);
  const explicitTitleIndex = findIndexFrom(
    blocks,
    articleStartIndex,
    (block) => block.type === "heading" && block.level <= 2
  );
  const contentMarkerIndex = findMarkerIndex(blocks, articleStartIndex, MARKERS.content);
  const titleBlock = getTitleBlock(blocks, explicitTitleIndex, contentMarkerIndex);

  if (titleBlock) {
    parts.push(`<h2>${escapeHtml(titleBlock.text)}</h2>`);
  } else {
    warnings.push("找不到主標題，已略過主標題輸出。");
  }

  const markerStartIndex = explicitTitleIndex !== -1 ? explicitTitleIndex + 1 : articleStartIndex;
  const rumorMarkerIndex = findMarkerIndex(blocks, markerStartIndex, MARKERS.rumor);
  const platformMarkerIndex = findMarkerIndex(blocks, markerStartIndex, MARKERS.platform);
  const explanationMarkerIndex = findMarkerIndex(blocks, markerStartIndex, MARKERS.explanation);
  const sourcesMarkerIndex = firstExistingIndex(
    [
      findMarkerIndex(blocks, markerStartIndex, MARKERS.sources),
      findMarkerIndex(blocks, markerStartIndex, MARKERS.healthResources),
      findMarkerIndex(blocks, markerStartIndex, MARKERS.expert)
    ],
    -1
  );
  const furtherReadingMarkerIndex = findMarkerIndex(blocks, markerStartIndex, MARKERS.furtherReading);
  const contentIsRumor =
    contentMarkerIndex !== -1 && (rumorMarkerIndex === -1 || contentMarkerIndex < rumorMarkerIndex);

  if (contentIsRumor) {
    const rumorEnd = firstExistingIndex([rumorMarkerIndex, platformMarkerIndex, explanationMarkerIndex, sourcesMarkerIndex], blocks.length);
    const rumorBlocks = blocks
      .slice(contentMarkerIndex + 1, rumorEnd)
      .filter((block) => block.type === "paragraph");

    parts.push(`<br />${escapeHtml(MARKERS.rumor)}：<br />`);
    parts.push(`<blockquote class="tr_bq">${rumorBlocks.map((block) => block.html).join("\n")}</blockquote>`);

    if (rumorMarkerIndex !== -1 && platformMarkerIndex !== -1 && rumorMarkerIndex < platformMarkerIndex) {
      const leadBlocks = blocks
        .slice(rumorMarkerIndex + 1, platformMarkerIndex)
        .filter((block) => block.type === "paragraph");
      if (leadBlocks.length > 0) {
        parts.push(`<br />${leadBlocks.map((block) => block.html).join("<br />")}`);
      }
    }
  } else if (rumorMarkerIndex !== -1) {
    const rumorEnd = firstExistingIndex([platformMarkerIndex, explanationMarkerIndex, sourcesMarkerIndex], blocks.length);
    const rumorBlocks = blocks
      .slice(rumorMarkerIndex + 1, rumorEnd)
      .filter((block) => block.type === "paragraph");

    parts.push(`<br />${blocks[rumorMarkerIndex].html}<br />`);
    parts.push(`<blockquote class="tr_bq">${rumorBlocks.map((block) => block.html).join("\n")}</blockquote>`);
  }

  if (platformMarkerIndex !== -1) {
    const platformEnd = firstExistingIndex([explanationMarkerIndex, sourcesMarkerIndex], blocks.length);
    const platformBlocks = blocks.slice(platformMarkerIndex + 1, platformEnd);
    const platformImages = platformBlocks.filter((block) => block.type === "image");

    parts.push(`<br />\n${blocks[platformMarkerIndex].html}`);
    if (platformImages.length === 0) {
      parts.push(`<br /><br />${renderImagePlaceholder("社群流傳圖片")}`);
    } else {
      for (const image of platformImages) {
        parts.push(`<br /><br />${renderInlineImage(image, options)} <br /><br />`);
      }
    }
  }

  if (explanationMarkerIndex !== -1) {
    const explanationEnd = firstExistingIndex([sourcesMarkerIndex, furtherReadingMarkerIndex], blocks.length);
    const explanationBlocks = blocks.slice(explanationMarkerIndex + 1, explanationEnd);

    parts.push(`${blocks[explanationMarkerIndex].html}<br />`);
    parts.push(`<blockquote class="yestrue">\n${renderYesTrue(explanationBlocks, options)}\n</blockquote>`);
  }

  if (sourcesMarkerIndex !== -1) {
    const sourceEnd = firstExistingIndex([furtherReadingMarkerIndex], blocks.length);
    const sourceBlocks = blocks.slice(sourcesMarkerIndex + 1, sourceEnd);
    const sourceLines = renderSourceLines(sourceBlocks);

    parts.push(`<br />${blocks[sourcesMarkerIndex].html}<br /><br />${sourceLines.join("<br />")}`);
  }

  if (furtherReadingMarkerIndex !== -1) {
    const furtherBlocks = blocks.slice(furtherReadingMarkerIndex + 1);
    const furtherLines = renderSimpleLines(furtherBlocks);

    parts.push(`<br /><br />${blocks[furtherReadingMarkerIndex].html}<br /><br />${furtherLines.join("<br />")}`);
  }

  return joinMainParts(parts);
}

function isFieldTemplateDraft(blocks) {
  return blocks.some(
    (block) =>
      block.type === "paragraph" &&
      (/^導言摘要段[:：]/.test(block.text) ||
        /^首圖[:：]/.test(block.text) ||
        /^主要流傳這個影像[:：]/.test(block.text))
  );
}

function buildFieldTemplateHtml(blocks, options, warnings) {
  const fields = getFieldTemplateIndexes(blocks);
  const parts = [];
  const quoteBlocks = getFieldContent(blocks, fields.quote, nextFieldIndex(fields, "quote"), /^你可以先知道[:：]\s*/);
  const introBlocks = getFieldContent(blocks, fields.intro, nextFieldIndex(fields, "intro"), /^導言摘要段[:：]\s*/);
  const titleBlocks = getFieldContent(
    blocks,
    fields.coverTitle,
    nextFieldIndex(fields, "coverTitle"),
    /^首圖[:：]\s*(?:\[img\])?\s*大標[:：]\s*/
  );
  const rumorBlocks = getFieldContent(blocks, fields.rumor, nextFieldIndex(fields, "rumor"), /^原始謠傳版本[:：]\s*/);
  const mediaBlocks = getFieldContent(
    blocks,
    fields.media,
    nextFieldIndex(fields, "media"),
    /^主要流傳(?:這個影像|這段影片|這張圖片)?[:：]\s*(?:\[img\]\/\[video\])?\s*/
  );
  const platformBlocks = getFieldContent(
    blocks,
    fields.platform,
    nextFieldIndex(fields, "platform"),
    /^並在社群平台流傳[:：]\s*(?:\[img\])?\s*/
  );
  const explanationBlocks = getFieldContent(blocks, fields.explanation, nextFieldIndex(fields, "explanation"), /^查證解釋[:：]\s*/);
  const sourceBlocks = getFieldContent(blocks, fields.sources, nextFieldIndex(fields, "sources"), /^資料來源[:：]\s*/);
  const furtherBlocks = getFieldContent(blocks, fields.furtherReading, nextFieldIndex(fields, "furtherReading"), /^延伸閱讀[:：]\s*/);

  parts.push(renderFieldQuote(quoteBlocks, warnings));
  parts.push(`<div class="intro_words">${renderFieldParagraphs(introBlocks, "導言摘要段", warnings)}</div>`);
  parts.push(renderCoverImage(options.coverImageUrl || ""));
  parts.push("<!--more-->");

  const title = firstParagraphText(titleBlocks);
  if (title) {
    parts.push(`<h2>${escapeHtml(title)}</h2>`);
  } else {
    warnings.push("「大標」欄位尚未填寫。");
    parts.push("<h2><!-- 請填寫大標 --></h2>");
  }

  parts.push(`<br />${escapeHtml(MARKERS.rumor)}：<br />`);
  parts.push(`<blockquote class="tr_bq">${renderFieldParagraphs(rumorBlocks, "原始謠傳版本", warnings)}</blockquote>`);
  parts.push(renderMediaField(mediaBlocks, "主要流傳這個影像：", "主要流傳影像", options));
  parts.push(renderMediaField(platformBlocks, "並在社群平台流傳：", "社群流傳圖片", options));

  parts.push(`${escapeHtml(MARKERS.explanation)}：<br />`);
  parts.push(`<blockquote class="yestrue">\n${renderFieldYesTrue(explanationBlocks, options, warnings)}\n</blockquote>`);

  const sourceLines = renderSourceLines(sourceBlocks);
  if (sourceLines.length > 0) {
    parts.push(`<br />${escapeHtml(MARKERS.sources)}：<br /><br />${sourceLines.join("<br />")}`);
  } else {
    warnings.push("「資料來源」欄位尚未填寫。");
    parts.push(`<br />${escapeHtml(MARKERS.sources)}：<br /><br /><!-- 請填寫資料來源 -->`);
  }

  const furtherLines = renderSimpleLines(furtherBlocks);
  if (furtherLines.length > 0) {
    parts.push(`<br /><br />${escapeHtml(MARKERS.furtherReading)}：<br /><br />${furtherLines.join("<br />")}`);
  }

  return joinMainParts(parts);
}

function getFieldTemplateIndexes(blocks) {
  return {
    quote: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^你可以先知道[:：]/.test(block.text)),
    intro: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^導言摘要段[:：]/.test(block.text)),
    coverTitle: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^首圖[:：]/.test(block.text)),
    rumor: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^原始謠傳版本[:：]/.test(block.text)),
    media: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^主要流傳/.test(block.text)),
    platform: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^並在社群平台流傳/.test(block.text)),
    explanation: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^查證解釋[:：]/.test(block.text)),
    sources: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^資料來源[:：]/.test(block.text)),
    furtherReading: findIndexFrom(blocks, 0, (block) => block.type === "paragraph" && /^延伸閱讀[:：]/.test(block.text))
  };
}

function nextFieldIndex(fields, fieldName) {
  const current = fields[fieldName];
  if (current === -1) return -1;

  const later = Object.values(fields).filter((index) => index > current);
  return later.length > 0 ? Math.min(...later) : Number.POSITIVE_INFINITY;
}

function getFieldContent(blocks, startIndex, endIndex, labelPattern) {
  if (startIndex === -1) return [];

  const content = [];
  const labelBlock = blocks[startIndex];
  if (labelBlock?.type === "paragraph") {
    const inlineHtml = stripFieldLabelHtml(labelBlock.html, labelPattern);
    const inlineText = stripFieldLabelText(labelBlock.text, labelPattern);
    if (isUsefulFieldText(inlineText)) {
      content.push({
        ...labelBlock,
        text: inlineText,
        html: inlineHtml || escapeHtml(inlineText),
        links: labelBlock.links || []
      });
    }
  }

  const safeEnd = Number.isFinite(endIndex) ? endIndex : blocks.length;
  for (const block of blocks.slice(startIndex + 1, safeEnd)) {
    if (block.type === "blank" || block.type === "hr") continue;
    if (block.type === "paragraph" && !isUsefulFieldText(block.text)) continue;
    content.push(block);
  }

  return content;
}

function stripFieldLabelText(text, labelPattern) {
  return normalizeText(String(text || "").replace(labelPattern, ""));
}

function stripFieldLabelHtml(html, labelPattern) {
  const plainPrefix = String(html || "").match(labelPattern)?.[0];
  if (!plainPrefix || !String(html).startsWith(plainPrefix)) return String(html || "");
  return String(html).slice(plainPrefix.length).trim();
}

function isUsefulFieldText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return !/^(?:\[寫這邊\]|\[img\]|\[video\]|\[img\]\/\[video\])$/i.test(normalized);
}

function renderFieldQuote(blocks, warnings) {
  const body = renderFieldParagraphs(blocks, "你可以先知道", warnings);
  return `<div class="quote_style"><h3 style="text-align: center;">你可以先知道：</h3>${body}</div><br />`;
}

function renderFieldParagraphs(blocks, fieldName, warnings) {
  const paragraphs = blocks.filter((block) => block.type === "paragraph" && isUsefulFieldText(block.text));
  if (paragraphs.length === 0) {
    warnings.push(`「${fieldName}」欄位尚未填寫。`);
    return `<!-- 請填寫${fieldName} -->`;
  }

  return paragraphs.map((block) => block.html).join("\n<br /><br />\n");
}

function renderFieldYesTrue(blocks, options, warnings) {
  const meaningful = blocks.filter((block) => block.type !== "blank" && !(block.type === "paragraph" && !isUsefulFieldText(block.text)));
  if (meaningful.length === 0) {
    warnings.push("「查證解釋」欄位尚未填寫。");
    return "<!-- 請填寫查證解釋 -->";
  }
  return renderYesTrue(meaningful, options);
}

function renderMediaField(blocks, label, placeholderLabel, options) {
  const images = blocks.filter((block) => block.type === "image");
  const paragraphs = blocks.filter((block) => block.type === "paragraph" && isUsefulFieldText(block.text));
  const pieces = [`<br />${escapeHtml(label)}`];

  if (paragraphs.length > 0) {
    pieces.push(`<br /><br />${paragraphs.map((block) => block.html).join("<br />")}`);
  }

  if (images.length > 0) {
    for (const image of images) {
      pieces.push(`<br /><br />${renderInlineImage(image, options)} <br /><br />`);
    }
  } else {
    pieces.push(`<br /><br />${renderImagePlaceholder(placeholderLabel)}`);
  }

  return pieces.join("");
}

function firstParagraphText(blocks) {
  const block = blocks.find((item) => item.type === "paragraph" && isUsefulFieldText(item.text));
  return block ? block.text : "";
}

function renderQuote(titleBlock, quoteItems) {
  const title = stripTrailingColon(titleBlock.text);
  const body = quoteItems.map((block) => block.html).join("\n<br /><br />\n");
  return `<div class="quote_style"><h3 style="text-align: center;">${escapeHtml(title)}：</h3>${body}</div><br />`;
}

function renderCoverImage(url) {
  if (!url) {
    return "<!-- 封面圖：請在 Blogger 上傳圖片後，將 Blogger 產生的圖片 HTML 貼在這裡 -->";
  }

  const safeUrl = escapeAttribute(url);
  return `<div class="separator" style="clear: both;"><a href="${safeUrl}" style="display: block; padding: 1em 0px; text-align: center;"><img alt="" border="0" src="${safeUrl}" /></a></div>`;
}

function renderYesTrue(blocks, options) {
  const pieces = blocks
    .filter((block) => block.type !== "blank")
    .map((block) => {
      if (block.type === "image") {
        return {
          type: "image",
          html: renderInlineImage(block, options)
        };
      }

      if (block.type === "heading" || isConclusionHeading(block)) {
        return {
          type: "heading",
          html: `<h3 style="text-align: left;">${escapeHtml(stripTrailingColon(block.text))}</h3>`
        };
      }

      if (block.type === "paragraph") {
        if (isNumberedSectionHeading(block)) {
          return {
            type: "heading",
            html: `<h3 style="text-align: left;">${escapeHtml(stripTrailingColon(block.text))}</h3>`
          };
        }

        return {
          type: "paragraph",
          html: stripWholeBold(block.html)
        };
      }

      return null;
    })
    .filter(Boolean);

  let output = "";
  let previous = null;
  for (const piece of pieces) {
    if (!output) {
      output = piece.html;
      previous = piece;
      continue;
    }

    output += previous?.type === "heading" ? `<br />${piece.html}` : `<br /><br />${piece.html}`;
    previous = piece;
  }

  return output;
}

function renderSourceLines(blocks) {
  const lines = [];
  let previousPrefix = "";

  for (const block of blocks) {
    if (block.type !== "paragraph") continue;

    const links = block.links.filter((link) => normalizeText(link.text));
    if (links.length === 0) {
      lines.push(block.html);
      continue;
    }

    let prefix = block.text;
    for (const link of links) {
      prefix = prefix.replace(link.text, "");
    }
    prefix = normalizeText(prefix).replace(/\s+-\s*$/, " -");

    if (prefix && prefix !== previousPrefix) {
      lines.push(escapeHtml(prefix));
      previousPrefix = prefix;
    }

    for (const link of links) {
      lines.push(`<a href="${escapeAttribute(link.href)}">${escapeHtml(normalizeText(link.text))}</a>`);
    }
  }

  return lines;
}

function renderSimpleLines(blocks) {
  return blocks
    .filter((block) => block.type === "paragraph" && block.text)
    .map((block) => block.html);
}

function getTitleBlock(blocks, explicitTitleIndex, contentMarkerIndex) {
  if (explicitTitleIndex !== -1) return blocks[explicitTitleIndex];
  if (contentMarkerIndex === -1) return null;

  return (
    blocks
      .slice(contentMarkerIndex + 1)
      .find((block) => block.type === "paragraph" && block.text && !isMarkerText(block.text)) || null
  );
}

function renderFallback(blocks, options) {
  return blocks
    .filter((block) => block.type !== "blank" && block.type !== "hr")
    .map((block) => {
      if (block.type === "heading") return `<h${Math.min(block.level, 3)}>${block.html}</h${Math.min(block.level, 3)}>`;
      if (block.type === "image") return renderInlineImage(block, options);
      return block.html;
    })
    .join("<br /><br />");
}

function renderInlineImage(block, options) {
  const url = options.imageUrls?.[block.imageIndex] || "";
  if (!url) return renderImagePlaceholder(`圖片 ${block.imageIndex + 1}`);

  const safeUrl = escapeAttribute(url);
  return `<img src="${safeUrl}" />`;
}

function renderImagePlaceholder(label) {
  return `<!-- ${label}：請貼上 Blogger 上傳後的圖片 URL -->`;
}

function renderInlineChildren($, element, classStyles) {
  return $(element)
    .contents()
    .toArray()
    .map((child) => renderInlineNode($, child, classStyles))
    .join("")
    .replace(/\u00a0/g, " ");
}

function renderInlineNode($, node, classStyles) {
  if (node.type === "text") {
    return escapeHtml(node.data || "");
  }

  if (node.type !== "tag") return "";

  const tag = node.tagName?.toLowerCase();
  if (tag === "br") return "<br />";
  if (tag === "img") return "";

  const inner = $(node)
    .contents()
    .toArray()
    .map((child) => renderInlineNode($, child, classStyles))
    .join("");

  if (!inner) return "";

  if (tag === "a") {
    const href = cleanHref($(node).attr("href") || "");
    if (!href) return inner;
    return `<a href="${escapeAttribute(href)}">${inner}</a>`;
  }

  const style = getNodeStyle($, node, classStyles);
  let html = inner;

  if (style.red && hasVisibleText(html)) {
    html = `<span style="color: red;">${html}</span>`;
  }
  if (style.bold && hasVisibleText(html)) {
    html = `<b>${html}</b>`;
  }

  return html;
}

function extractLinks($, element) {
  return $(element)
    .find("a")
    .toArray()
    .map((anchor) => ({
      href: cleanHref($(anchor).attr("href") || ""),
      text: normalizeText($(anchor).text())
    }))
    .filter((link) => link.href);
}

function getImageDimensions($, image) {
  const style = parseInlineStyle($(image).attr("style") || "");
  return {
    width: numberOrNull($(image).attr("width")) ?? numberOrNull(style.width),
    height: numberOrNull($(image).attr("height")) ?? numberOrNull(style.height)
  };
}

function parseClassStyles(css) {
  const styles = new Map();
  const rulePattern = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(css))) {
    styles.set(match[1], parseInlineStyle(match[2]));
  }

  return styles;
}

function getNodeStyle($, node, classStyles) {
  const combined = {};
  const classNames = ($(node).attr("class") || "").split(/\s+/).filter(Boolean);

  for (const className of classNames) {
    Object.assign(combined, classStyles.get(className) || {});
  }

  Object.assign(combined, parseInlineStyle($(node).attr("style") || ""));

  return {
    bold: isBold(combined["font-weight"]) || isRed(combined.color),
    red: isRed(combined.color)
  };
}

function parseInlineStyle(styleText) {
  const style = {};
  for (const declaration of String(styleText).split(";")) {
    const [property, ...valueParts] = declaration.split(":");
    if (!property || valueParts.length === 0) continue;
    style[property.trim().toLowerCase()] = valueParts.join(":").trim();
  }
  return style;
}

function cleanHref(href) {
  const value = href.replace(/&amp;/g, "&");
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "www.google.com" && parsed.pathname === "/url") {
      return parsed.searchParams.get("q") || value;
    }
  } catch {
    return value;
  }
  return value;
}

function findMarkerIndex(blocks, start, marker) {
  return findIndexFrom(
    blocks,
    start,
    (block) => block.type === "paragraph" && stripTrailingColon(block.text).startsWith(marker)
  );
}

function findIndexFrom(blocks, start, predicate) {
  for (let index = Math.max(0, start); index < blocks.length; index += 1) {
    if (predicate(blocks[index], index)) return index;
  }
  return -1;
}

function firstExistingIndex(indices, fallback) {
  const existing = indices.filter((index) => index >= 0);
  return existing.length > 0 ? Math.min(...existing) : fallback;
}

function isConclusionHeading(block) {
  return block.type === "paragraph" && stripTrailingColon(block.text).replace(/\s/g, "") === "結論";
}

function isNumberedSectionHeading(block) {
  return block.type === "paragraph" && /^（[一二三四五六七八九十]+）/.test(block.text);
}

function isMarkerText(text) {
  const normalized = stripTrailingColon(text);
  return Object.values(MARKERS).some((marker) => normalized.startsWith(marker));
}

function stripTrailingColon(text) {
  return normalizeText(text).replace(/[：:]\s*$/, "");
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function numberOrNull(value) {
  const number = Number.parseFloat(String(value || "").replace("px", ""));
  return Number.isFinite(number) ? number : null;
}

function isBold(value) {
  if (!value) return false;
  if (/bold/i.test(value)) return true;
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

function isRed(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "red" || normalized === "#f00" || normalized === "#ff0000" || normalized === "rgb(255,0,0)" || normalized === "rgb(255, 0, 0)";
}

function hasVisibleText(html) {
  return html.replace(/<[^>]+>/g, "").trim().length > 0;
}

function stripWholeBold(html) {
  const match = String(html || "").match(/^<b>([\s\S]*)<\/b>$/);
  if (!match) return html;
  return match[1];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function joinMainParts(parts) {
  return parts.filter(Boolean).join("\n");
}
