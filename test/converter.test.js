import assert from "node:assert/strict";
import { test } from "node:test";
import { convertGoogleDocHtml, extractGoogleDocId } from "../src/converter.js";

const fixture = String.raw`<html>
<head>
  <style>
    .bold{font-weight:700}
    .red{color:#ff0000}
  </style>
</head>
<body>
  <h3>你可以先知道：</h3>
  <p>（1）第一點</p>
  <p>&nbsp;</p>
  <p>（2）第二點</p>
  <p>&nbsp;</p>
  <p>這是導言。</p>
  <hr>
  <h2>網傳測試標題？</h2>
  <p>&nbsp;</p>
  <p>原始謠傳版本：</p>
  <p>&nbsp;</p>
  <p>謠傳第一行</p>
  <p>謠傳第二行</p>
  <p>&nbsp;</p>
  <p>並在社群平台流傳：</p>
  <p><span><img src="data:image/png;base64,abc" style="width: 300.00px; height: 200.00px;"></span></p>
  <p>查證解釋：</p>
  <p>問題標題？</p>
  <p>含有<span class="bold red">紅色粗體</span>與<a href="https://www.google.com/url?q=https://example.com/a&amp;sa=D">連結</a>。</p>
  <p><span class="bold">結論</span></p>
  <p>結論文字。</p>
  <p>資料來源：</p>
  <p>資料單位 - <a href="https://www.google.com/url?q=https://example.com/source&amp;sa=D">來源一</a></p>
  <p>資料單位 - <a href="https://www.google.com/url?q=https://example.com/source-2&amp;sa=D">來源二</a></p>
  <p>延伸閱讀：</p>
  <p><a href="https://www.google.com/url?q=https://example.com/read&amp;sa=D">延伸一</a></p>
</body>
</html>`;

test("extractGoogleDocId accepts URLs and raw ids", () => {
  assert.equal(
    extractGoogleDocId("https://docs.google.com/document/d/1GSytlKmPnHjup7unFfj222iWLRNHww0zS_fdS1Tdozo/edit"),
    "1GSytlKmPnHjup7unFfj222iWLRNHww0zS_fdS1Tdozo"
  );
  assert.equal(extractGoogleDocId("1GSytlKmPnHjup7unFfj222iWLRNHww0zS_fdS1Tdozo"), "1GSytlKmPnHjup7unFfj222iWLRNHww0zS_fdS1Tdozo");
  assert.equal(extractGoogleDocId("not a doc"), "");
});

test("convertGoogleDocHtml emits MyGoPen-style Blogger HTML", () => {
  const result = convertGoogleDocHtml(fixture, {
    coverImageUrl: "https://blogger.googleusercontent.com/cover.jpg",
    imageUrls: ["https://blogger.googleusercontent.com/inline.jpg"]
  });

  assert.equal(result.title, "網傳測試標題？");
  assert.equal(result.images.length, 1);
  assert.match(result.articleHtml, /<div class="quote_style"><h3 style="text-align: center;">你可以先知道：<\/h3>（1）第一點/);
  assert.match(result.articleHtml, /<div class="intro_words">這是導言。<\/div>/);
  assert.match(result.articleHtml, /<blockquote class="tr_bq">謠傳第一行\n謠傳第二行<\/blockquote>/);
  assert.match(result.articleHtml, /<img src="https:\/\/blogger\.googleusercontent\.com\/inline\.jpg" \/>/);
  assert.match(result.articleHtml, /<b><span style="color: red;">紅色粗體<\/span><\/b>/);
  assert.match(result.articleHtml, /<a href="https:\/\/example\.com\/a">連結<\/a>/);
  assert.doesNotMatch(result.articleHtml, /<h3 style="text-align: left;">/);
  assert.match(result.articleHtml, /結論<br \/><br \/>結論文字。/);
  assert.match(result.articleHtml, /資料單位 -<br \/><a href="https:\/\/example\.com\/source">來源一<\/a><br \/><a href="https:\/\/example\.com\/source-2">來源二<\/a>/);
  assert.match(result.articleHtml, /延伸閱讀：<br \/><br \/><a href="https:\/\/example\.com\/read">延伸一<\/a>/);
});

test("convertGoogleDocHtml supports paragraph-based drafts with content marker", () => {
  const paragraphDraft = String.raw`<html><body>
    <p>你可以先知道：</p>
    <p>（1）摘要一</p>
    <p>（2）摘要二</p>
    <p>這是導言。</p>
    <hr>
    <p>內容：</p>
    <p>用鼻子呼吸，不要用嘴巴呼吸，保持心臟年輕</p>
    <p>影片逐字稿。</p>
    <p>原始謠傳版本：</p>
    <p>主要流傳這段影片：</p>
    <p>並在社群平台流傳：</p>
    <p>查證解釋：</p>
    <p>（一）第一段查證標題</p>
    <p>查證內容。</p>
    <p>結論：</p>
    <p>結論內容。</p>
    <p>衛教資源：</p>
    <p>國科會 科技大觀園 一氧化氮醫學</p>
    <p>諮詢專家：</p>
    <p>新光醫院健康管理部醫療副主任、家醫科醫師 - 柳朋馳</p>
    <p>延伸閱讀：</p>
    <p><a href="https://example.com/read">延伸文章</a></p>
  </body></html>`;

  const result = convertGoogleDocHtml(paragraphDraft);

  assert.doesNotMatch(result.articleHtml, /找不到/);
  assert.match(result.articleHtml, /<div class="quote_style"><h3 style="text-align: center;">你可以先知道：<\/h3>（1）摘要一/);
  assert.match(result.articleHtml, /<h2>用鼻子呼吸，不要用嘴巴呼吸，保持心臟年輕<\/h2>/);
  assert.match(result.articleHtml, /<br \/>原始謠傳版本：<br \/>/);
  assert.match(result.articleHtml, /<blockquote class="tr_bq">用鼻子呼吸，不要用嘴巴呼吸，保持心臟年輕\n影片逐字稿。<\/blockquote>/);
  assert.match(result.articleHtml, /主要流傳這段影片：/);
  assert.doesNotMatch(result.articleHtml, /<h3 style="text-align: left;">/);
  assert.match(result.articleHtml, /（一）第一段查證標題<br \/><br \/>查證內容。/);
  assert.match(result.articleHtml, /衛教資源：<br \/><br \/>國科會 科技大觀園 一氧化氮醫學<br \/>諮詢專家：<br \/>新光醫院健康管理部醫療副主任、家醫科醫師 - 柳朋馳/);
  assert.match(result.articleHtml, /延伸閱讀：<br \/><br \/><a href="https:\/\/example\.com\/read">延伸文章<\/a>/);
});

test("convertGoogleDocHtml supports field template drafts with write-here boxes", () => {
  const fieldDraft = String.raw`<html><body>
    <p>你可以先知道：</p>
    <p>（1）破解資訊一。</p>
    <p>（2）破解資訊二。</p>
    <p>導言摘要段：網傳「測試謠言」的影片訊息，經查證為錯誤。</p>
    <p>首圖：[img]大標：</p>
    <p>網傳測試謠言是真的？</p>
    <p>原始謠傳版本：這是謠言本體。</p>
    <p>主要流傳這個影像：[img]/[video]</p>
    <p>影片描述文字。</p>
    <p>並在社群平台流傳：[img]</p>
    <p>社群截圖說明。</p>
    <p>查證解釋：網傳訊息原始出處為何？</p>
    <p>查證內容。</p>
    <p>結論：</p>
    <p>結論內容。</p>
    <p>資料來源：資料單位 - <a href="https://example.com/source">資料標題</a></p>
    <p>延伸閱讀：<a href="https://example.com/read">延伸文章</a></p>
  </body></html>`;

  const result = convertGoogleDocHtml(fieldDraft);

  assert.deepEqual(result.warnings, []);
  assert.match(result.articleHtml, /<div class="quote_style"><h3 style="text-align: center;">你可以先知道：<\/h3>（1）破解資訊一。/);
  assert.match(result.articleHtml, /<div class="intro_words">網傳「測試謠言」的影片訊息，經查證為錯誤。<\/div>/);
  assert.match(result.articleHtml, /<h2>網傳測試謠言是真的？<\/h2>/);
  assert.match(result.articleHtml, /<blockquote class="tr_bq">這是謠言本體。<\/blockquote>/);
  assert.ok(
    result.articleHtml.includes(
      "<br />主要流傳這個影像：<br /><br />影片描述文字。<br /><br /><!-- 主要流傳影像：請貼上 Blogger 上傳後的圖片 URL -->"
    )
  );
  assert.ok(
    result.articleHtml.includes(
      "<br />並在社群平台流傳：<br /><br />社群截圖說明。<br /><br /><!-- 社群流傳圖片：請貼上 Blogger 上傳後的圖片 URL -->"
    )
  );
  assert.match(result.articleHtml, /查證解釋：<br \/>/);
  assert.doesNotMatch(result.articleHtml, /<h3 style="text-align: left;">/);
  assert.match(result.articleHtml, /結論：<br \/><br \/>結論內容。/);
  assert.match(result.articleHtml, /資料來源：<br \/><br \/>資料單位 -<br \/><a href="https:\/\/example\.com\/source">資料標題<\/a>/);
  assert.match(result.articleHtml, /延伸閱讀：<br \/><br \/><a href="https:\/\/example\.com\/read">延伸文章<\/a>/);
});

test("convertGoogleDocHtml merges split Google Docs source links", () => {
  const splitSourceDraft = String.raw`<html><body>
    <p>你可以先知道：</p>
    <p>（1）破解資訊一。</p>
    <p>導言摘要段：導言。</p>
    <p>首圖：[img]大標：</p>
    <p>網傳測試謠言？</p>
    <p>原始謠傳版本：謠言本體。</p>
    <p>主要流傳這個影像：[img]/[video]</p>
    <p>並在社群平台流傳：[img]</p>
    <p>查證解釋：查證內容。</p>
    <p>資料來源：NOW News -<a href="https://www.google.com/url?q=https://example.com/news&amp;sa=D&amp;ust=1">&nbsp;</a><a href="https://www.google.com/url?q=https://example.com/news&amp;sa=D&amp;ust=2">北市敬老卡升級！蔣萬安宣布：</a><a href="https://www.google.com/url?q=https://example.com/news&amp;sa=D&amp;ust=3">300</a><a href="https://www.google.com/url?q=https://example.com/news&amp;sa=D&amp;ust=4">點開放超商、超市、藥局都可用</a></p>
    <p>YouTube -<a href="https://www.google.com/url?q=https://www.youtube.com/watch%3Fv%3DFcLOiC-8GE0&amp;sa=D&amp;ust=5">&nbsp;</a><a href="https://www.google.com/url?q=https://www.youtube.com/watch%3Fv%3DFcLOiC-8GE0&amp;sa=D&amp;ust=6">臺北市議會</a><a href="https://www.google.com/url?q=https://www.youtube.com/watch%3Fv%3DFcLOiC-8GE0&amp;sa=D&amp;ust=7">&nbsp;</a><a href="https://www.google.com/url?q=https://www.youtube.com/watch%3Fv%3DFcLOiC-8GE0&amp;sa=D&amp;ust=8">第</a><a href="https://www.google.com/url?q=https://www.youtube.com/watch%3Fv%3DFcLOiC-8GE0&amp;sa=D&amp;ust=9">14</a><a href="https://www.google.com/url?q=https://www.youtube.com/watch%3Fv%3DFcLOiC-8GE0&amp;sa=D&amp;ust=10">屆第07次定期大會市政總質詢</a></p>
  </body></html>`;

  const result = convertGoogleDocHtml(splitSourceDraft);

  assert.ok(
    result.articleHtml.includes(
      'NOW News -<br /><a href="https://example.com/news">北市敬老卡升級！蔣萬安宣布：300點開放超商、超市、藥局都可用</a>'
    )
  );
  assert.ok(
    result.articleHtml.includes(
      'YouTube -<br /><a href="https://www.youtube.com/watch?v=FcLOiC-8GE0">臺北市議會 第14屆第07次定期大會市政總質詢</a>'
    )
  );
  assert.doesNotMatch(result.articleHtml, /宣布：<\/a><br \/><a href="https:\/\/example\.com\/news">300<\/a>/);
});
