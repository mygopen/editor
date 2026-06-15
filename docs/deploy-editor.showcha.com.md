# 部署到 editor.showcha.com

這個專案可部署到 Cloudflare Pages：

- `public/`：前端靜態檔案
- `functions/api/convert.js`：Cloudflare Pages Function，提供 `POST /api/convert`
- `wrangler.jsonc`：Pages 設定，輸出目錄為 `./public`

## 1. 重新授權 Wrangler

目前本機 Wrangler token 缺少 Pages 權限。請先執行：

```bash
npx wrangler login
```

登入後確認權限：

```bash
npx wrangler whoami
```

需要至少具備：

- `pages:write`
- `zone:read`
- DNS/custom domain 相關權限

## 2. 本機測試 Cloudflare Pages

```bash
npm run pages:dev
```

測試 API：

```bash
curl -X POST http://localhost:8788/api/convert \
  -H 'content-type: application/json' \
  -d '{"docUrl":"https://docs.google.com/document/d/1xotKWD_d7Jogc_AwO5Ssmz5NWKk7Wxw7-3TTdepZFmo/edit"}'
```

## 3. Direct Upload 部署

```bash
npm run deploy:pages
```

部署成功後會得到一個 `*.pages.dev` 網址。

## 4. 綁定 editor.showcha.com

在 Cloudflare Dashboard：

1. 進入 Workers & Pages
2. 選擇 `editor` Pages 專案
3. 進入 Custom domains
4. 新增 `editor.showcha.com`
5. Cloudflare 會建立或提示建立 CNAME record

`showcha.com` 目前 nameserver 已在 Cloudflare，所以 custom domain 啟用後通常會自動生效。

## 重要限制：部署版圖片資料夾

Cloudflare Pages 是 serverless 平台，不能像本機 Express 版一樣把圖片永久寫入 `exported-images/`。

目前行為：

- 本機版 `npm start`：會把 Google 文件圖片另存到 `exported-images/Google文件ID/`
- Cloudflare Pages 版：會顯示圖片預覽，但不會永久另存到資料夾

如果未來需要線上版也能保存圖片，建議再加 Cloudflare R2 bucket。
