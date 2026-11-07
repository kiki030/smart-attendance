# 📋 VERSION — 校園智慧點名系統版本記錄

> **目前穩定版本：`v0.4.4`**

---

## 🌿 雙分支維護工作流（Branch Strategy）

```
main（開發主線）
  ↓ 所有功能開發、修正、文件更新均在此分支進行
  ↓ git add . → git commit -m "type: description" → git push origin main
  ↓
  cd frontend && npm run deploy
  ↓
gh-pages（生產發布）← 由 Vite build 產物自動推送，請勿手動修改
```

### Commit 訊息規範

| 前綴 | 用途 |
|------|------|
| `feat:` | 新增功能 |
| `fix:` | 修正 Bug |
| `refactor:` | 重構（無功能增減） |
| `style:` | 樣式 / UI 調整 |
| `security:` | 安全性修正 |
| `docs:` | 文件更新 |
| `chore:` | 建置流程、設定變更 |

---

## 📅 Change Log（變更歷史）

---

### v0.4.4 — 2026-11-08
**fix: 修復姓名欄位夾帶學號前綴的問題（前端 CSV 匯出 + 後端寫入正規化）**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `TeacherDashboard.tsx`：CSV 匯出時對 `student_name` 執行清洗，自動去除開頭含 `student_id` 的前綴字串（例如 `'4B6G3336 痛又痛'` → `'痛又痛'`） |
| `fix` | `main.py`：新增 `normalize_name(name, student_id)` 輔助函式，統一處理姓名正規化邏輯 |
| `fix` | `main.py /api/register-face`：人臉註冊時對傳入的 `name` 執行 `normalize_name`，確保 `student_faces` 表存入純姓名，從源頭防止污染 |
| `fix` | `main.py /api/roll-call`：點名辨識結果寫入 `attendance_records` 時，對 `student_name` 執行 `normalize_name`，確保出勤紀錄姓名乾淨 |
| `refactor` | `normalize_name` 設有 fallback：若清洗後字串為空，保留原始值，避免資料遺失 |

> 🚀 同步部署至 `gh-pages`；後端需重啟 `start_server.py` 生效

---

### v0.4.3 — 2026-11-08
**feat: 全班出勤趨勢圖、個人明細彈窗與 CSV 報表匯出（階段三）**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `TeacherDashboard.tsx`：新增「全班出勤趨勢圖」（Recharts 堆疊柱狀圖），顯示選定課程近 14 天每日出席 / 遲到 / 缺席人數，切換課程自動重新載入 |
| `feat` | 趨勢圖預先填充 14 天資料點，確保無紀錄日仍顯示為 0（不跳空） |
| `feat` | 出勤紀錄表格標題列新增「📥 匯出 CSV 報表」按鈕，點擊即下載含 BOM 的 UTF-8 CSV，Excel 可正常開啟並顯示中文 |
| `feat` | 表格姓名欄改為可點擊按鈕（底線樣式），點擊開啟「學生個人明細 Modal」 |
| `feat` | Modal 內呈現：個人出席率、各狀態統計卡片、完整歷史簽到紀錄表（含日期 / 課程 / 簽到時間 / 狀態 / 備註），最多顯示近 60 筆 |
| `feat` | Modal 支援點擊背景遮罩或右上角 ✕ 關閉，配備淡入縮放動畫 |
| `style` | `App.css` 新增 `.student-name-btn`（可點擊姓名）、`.modal-backdrop`、`.modal-box`、`.modal-header` 等 Modal 樣式，與現有深色玻璃態風格一致 |

> 🚀 同步部署至 `gh-pages`

---

### v0.4.2 — 2026-11-08
**fix: 修復 `/api/roll-call` 防重複簽到邏輯，查詢條件加入課程名稱**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `main.py`：去重查詢由原先的 `student_id + date` 改為 `student_id + course_name + date` 三條件同時滿足，避免同學生跨課程被誤判為重複 |
| `fix` | `select("id")` 改為 `select("id, status")`，修正舊版讀取 `status` 欄位時因未包含該欄位導致永遠判定為 `absent` 的 Bug |
| `refactor` | 提取 `sid`、`sname` 變數，提升程式碼可讀性 |
| `fix` | 更新狀態時移除多餘的 `course_name` 欄位覆寫（已存在紀錄的課程名稱不應被更動） |
| `feat` | 後端終端機新增詳細 log 輸出：`✅ 寫入出勤`、`🔄 更新出勤`、`⏭️ 跳過重複簽到`，方便除錯追蹤 |

> 🔧 純後端修正，不影響前端介面，不需重新部署 `gh-pages`

---

### v0.4.1 — 2026-11-08
**refactor: 出勤紀錄改為草稿暫存模式，新增確認儲存按鈕與未儲存視覺提示**

| 類型 | 變更內容 |
|------|---------|
| `refactor` | `TeacherDashboard.tsx`：移除 `onChange` 即時寫入 Supabase 的自動儲存邏輯（含 debounce timer） |
| `feat` | 新增 `drafts` 草稿狀態（`Record<string, {status, note}>`），修改狀態或備註時僅更新本地草稿，不觸發雲端寫入 |
| `feat` | 出勤表格每列新增「**確認儲存**」按鈕，只有教師點擊後才執行 `supabase.update()` 寫入雲端 |
| `feat` | 被修改過但尚未儲存的欄位自動顯示黃色外框（`draft-unsaved` CSS class）與「未儲存」小標籤，提醒教師確認 |
| `feat` | 儲存成功後顯示 ✅ Toast 訊息（2.5 秒後自動消失），並重新載入最新出勤名冊 |
| `fix` | 背景輪詢（每 8 秒 `loadRosterAndAttendance`）不再覆蓋有未儲存草稿的列，避免編輯中內容被刷新 |
| `feat` | `temp-` 開頭的暫存學生列（尚未寫入 DB）點擊確認儲存時自動改用 `INSERT` 新增一筆紀錄 |
| `style` | `App.css` 新增 `.draft-unsaved`（黃色 outline）與 `.unsaved-badge`（小標籤）樣式 |

> 🚀 同步部署至 `gh-pages`

---

### v0.4.0 — 2026-11-07
**feat: 課程管理系統與自動遲到判定功能上線**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `main.py /api/roll-call`：新增 `course_name`（課程名稱）與 `class_start_time`（上課時間）兩個 Form 參數 |
| `feat` | 後端遲到自動判定：比對簽到時間與上課時間，超過 15 分鐘寬限期自動將 `status` 設為 `'late'`（遲到），否則為 `'present'`（出席） |
| `feat` | 出勤紀錄寫入 Supabase 時帶入正確的 `course_name`，不再固定寫死「人工智慧概論」 |
| `feat` | `TeacherDashboard.tsx`：新增「課程設定面板」，包含課程名稱下拉選單（8 門課）與上課時間輸入欄位 |
| `feat` | 點名時自動將選取的 `course_name` 與 `class_start_time` 附帶傳送至後端 |
| `refactor` | 出勤表格移除「手動儲存按鈕」，改為修改 status 立即自動同步；備註欄採 1 秒 debounce 後自動儲存至 Supabase |
| `feat` | 即時比對結果新增「🟡 遲到」狀態標籤顯示 |

> 🚀 同步部署至 `gh-pages`

---

### v0.3.4 — 2026-06-17
**security: 敏感憑證移出原始碼**

| 類型 | 變更內容 |
|------|---------|
| `security` | `start_server.py`：NGROK_AUTHTOKEN 改由 `os.getenv()` 從 `.env` 讀取，不再硬編碼 |
| `security` | `frontend/src/pages/RoleSetup.tsx`：TEACHER_CODE 改由 `import.meta.env.VITE_TEACHER_CODE` 讀取，前端 fallback 為 `'STUST2024'` |
| `security` | `frontend/.env`：新增 `VITE_TEACHER_CODE` 環境變數 |
| `security` | `backend/.env`：新增 `NGROK_AUTHTOKEN` 環境變數 |
| `chore` | `frontend/.gitignore`：補強 `.env` / `.env.*` 排除規則，防止憑證意外提交至 GitHub |

> 🚀 同步部署至 `gh-pages`

---

### v0.3.3 — 2026-06-17
**style: 測試模式歡迎訊息優化（移除測試帳號顯示）**

| 類型 | 變更內容 |
|------|---------|
| `style` | `RoleSetup.tsx`：移除 demo 模式下 email 欄位顯示，改為「🚀 歡迎進入測試模式！」 |

---

### v0.3.2 — 2026-06-17
**style: 測試模式歡迎訊息使用者體驗改善**

| 類型 | 變更內容 |
|------|---------|
| `style` | `RoleSetup.tsx`：整合 demo 帳號辨識邏輯，提供更友善的測試模式訊息提示 |

---

### v0.3.1 — 2026-06-17
**style: 教師驗證輸入欄位提示文字優化**

| 類型 | 變更內容 |
|------|---------|
| `style` | `RoleSetup.tsx`：教師驗證碼輸入框 placeholder 與學生欄位統一風格；移除「驗證碼由系統管理員提供」說明文字 |

---

### v0.3.0 — 2026-06-17
**fix: 解決即時鏡頭點名 stream 綁定競態條件 + 新增 AI 即時比對面板**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `TeacherDashboard.tsx`：修正 rollCallActive 狀態切換時 video srcObject 重新綁定的競態問題 |
| `feat` | 新增「AI 即時比對狀態面板」：顯示每 3 秒掃描的辨識結果（偵測人數 / 成功辨識 / 未知警報） |

> 🚀 同步部署至 `gh-pages`

---

### v0.2.5 — 2026-06-17
**fix: TypeScript 編譯錯誤修正（unused imports / variables）**

| 類型 | 變更內容 |
|------|---------|
| `fix` | 修正 `TeacherDashboard.tsx`、`StudentDashboard.tsx` 的 TS 未使用變數與 import 編譯錯誤，確保 `npm run build` 通過 |

---

### v0.2.4 — 2026-06-17
**feat: 新增免 Google 登入測試模式**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `LoginPage.tsx`：新增「🚀 進入測試版 (免 Google 登入)」按鈕 |
| `feat` | 點擊後建立 localStorage mock session，觸發與正式 Google 登入相同的角色設定流程 |
| `feat` | `RoleSetup.tsx`：測試模式下可選學生（輸入學號姓名）或教師（輸入驗證碼）進入對應功能 |

> 🚀 同步部署至 `gh-pages`

---

### v0.2.3 — 2026-06-17
**fix: 新增 ngrok-skip-browser-warning 請求標頭**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `useApiBase.ts`、`FaceRegistration.tsx`、`TeacherDashboard.tsx`：所有 fetch 請求新增 `ngrok-skip-browser-warning: true` header |

---

### v0.2.2 — 2026-06-17
**fix: 以 pyngrok 替換 start.bat 執行 ngrok，解決 PATH 依賴問題**

| 類型 | 變更內容 |
|------|---------|
| `fix` | 新增 `start_server.py`：整合 uvicorn 啟動 + pyngrok tunnel + Supabase URL 寫入的完整一鍵流程 |
| `fix` | 解決原 start.bat 需要 ngrok 加入系統 PATH 才能執行的環境依賴問題 |
| `chore` | 更新 `requirements.txt` 加入 `pyngrok`、`requests` |

---

### v0.2.1 — 2026-06-17
**fix: 修正 Windows 中文編碼問題（start.bat / update_ngrok_url.py）**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `start.bat`、`update_ngrok_url.py`：所有 print 訊息改為 ASCII 字元，解決 Windows 終端機 Big5 / UTF-8 編碼衝突導致亂碼問題 |

---

### v0.2.0 — 2026-06-17
**feat: 完整即時鏡頭點名 + Supabase 名冊動態整合**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `TeacherDashboard.tsx`：教師主控台新增即時 WebCam 點名功能，每 3 秒自動擷取畫面送至 AI 後端 |
| `feat` | `loadRosterAndAttendance()`：整合 `student_faces` 名冊與 `attendance_records`，自動對接今日出勤狀態 |
| `feat` | 點名成功後自動更新出勤統計卡片（出席 / 遲到 / 缺席） |
| `feat` | 教師可手動修改出勤狀態與備註，並逐行儲存至 Supabase |

> 🚀 同步部署至 `gh-pages`

---

### v0.1.5 — 2026-06-17
**feat: 一鍵啟動 start.bat + 動態 ngrok API 路由 + 後端狀態指示燈**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `start.bat`：一鍵啟動 uvicorn 後端並自動執行 ngrok 穿透，將公開 URL 寫入 Supabase `app_config` |
| `feat` | `useApiBase.ts` hook：前端自動從 Supabase 讀取最新 ngrok URL，每 30 秒健康檢查後端狀態 |
| `feat` | `TeacherDashboard` Navbar：新增 AI 後端狀態燈號（🟢 在線 / 🔴 離線 / 🟡 檢測中） |

---

### v0.1.4 — 2026-06-17
**fix: 學生頁面時鐘移至日期列、修正人臉註冊黑屏與錯誤訊息**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `StudentDashboard.tsx`：時鐘移至日期旁顯示，版面更整潔 |
| `fix` | `FaceRegistration.tsx`：修正步驟切換時 video 元素重新掛載導致鏡頭黑屏的問題（重新注入 srcObject） |
| `fix` | 人臉上傳失敗時錯誤訊息改為更友善的中文提示 |

---

### v0.1.3 — 2026-06-17
**feat: 多頁面 SPA — Google OAuth、教師/學生 Dashboard、人臉註冊精靈**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `App.tsx`：建立完整 SPA 路由守衛（`/login` / `/setup` / `/teacher` / `/student` / `/register`） |
| `feat` | `LoginPage.tsx`：Google OAuth 登入按鈕（Supabase `signInWithOAuth`） |
| `feat` | `RoleSetup.tsx`：首次登入角色選擇（學生輸入學號姓名 / 教師輸入驗證碼），寫入 `user_roles` |
| `feat` | `TeacherDashboard.tsx`：教師主控台初版（統計卡片 + 出勤表格） |
| `feat` | `StudentDashboard.tsx`：學生即時看板（今日狀態卡 + Recharts 圓餅圖 + 歷史紀錄） |
| `feat` | `FaceRegistration.tsx`：三步驟人臉拍照精靈（正面 / 左側 / 右側），連動後端 `register-face` API |

> 🚀 同步部署至 `gh-pages`

---

### v0.1.2 — 2026-06-16
**feat: 初始化 React 前端 + GitHub Pages 部署設定**

| 類型 | 變更內容 |
|------|---------|
| `feat` | 建立 `frontend/` 目錄，以 Vite + React + TypeScript 初始化前端專案 |
| `chore` | `package.json` 配置 `gh-pages` 部署腳本與 `homepage` 欄位 |
| `chore` | `vite.config.ts` 設定 `base: '/smart-attendance/'` |

---

### v0.1.1 — 2026-06-16
**feat: 多人課堂點名 API + 未知人臉過濾機制**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `POST /api/roll-call`：接收課堂全景圖，YOLOv8-Face 偵測所有人臉，逐臉呼叫 Supabase RPC 比對 |
| `feat` | 相似度 ≥ 0.7 → `present`；相似度 < 0.7 → `unknown_alert`，並防重複寫入今日出勤 |
| `fix` | 新增防呆：比對無結果或相似度不足時明確回傳 `unknown_alert` 狀態 |

---

### v0.1.0 — 2026-06-16
**refactor: Online Feature Fusion + 資料庫正規化（一學生一行）**

| 類型 | 變更內容 |
|------|---------|
| `refactor` | `POST /api/register-face`：新增 Online Feature Fusion 演算法 |
| `refactor` | 策略：新學生 → INSERT；已存在 → 讀取舊向量，與新向量做均值融合，L2 正規化後 UPDATE |
| `refactor` | 確保 `student_faces` 表符合第三正規化，一學生始終只有一行 |
| `fix` | 修正 Supabase 有時回傳 JSON 字串而非 list 的解析錯誤 |

---

### v0.0.5 — 2026-06-16
**fix: Python 3.8 型別提示相容性修正**

| 類型 | 變更內容 |
|------|---------|
| `fix` | `main.py`：將 `list[float]` 型別提示改為 `List[float]`，新增 `from __future__ import annotations` |

---

### v0.0.4 — 2026-06-16
**feat: 多角度人臉特徵向量融合（三角度輸入支援）**

| 類型 | 變更內容 |
|------|---------|
| `feat` | 人臉註冊支援多次上傳（正面、左側、右側），每次呼叫 register-face 均觸發融合計算 |

---

### v0.0.3 — 2026-06-16
**feat: 整合 InsightFace buffalo_l（YOLOv8-Face + ArcFace）真實推論**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `main.py`：引入 `insightface.app.FaceAnalysis`，以 `CPUExecutionProvider` 初始化 buffalo_l 模型 |
| `feat` | `extract_face_embedding()`：真實 ArcFace 512 維標準化向量提取，取代模擬 embedding |

---

### v0.0.2 — 2026-06-16
**feat: 人臉影像上傳 + 人臉辨識 API 骨架建立**

| 類型 | 變更內容 |
|------|---------|
| `feat` | `POST /api/register-face`：接收 `multipart/form-data` 影像，使用 OpenCV 解碼，呼叫特徵提取 |
| `feat` | `POST /api/search-face`：人臉搜尋 API 骨架，整合 Supabase RPC `match_student_face` 向量比對 |

---

### v0.0.1 — 2026-06-16
**feat: 專案初始化 — FastAPI 骨架 + Supabase 連線 + 向量插入測試**

| 類型 | 變更內容 |
|------|---------|
| `feat` | 初始化 FastAPI 專案結構，配置 `python-dotenv` 環境變數讀取 |
| `feat` | 整合 Supabase Python SDK，建立 `student_faces` 向量資料表連線 |
| `feat` | `POST /api/test-insert`：隨機 512 維向量寫入測試（驗證 pgvector 連線） |
| `feat` | CORS middleware 設定（允許 GitHub Pages 跨域呼叫） |
| `chore` | `Initial commit`：建立 git 儲存庫，推送至 GitHub `main` 分支 |

---

## 📊 版本對照表

| 版本 | 日期 | 里程碑 |
|------|------|-------|
| v0.0.1 | 2026-06-16 | 專案初始化，FastAPI + Supabase 骨架 |
| v0.0.5 | 2026-06-16 | Python 3.8 相容性完成 |
| v0.1.0 | 2026-06-16 | Online Feature Fusion 人臉融合演算法 |
| v0.1.1 | 2026-06-16 | 多人課堂點名 API 完成 |
| v0.1.2 | 2026-06-16 | React 前端初始化 + GitHub Pages |
| v0.1.3 | 2026-06-17 | 完整 SPA + Google OAuth + 人臉註冊精靈 |
| v0.2.0 | 2026-06-17 | 即時鏡頭點名 + Supabase 動態名冊 |
| v0.2.4 | 2026-06-17 | 測試模式（免 Google 登入） |
| v0.3.0 | 2026-06-17 | AI 即時比對面板 |
| v0.3.4 | 2026-06-17 | 安全性強化：憑證移入環境變數 |
| v0.4.0 | 2026-11-07 | 課程管理下拉選單 + 自動遲到判定 + 自動儲存 |
| v0.4.1 | 2026-11-08 | 草稿暫存模式 + 確認儲存按鈕 + 未儲存視覺提示 |
| v0.4.2 | 2026-11-08 | 防重複簽到查詢加入課程名稱條件 + 修正 status 讀取 Bug |
| v0.4.3 | 2026-11-08 | 全班趨勢圖 + 個人明細彈窗 + CSV 報表匯出 |
| v0.4.4 | 2026-11-08 | 修復姓名欄位夾帶學號前綴（前端清洗 + 後端寫入正規化） |
