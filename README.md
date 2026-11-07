# 🎓 校園智慧點名系統
### Smart Attendance System — 南臺科技大學資訊工程系畢業專題

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?logo=github)](https://kiki030.github.io/smart-attendance/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%202.0-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React%2019-61DAFB?logo=react)](https://react.dev/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20pgvector-3ECF8E?logo=supabase)](https://supabase.com/)

---

## 📌 專案簡介

本系統以 **InsightFace（YOLOv8-Face + ArcFace）** 人臉辨識技術為核心，結合雲端向量資料庫，建立一套自動化的校園出勤管理平台。教師只需開啟瀏覽器，透過即時鏡頭或上傳課堂照片，系統即可自動完成全班學生的人臉比對與出勤記錄，無需傳統紙本點名。

### 核心特色
- 🧠 **多人臉批次辨識**：單張照片同時辨識多位學生（YOLOv8-Face 偵測 + ArcFace 比對）
- 📐 **Online Feature Fusion**：三角度（正面／左側／右側）人臉特徵向量融合，提升辨識準確率
- ☁️ **全雲端架構**：Supabase pgvector 向量資料庫，支援跨裝置即時存取
- 🔗 **ngrok 外網穿透**：本機 AI 後端自動產生公開 HTTPS URL，供 GitHub Pages 前端串接
- 🚀 **免 Google 測試模式**：本地開發可直接進入系統功能，無需真實 OAuth 帳號

---

## 🏗️ 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (GitHub Pages)                                         │
│  React 19 + Vite 8 + TypeScript 6                           │
│  路由：react-router-dom v7 / 圖表：Recharts                  │
│  身份驗證：Supabase Auth (Google OAuth / Demo Session)       │
└──────────────────┬──────────────────────────────────────────┘
                   │  HTTP REST (multipart/form-data)
                   │  Header: ngrok-skip-browser-warning: true
┌──────────────────▼──────────────────────────────────────────┐
│  本機 AI 後端 (FastAPI 2.0.0 + uvicorn --reload)             │
│  InsightFace buffalo_l model                                 │
│  ├─ YOLOv8-Face：多人臉偵測框                                │
│  └─ ArcFace：512 維標準化特徵向量提取                        │
│  pyngrok：自動建立 HTTPS tunnel → 寫入 Supabase             │
└──────────────────┬──────────────────────────────────────────┘
                   │  Supabase Python SDK
┌──────────────────▼──────────────────────────────────────────┐
│  Supabase (PostgreSQL + pgvector)                           │
│  ├─ user_roles          : 使用者角色（teacher / student）    │
│  ├─ student_faces       : 人臉特徵向量 vector(512)           │
│  ├─ attendance_records  : 出勤紀錄                           │
│  └─ app_config          : 動態 API URL（ngrok）              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📂 專案目錄結構

```
4B2G0037smart_attendance/
├── main.py                  # FastAPI 後端主程式（AI 推論 + Supabase）
├── start_server.py          # 一鍵啟動腳本（uvicorn + pyngrok）
├── start.bat                # Windows 快速啟動批次檔
├── requirements.txt         # Python 套件清單
├── .env                     # 後端環境變數（不納入 git）
├── .gitignore
├── README.md                # 本說明文件
├── VERSION.md               # 語意化版本與 Change Log
└── frontend/
    ├── src/
    │   ├── App.tsx               # 路由主控（SPA 路由守衛）
    │   ├── pages/
    │   │   ├── LoginPage.tsx     # 登入頁（Google OAuth + 測試模式）
    │   │   ├── RoleSetup.tsx     # 首次登入角色設定
    │   │   ├── TeacherDashboard.tsx  # 教師主控台（點名 + 出勤管理）
    │   │   ├── StudentDashboard.tsx  # 學生即時看板（圓餅圖統計）
    │   │   └── FaceRegistration.tsx  # 三角度人臉特徵註冊精靈
    │   ├── hooks/
    │   │   └── useApiBase.ts     # 動態後端 URL 讀取 + 健康檢查
    │   ├── lib/
    │   │   └── supabase.ts       # Supabase client 初始化
    │   └── types/
    │       └── index.ts          # TypeScript 型別定義
    ├── .env                      # 前端環境變數（不納入 git）
    ├── package.json
    └── vite.config.ts
```

---

## ⚙️ 本機開發環境需求

| 環境 | 版本需求 |
|------|---------|
| Python | 3.8 以上 |
| Node.js | 18 以上 |
| npm | 9 以上 |
| OS | Windows 10/11（InsightFace 相容性最佳） |

---

## 🚀 快速啟動

### Step 1 — 建立環境變數

**後端**（根目錄 `.env`）：
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
NGROK_AUTHTOKEN=your-ngrok-authtoken
```

**前端**（`frontend/.env`）：
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_TEACHER_CODE=your-teacher-verify-code
```

> 範本參考 `.env.example`（若存在）

### Step 2 — 安裝 Python 套件

```bash
pip install -r requirements.txt
```

### Step 3 — 啟動 AI 後端

```bash
# 方式一：一鍵啟動（同時啟動後端 + ngrok + 寫入 Supabase URL）
python start_server.py

# 方式二：Windows 雙擊
start.bat

# 方式三：手動啟動後端（不含 ngrok）
uvicorn main:app --reload
```

> 後端啟動後可訪問 API 文件：http://127.0.0.1:8000/docs

### Step 4 — 啟動前端開發伺服器

```bash
cd frontend
npm install          # 首次需安裝套件
npm run dev          # 開啟 http://localhost:5173
```

### Step 5 — 部署至 GitHub Pages（生產環境）

```bash
cd frontend
npm run deploy       # 自動 build + 推送至 gh-pages 分支
```

---

## 🌿 分支說明

| 分支 | 用途 |
|------|------|
| `main` | **主開發分支**：所有原始碼（前端 src、後端 Python、設定檔）均在此分支維護 |
| `gh-pages` | **生產發布分支**：由 `npm run deploy` 自動產生，存放 Vite 打包後的靜態檔案，GitHub Pages 由此分支提供服務。**請勿手動修改此分支** |

### 開發工作流

```
開發 → 在 main 修改程式碼
      ↓
測試 → npm run dev（本地預覽）
      ↓
提交 → git add . && git commit -m "..."
      ↓
推送 → git push origin main
      ↓
部署 → cd frontend && npm run deploy（更新 gh-pages）
```

---

## 🔌 後端 API 端點

| Method | 路由 | 功能 |
|--------|------|------|
| `GET` | `/health` | 健康檢查（前端每 30 秒輪詢） |
| `GET` | `/` | 根路由狀態 |
| `POST` | `/api/register-face` | 人臉特徵註冊（Online Feature Fusion） |
| `POST` | `/api/roll-call` | 多人課堂點名辨識 + 出勤寫入 |
| `POST` | `/api/sync-schedule` | 南台校務課表一鍵同步（雙模式：真實校務抓取 / 智慧示範備援，密碼不落盤） |
| `POST` | `/api/search-face` | 單人人臉搜尋 |
| `POST` | `/api/test-insert` | 測試向量寫入（開發用） |

---

## 🗄️ Supabase 資料庫設定

在 Supabase SQL Editor 執行以下 SQL 建立必要資料表：

```sql
-- 1. 啟用 pgvector 擴充
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 使用者角色表
CREATE TABLE IF NOT EXISTS user_roles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        UNIQUE NOT NULL,
  role         TEXT        NOT NULL CHECK (role IN ('teacher', 'student')),
  student_id   TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 人臉特徵向量表
CREATE TABLE IF NOT EXISTS student_faces (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     TEXT        UNIQUE NOT NULL,
  name           TEXT        NOT NULL,
  face_embedding VECTOR(512) NOT NULL
);

-- 4. 向量相似度搜尋 RPC
CREATE OR REPLACE FUNCTION match_student_face(
  query_embedding VECTOR(512),
  match_threshold FLOAT,
  match_count     INT
)
RETURNS TABLE (student_id TEXT, name TEXT, similarity FLOAT)
LANGUAGE sql STABLE AS $$
  SELECT student_id, name, 1 - (face_embedding <=> query_embedding) AS similarity
  FROM student_faces
  WHERE 1 - (face_embedding <=> query_embedding) >= match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- 5. 出勤紀錄表
CREATE TABLE IF NOT EXISTS attendance_records (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   TEXT        NOT NULL,
  student_name TEXT,
  course_name  TEXT,
  date         DATE        NOT NULL,
  check_in_time TIMESTAMPTZ,
  status       TEXT        NOT NULL DEFAULT 'absent'
                          CHECK (status IN ('present','late','absent','excused_sick','excused_personal')),
  note         TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 動態 API 設定表
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_app_config" ON app_config FOR ALL USING (true) WITH CHECK (true);

-- 7. 使用者課表（南台校務課表同步，不儲存任何密碼）
CREATE TABLE IF NOT EXISTS user_schedules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('teacher', 'student')),
  course_id   TEXT,
  course_name TEXT        NOT NULL,
  day_of_week INTEGER     NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period      TEXT        NOT NULL,
  room        TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_user_schedules" ON user_schedules FOR ALL USING (true) WITH CHECK (true);

-- 8. 學生請假申請與教師審核表
CREATE TABLE IF NOT EXISTS leave_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   TEXT        NOT NULL,
  student_name TEXT,
  course_name  TEXT        NOT NULL,
  leave_date   DATE        NOT NULL,
  period       TEXT,
  leave_type   TEXT        NOT NULL CHECK (leave_type IN ('excused_sick', 'excused_personal')),
  reason       TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ
);
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_leave_requests" ON leave_requests FOR ALL USING (true) WITH CHECK (true);
```

---

## 👨‍💻 專題資訊

| 項目 | 內容 |
|------|------|
| 學校 | 南臺科技大學 |
| 系所 | 資訊工程學系 |
| 學生 | 吳凱崴 |
| 學號 | 4B2G0037 |
| 指導老師 | 陳定宏 教授 |

---

## 📄 授權

本專題程式碼僅供學術研究與教學示範使用。
