# 九州家族自駕 2027 — 行程 PWA

2027/1/22–1/29 九州八天七夜自駕行程（熊本進、福岡出），做成可安裝、可離線的 PWA。
在手機上加入主畫面後，沒有網路的山區路段照樣能查行程與照片。

## 功能

- **日期按鈕選日**：每日行程上方一排日期按鈕（1/22–1/29），點哪一天就看那一天，再點一次收合
- **備案跟著當天走**：每天的雨天、順路備案放在所屬那天的行程底下
- **完全離線**：行程與 30 張照片在首次載入時全部快取，之後離線可用
- **可安裝**：加入主畫面後全螢幕開啟，像原生 App

## 內容來源

行程與照片來自 CubeLV 筆記《九州八天七夜自駕》與檔案庫的 30 張行程照片。
內容有更新時，重新產生 `src/trip.ts` 與 `public/photos/` 後重新建置即可。

## 開發

```bash
npm install
npm run dev        # 開發伺服器（PWA 的 service worker 在 dev 模式不啟用）
npm run build      # 產出 dist/
npm run preview    # 以正式版預覽，可測試安裝與離線
npm run typecheck  # TypeScript 型別檢查
```

技術：Vite + React + TypeScript，`vite-plugin-pwa`（Workbox）產生 manifest 與 service worker。

## 部署

推送到 `main` 後由 GitHub Actions 自動建置並發佈到 GitHub Pages。
首次使用需要在 repo 的 **Settings → Pages → Source** 選擇 **GitHub Actions**。
