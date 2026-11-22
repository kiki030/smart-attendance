from __future__ import annotations
import os
import re
import sys
import json
import time
from urllib.parse import urlparse

# Windows 主控台常為 cp950，print() 含 emoji 會拋 UnicodeEncodeError 使 API 回 500；
# 改為無法編碼的字元以 '?' 取代，確保 log 輸出永遠不會中斷請求。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")  # Python 3.7+
    except Exception:
        pass
import numpy as np
import cv2
import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel, SecretStr
from supabase import create_client, Client
from dotenv import load_dotenv
from insightface.app import FaceAnalysis
from starlette.concurrency import run_in_threadpool
from bs4 import BeautifulSoup
from schedule_service import generate_demo_schedule

# ── 載入環境變數 ──────────────────────────────────────────────
load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

# ── 初始化 Supabase Client ────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── [架構說明] 出勤紀錄表（第五階段雲端對接）─────────────────
# 未來 POST /api/roll-call 點名成功後，已識別學生將寫入 Supabase 的
# attendance_records 資料表，預期欄位結構如下：
#
#   attendance_records
#   ├─ id            : uuid (PK, 自動產生)
#   ├─ student_id    : text (外鍵對應 student_faces.student_id)
#   ├─ name          : text
#   ├─ similarity    : float4 (AI 比對相似度)
#   ├─ status        : text  ('present' | 'unknown_alert')
#   └─ recorded_at   : timestamptz (預設 now())
#
# TODO: 待資料表建立後，在 roll_call 路由中解除下方 INSERT 的註解。

# ── 初始化 FastAPI ────────────────────────────────────────────
app = FastAPI(
    title="Smart Attendance System API",
    description="A smart attendance management system powered by FastAPI, InsightFace & Supabase",
    version="2.0.0"
)

# ── CORS：允許 GitHub Pages、ngrok、本機開發 ─────────────────
# allow_origins=["*"] 讓任意來源皆可呼叫（展示用）
# 正式部署建議改為指定來源清單
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 健康檢查端點（前端用來確認後端是否在線）──────────────────
@app.get("/health")
def health_check():
    return {"status": "ok", "version": "2.0.0", "ai_engine": "InsightFace buffalo_l"}


# ── 404 友善訊息：列出目前可用路由，方便判斷「後端版本過舊未重啟」或「路徑拼錯」──
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and exc.detail == "Not Found":
        available = sorted(
            {r.path for r in app.routes if r.path.startswith("/api/")}
        )
        return JSONResponse(
            status_code=404,
            content={
                "detail": (
                    f"後端找不到路由 {request.method} {request.url.path}。"
                    "請確認路徑拼寫，或後端是否已重啟載入最新版程式（python start_server.py）。"
                ),
                "available_api_routes": available,
            },
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

# CPUExecutionProvider 確保跨平台相容性，GPU 環境可換成 CUDAExecutionProvider
face_app = FaceAnalysis(providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))


# ── 請求資料模型 ──────────────────────────────────────────────
class StudentInsertRequest(BaseModel):
    student_id: str
    name: str


class ScheduleSyncRequest(BaseModel):
    account: str
    password: SecretStr  # SecretStr：repr / log 時自動遮蔽為 '**********'
    role: str = "student"
    user_id: str


# ── 人臉特徵提取函式（InsightFace 真實推論）───────────────────
def extract_face_embedding(img_matrix) -> list[float]:
    """
    輸入：OpenCV BGR 影像矩陣 (numpy ndarray)
    輸出：512 維 ArcFace 標準化人臉特徵向量 (list[float])

    流程：YOLOv8-Face 偵測人臉框 → 對齊裁切 → ArcFace 提取 512 維 Embedding
    防呆：若未偵測到人臉，拋出 HTTPException 400
    """
    faces = face_app.get(img_matrix)

    if len(faces) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "status": "failed",
                "message": "未偵測到任何人臉，請重新拍照",
            },
        )

    # 取第一張偵測到的人臉之標準化 ArcFace Embedding
    return faces[0].normed_embedding.tolist()


# ── 姓名正規化：去除開頭夾帶的學號前綴 ──────────────────────
def normalize_name(name: str, student_id: str) -> str:
    """
    若 student_name 開頭包含 student_id（例如 '4B6G3336 痛又痛'），
    自動去除學號前綴，只保留純姓名。
    """
    cleaned = name.replace(student_id, "").strip()
    return cleaned if cleaned else name  # 若清洗後為空，保留原始值作為 fallback


# ── 路由：根路由健康檢查 ──────────────────────────────────────
@app.get("/")
def root():
    return {"status": "Smart Attendance System API Running"}


# ── 路由：測試插入 Supabase（含模擬 ArcFace Embedding）────────
@app.post("/api/test-insert")
def test_insert(payload: StudentInsertRequest):
    """
    接收 student_id 與 name，
    隨機生成 512 維 face embedding（模擬 ArcFace 輸出），
    並寫入 Supabase 的 student_faces 資料表。
    """
    try:
        # 生成 512 維隨機浮點數向量（模擬 ArcFace embedding）
        embedding: list[float] = np.random.rand(512).tolist()

        # 準備寫入資料
        record = {
            "student_id": payload.student_id,
            "name": payload.name,
            "face_embedding": embedding,
        }

        # 寫入 Supabase student_faces 資料表
        response = supabase.table("student_faces").insert(record).execute()

        return {
            "status": "success",
            "data": response.data,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


# ── 路由：真實人臉比對搜尋（上傳照片 → 提取特徵 → Supabase RPC）
@app.post("/api/search-face")
async def search_face(
    file: UploadFile = File(...),
):
    """
    接收現場點名攝影機拍攝的人臉照片，
    使用 InsightFace 提取 ArcFace 特徵後，
    呼叫 Supabase RPC `match_student_face` 進行向量比對。

    比對規則：
    - similarity >= 0.7 → 識別成功，回傳學生資訊
    - similarity < 0.7 或無結果 → 未知人臉，回傳 Unknown Face
    """
    MATCH_THRESHOLD = 0.7
    MATCH_COUNT = 1

    try:
        # ── Step 1：讀取上傳的影像檔案 bytes ──────────────────────
        image_bytes = await file.read()

        # ── Step 2：使用 NumPy + OpenCV 解碼為 BGR 影像矩陣 ──────
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img_matrix = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img_matrix is None:
            return {
                "status": "error",
                "message": "無法解碼影像，請確認上傳的檔案為有效的圖片格式（JPG / PNG）。",
            }

        # ── Step 3：InsightFace 提取人臉 ArcFace Embedding ───────
        # 若未偵測到人臉，extract_face_embedding 會拋出 HTTPException 400
        query_embedding: list[float] = extract_face_embedding(img_matrix)

        # ── Step 4：呼叫 Supabase RPC 進行向量相似度比對 ──────────
        response = supabase.rpc(
            "match_student_face",
            {
                "query_embedding": query_embedding,
                "match_threshold": MATCH_THRESHOLD,
                "match_count": MATCH_COUNT,
            },
        ).execute()

        results = response.data  # 比對結果串列

        # ── 核心比對邏輯：未知人臉過濾防呆機制 ──────────────────
        if results and len(results) > 0:
            best_match = results[0]
            similarity = best_match.get("similarity", 0)

            if similarity >= MATCH_THRESHOLD:
                # ✅ 識別成功：相似度達標
                return {
                    "status": "success",
                    "match": True,
                    "student": best_match,
                }
            else:
                # ❌ 相似度不足：視為未知人臉
                return {
                    "status": "success",
                    "match": False,
                    "message": "Unknown Face",
                    "similarity": similarity,
                }
        else:
            # ❌ 資料庫無任何相符結果
            return {
                "status": "success",
                "match": False,
                "message": "Unknown Face",
            }

    except HTTPException:
        raise  # 直接往上拋出（人臉未偵測錯誤）
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


# ── 路由：人臉註冊（Feature Fusion 在線平均融合，一學生一行）────────
@app.post("/api/register-face")
async def register_face(
    student_id: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
):
    """
    接收學生 ID、姓名與人臉照片，實施 Online Feature Fusion 演算：

    - 新註冊：直接提取特徵向量並寫入新行（INSERT）
    - 重複上傳（其他角度照片）：讀呈舊向量，與新向量進行權衡均値融合，再 UPDATE 更新

    融合公式： fused = (old_embedding + new_embedding) / 2
    權益：符合第三正規化（一學生一行），多次註冊越渴不同角度特徵越豐富
    """
    try:
        # ── Step 1：讀取上傳的影像檔案 bytes ──────────────────────
        image_bytes = await file.read()

        # ── Step 2：使用 NumPy + OpenCV 解碼為 BGR 影像矩陣 ──────
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img_matrix = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img_matrix is None:
            return {
                "status": "error",
                "message": "無法解碼影像，請確認上傳的檔案為有效的圖片格式（JPG / PNG）。",
            }

        # ── Step 3：InsightFace 提取人臉 ArcFace Embedding ───────────
        # 若未偵測到人臉，extract_face_embedding 會拋出 HTTPException 400
        new_embedding: list[float] = extract_face_embedding(img_matrix)

        # 清洗姓名：去除開頭夾帶的學號前綴（例如 '4B6G3336 痛又痛' → '痛又痛'）
        clean_name = normalize_name(name, student_id)

        # ── Step 4：查詢該 student_id 是否已存在於 Supabase ───────────
        existing = (
            supabase.table("student_faces")
            .select("id, face_embedding")
            .eq("student_id", student_id)
            .limit(1)
            .execute()
        )

        if not existing.data:
            # ─── 新註冊：直接 INSERT ────────────────────────────────────
            record = {
                "student_id": student_id,
                "name": clean_name,
                "face_embedding": new_embedding,
            }
            response = supabase.table("student_faces").insert(record).execute()

            return {
                "status": "success",
                "action": "inserted",
                "message": f"{clean_name}（{student_id}）人臉註冊成功！張入新特徵向量。",
                "data": response.data,
            }

        else:
            # ─── 重複上傳：均値融合後 UPDATE ─────────────────────────
            row = existing.data[0]
            row_id = row["id"]
            old_embedding: list[float] = row["face_embedding"]

            # Feature Fusion：引入 NumPy 進行向量平均融合
            # 防呆：Supabase 有時回傳 JSON 字串而非 list，需先解析
            if isinstance(old_embedding, str):
                old_embedding = json.loads(old_embedding)

            old_vec = np.array(old_embedding, dtype=np.float64)
            new_vec = np.array(new_embedding, dtype=np.float64)
            fused_vec = (old_vec + new_vec) / 2.0

            # L2 正規化：確保融合後向量仍為單位長度（和 ArcFace 輸出一致）
            norm = np.linalg.norm(fused_vec)
            if norm > 0:
                fused_vec = fused_vec / norm
            fused_list: list[float] = fused_vec.tolist()

            # UPDATE 該學生的特徵向量與清洗後的姓名
            response = (
                supabase.table("student_faces")
                .update({"face_embedding": fused_list, "name": clean_name})
                .eq("id", row_id)
                .execute()
            )

            return {
                "status": "success",
                "action": "fused_and_updated",
                "message": f"{clean_name}（{student_id}）特徵融合完成！新角度特徵已均値嵌入至雲端向量。",
                "data": response.data,
            }

    except HTTPException:
        raise  # 直接往上拋出（人臉未偵測錯誤）
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


# ── 路由：多人影像即時點名（教室全景 → 多臉偵測 → 批次比對）──
@app.post("/api/roll-call")
async def roll_call(
    file: UploadFile = File(...),
    course_name: str = Form(default="人工智慧概論"),
    class_start_time: str = Form(default=""),
):
    """
    接收教室鏡頭畫面，進行多人臉即時點名辨識。

    新增參數：
      course_name       : 課程名稱（預設 '人工智慧概論'）
      class_start_time  : 上課開始時間，格式 'HH:MM'（空字串表示不判斷遲到）

    遲到判定邏輯：
      若 class_start_time 有提供，且簽到時間超過開課 15 分鐘
      → status = 'late'（遲到）
      否則 → status = 'present'（出席）

    回傳：
      total_detected    : 畫面中偵測到的總人臉數
      identified_count  : 成功識別的已知學生數
      unknown_count     : 未識別的未知人臉數
      results           : 每張人臉的詳細辨識結果列表
    """
    MATCH_THRESHOLD = 0.7
    MATCH_COUNT = 1
    LATE_GRACE_MINUTES = 15  # 開課後超過幾分鐘視為遲到

    # ── 遲到判定：計算簽到當下是否超過容許遲到時間 ──────────
    now = datetime.datetime.now()
    attendance_status = "present"

    if class_start_time:
        try:
            h, m = map(int, class_start_time.strip().split(":"))
            start_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
            diff_minutes = (now - start_dt).total_seconds() / 60
            if diff_minutes > LATE_GRACE_MINUTES:
                attendance_status = "late"
        except Exception:
            pass  # 格式錯誤則忽略遲到判定，預設 present

    try:
        # ── Step 1：讀取上傳的影像檔案 bytes ──────────────────────
        image_bytes = await file.read()

        # ── Step 2：使用 NumPy + OpenCV 解碼為 BGR 影像矩陣 ──────
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img_matrix = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img_matrix is None:
            return {
                "status": "error",
                "message": "無法解碼影像，請確認上傳的檔案為有效的圖片格式（JPG / PNG）。",
            }

        # ── Step 3：YOLOv8-Face 偵測畫面中所有人臉 ───────────────
        faces = face_app.get(img_matrix)
        total_detected: int = len(faces)

        if total_detected == 0:
            return {
                "status": "success",
                "message": "畫面中未偵測到任何人臉。",
                "total_detected": 0,
                "identified_count": 0,
                "unknown_count": 0,
                "results": [],
            }

        # ── Step 4：Multi-face Loop —— 對每張臉個別比對 ──────────
        results: list[dict] = []
        identified_count: int = 0
        unknown_count: int = 0

        for face in faces:
            # 提取該張人臉的 512 維 ArcFace 標準化 Embedding
            face_embedding: list[float] = face.normed_embedding.tolist()

            # 呼叫 Supabase RPC 進行向量相似度搜尋
            rpc_response = supabase.rpc(
                "match_student_face",
                {
                    "query_embedding": face_embedding,
                    "match_threshold": MATCH_THRESHOLD,
                    "match_count": MATCH_COUNT,
                },
            ).execute()

            match_data = rpc_response.data

            # ── 已知學生判斷（similarity >= 0.7）─────────────────
            if match_data and len(match_data) > 0:
                best = match_data[0]
                similarity: float = float(best.get("similarity", 0))

                if similarity >= MATCH_THRESHOLD:
                    # ✅ 識別成功：加入已知學生列表（套用遲到判定結果）
                    results.append({
                        "student_id": best.get("student_id", "unknown"),
                        "name": best.get("name", "Unknown"),
                        "similarity": round(similarity, 4),
                        "status": attendance_status,
                    })
                    identified_count += 1

                    # ── 防重複簽到：同一學生 + 同一課程 + 今日，只寫入一次 ──
                    today_str = datetime.date.today().isoformat()
                    sid = best.get("student_id", "unknown")
                    sname = normalize_name(best.get("name", "Unknown"), sid)  # 清洗學號前綴
                    try:
                        # 查詢條件：student_id + course_name + date 三者皆符合才算重複
                        existing_att = (
                            supabase.table("attendance_records")
                            .select("id, status")
                            .eq("student_id", sid)
                            .eq("course_name", course_name)
                            .eq("date", today_str)
                            .limit(1)
                            .execute()
                        )

                        if not existing_att.data:
                            # ✅ 此課程今日尚無紀錄 → 正常 INSERT
                            supabase.table("attendance_records").insert({
                                "student_id": sid,
                                "student_name": sname,
                                "status": attendance_status,
                                "check_in_time": now.astimezone().isoformat(),
                                "course_name": course_name,
                                "date": today_str,
                            }).execute()
                            print(f"    ✅ 寫入出勤：{sname}（{sid}）→ {attendance_status}")
                        else:
                            # ⏭️ 已有紀錄：跳過 INSERT，僅在原狀態為 absent 時更新
                            existing_row = existing_att.data[0]
                            existing_id = existing_row.get("id")
                            existing_status = existing_row.get("status", "present")
                            if existing_status == "absent":
                                supabase.table("attendance_records")\
                                    .update({
                                        "status": attendance_status,
                                        "check_in_time": now.astimezone().isoformat(),
                                    })\
                                    .eq("id", existing_id)\
                                    .execute()
                                print(f"    🔄 更新出勤（absent→{attendance_status}）：{sname}（{sid}）")
                            else:
                                print(f"    ⏭️ 跳過重複簽到：{sname}（{sid}），課程={course_name}，狀態={existing_status}")
                    except Exception as e_db:
                        print(f"    ⚠️ 寫入出勤紀錄失敗: {e_db}")

                else:
                    # ❌ 相似度不足：視為未知人臉
                    results.append({
                        "student_id": "unknown",
                        "name": "Unknown",
                        "similarity": round(similarity, 4),
                        "status": "unknown_alert",
                    })
                    unknown_count += 1

            else:
                # ❌ 資料庫中完全無相符結果：未知人臉
                results.append({
                    "student_id": "unknown",
                    "name": "Unknown",
                    "similarity": 0.0,
                    "status": "unknown_alert",
                })
                unknown_count += 1

        # ── Step 5：組裝並回傳完整點名結果 ────────────────────────
        return {
            "status": "success",
            "total_detected": total_detected,
            "identified_count": identified_count,
            "unknown_count": unknown_count,
            "attendance_status": attendance_status,
            "results": results,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }



# ── 南台科大 ePortal 真實課表爬蟲（Playwright 同步版）──────────
ESPORTAL_TIMETABLE_URL = "https://eportal.stust.edu.tw/CourSel/Pages/MyTimeTable.aspx?role={role_code}"
ESPORTAL_TABLE_SELECTOR = "#ctl00_ContentPlaceHolder1_ScheduleList1_dg_dt"
STUST_IDENTITY_HOST = "identity.stust.edu.tw"
STUST_ESPORTAL_HOST = "eportal.stust.edu.tw"
# 攔截無用靜態資源以加速載入；document / script / xhr / fetch 一律放行，避免影響 SSO 與 ASP.NET 轉址
_BLOCKED_RESOURCE_TYPES = {"image", "stylesheet", "font", "media"}
_CHROMIUM_ARGS = ["--disable-gpu", "--disable-extensions", "--disable-dev-shm-usage", "--no-sandbox"]
STUST_DEBUG_SHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug_stust_last.png")
# 只比對登入頁「可見文字」，避免被 script / 隱藏欄位中的字樣誤判
_LOGIN_FAIL_PATTERN = re.compile(
    r"失敗|錯誤|Invalid|Login failed|incorrect|not valid|Authentication failed|unsuccessful",
    re.I,
)
_LOGIN_SUBMIT_SELECTORS = [
    "#loginButton2",
    'input[name*="login" i]',
    'input[type="submit"]',
    'button[type="submit"]',
    'input[type="image"]',
    'button:has-text("登入")',
    'input[value*="登入"]',
]
_PERIOD_LABEL_RE = re.compile(r"第\s*(\d+)\s*節")
_PERIOD_TIME_RE = re.compile(r"(\d{1,2}:\d{2})\s*[~～\-–]\s*(\d{1,2}:\d{2})")


def _cell_lines(td) -> list[str]:
    """取出儲存格 <span>（若無則整格）內以 <br> / 換行分隔的非空行。"""
    node = td.find("span") or td
    for br in node.find_all("br"):
        br.replace_with("\n")
    return [ln.strip() for ln in node.get_text().splitlines() if ln.strip()]


def parse_stust_timetable(html: str) -> list[dict]:
    """解析 ePortal 課表表格 HTML，回傳 [{day_of_week, period, course_name, room}, ...]。"""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one(ESPORTAL_TABLE_SELECTOR) or soup
    entries: list[dict] = []

    for tr in table.find_all("tr"):
        if tr.find("th"):  # 略過標題列
            continue
        tds = tr.find_all("td", recursive=False) or tr.find_all("td")
        if len(tds) < 8:
            continue
        head_lines = _cell_lines(tds[0])
        head_text = " ".join(head_lines).strip()
        if not head_text:  # 例如第 9、11 節之間的空白列
            continue

        label = _PERIOD_LABEL_RE.search(head_text)
        period_name = f"第{label.group(1)}節" if label else head_lines[0]
        t = _PERIOD_TIME_RE.search(head_text)
        period_str = f"{period_name} ({t.group(1)}~{t.group(2)})" if t else period_name

        for day_idx in range(1, 8):
            lines = _cell_lines(tds[day_idx])
            if not lines:
                continue
            course_name = lines[0]
            room = ""
            if len(lines) > 1:
                parts = lines[1].split()
                room = parts[-1] if parts else ""
            entries.append({
                "day_of_week": day_idx,
                "period": period_str,
                "course_name": course_name,
                "room": room,
            })
    return entries


def _stust_login_error() -> HTTPException:
    return HTTPException(status_code=401, detail="南台校務帳號或密碼錯誤，請重新確認")


class _BadCredentials(Exception):
    """登入頁確實顯示了錯誤提示（內部使用，不含帳密）。"""


def _log_stage(stage: str, started: float) -> float:
    """印出階段耗時（秒）並回傳目前時間。僅輸出階段名稱與秒數，絕不含帳密。"""
    now = time.monotonic()
    print(f"    ⏱️ [課表同步] {stage}：{now - started:.2f}s")
    return now


def _route_filter(route) -> None:
    try:
        if route.request.resource_type in _BLOCKED_RESOURCE_TYPES:
            route.abort()
        else:
            route.continue_()
    except Exception:
        pass  # 頁面已關閉等情況，忽略


def _host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def fetch_stust_schedule_sync(account: str, password: str, role: str) -> list[dict]:
    """
    以 Playwright 同步 API 登入南台 NetIQ SSO，抓取 ePortal 課表。
    須以 run_in_threadpool 呼叫（Windows 的 asyncio 事件迴圈不支援在其中啟動子行程）。

    - 401：只有登入頁（含所有 iframe）確實出現錯誤提示文字時才回傳。
    - 502：逾時 / 找不到按鈕 / 停在其他頁面，訊息附上卡住的步驟、網域與頁面標題，
           並於失敗時存 debug_stust_last.png（存圖前會先清空密碼欄位）。
    - 安全性：password 僅用於填入登入表單，不印出、不寫入資料庫、不放入例外訊息或 log。
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    role_code = "T" if role == "teacher" else "S"
    target_url = ESPORTAL_TIMETABLE_URL.format(role_code=role_code)

    # 先用輸入值；若登入頁明確回報錯誤，再以小寫重試一次（南台帳號可能區分大小寫）
    candidates = [account]
    if account.lower() != account:
        candidates.append(account.lower())

    def on_identity(page) -> bool:
        return _host_of(page.url) == STUST_IDENTITY_HOST

    def on_eportal(page) -> bool:
        return _host_of(page.url) == STUST_ESPORTAL_HOST

    def table_ready(page) -> bool:
        try:
            return on_eportal(page) and page.locator(ESPORTAL_TABLE_SELECTOR).count() > 0
        except Exception:
            return False

    def page_title(page) -> str:
        try:
            return page.title()
        except Exception:
            return "?"

    def save_debug(page) -> None:
        """失敗時存截圖；先把所有 frame 內的密碼欄位清空，避免任何密碼殘留於畫面。"""
        try:
            for fr in page.frames:
                try:
                    fr.evaluate(
                        "document.querySelectorAll('input[type=password]').forEach(e => e.value = '')"
                    )
                except Exception:
                    pass
            page.screenshot(path=STUST_DEBUG_SHOT, full_page=True)
        except Exception:
            pass

    def stuck(page, step: str) -> HTTPException:
        host, title = _host_of(page.url) or "?", page_title(page)
        print(f"    ⚠️ 南台課表同步卡住：step={step} host={host} title={title}")
        save_debug(page)
        return HTTPException(
            status_code=502,
            detail=(
                f"南台課表同步失敗：卡在「{step}」（目前網域：{host}，頁面標題：{title}）。"
                "已儲存 debug_stust_last.png 供檢查，請稍後再試"
            ),
        )

    def find_login_frame(page):
        for fr in page.frames:
            try:
                if fr.locator('input[name="Ecom_Password"], input[type="password"]').count() > 0:
                    return fr
            except Exception:
                continue
        return None

    def login_error_visible(page) -> bool:
        """登入頁（含所有 iframe）的可見文字是否出現錯誤提示。"""
        for fr in page.frames:
            try:
                text = fr.locator("body").inner_text(timeout=1500)
            except Exception:
                continue  # frame 正在跳轉 / 已卸載
            if _LOGIN_FAIL_PATTERN.search(text or ""):
                return True
        return False

    def attempt_login(page, user: str) -> None:
        """在登入頁填表並明確點擊登入按鈕；成功跳回 ePortal 網域即返回。"""
        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
        except PlaywrightTimeout:
            raise stuck(page, "開啟課表網址")

        if on_eportal(page):
            return  # 已有 SSO session，不需登入

        # 登入表單在巢狀 iframe 內：frame 一有導覽事件就立即重新檢查（事件驅動，無固定 sleep）
        login_frame = find_login_frame(page)
        form_deadline = time.monotonic() + 20
        while not login_frame and time.monotonic() < form_deadline:
            try:
                page.wait_for_event("framenavigated", timeout=1000)
            except PlaywrightTimeout:
                pass
            login_frame = find_login_frame(page)
        if not login_frame:
            raise stuck(page, "等待登入表單載入")
        try:
            login_frame.wait_for_selector('input[name="Ecom_Password"], input[type="password"]', timeout=10000)
        except PlaywrightTimeout:
            raise stuck(page, "等待登入表單載入")

        user_input = login_frame.locator('input[name="Ecom_User_ID"]')
        if user_input.count() == 0:
            user_input = login_frame.locator('input[type="text"]:visible')
        pwd_input = login_frame.locator('input[name="Ecom_Password"]')
        if pwd_input.count() == 0:
            pwd_input = login_frame.locator('input[type="password"]')
        if user_input.count() == 0 or pwd_input.count() == 0:
            raise stuck(page, "尋找帳號 / 密碼欄位")

        user_input.first.fill(user)
        pwd_input.first.fill(password)

        # 在同一個 frame 內明確尋找並點擊登入按鈕；找不到才退回 Enter
        clicked = False
        for sel in _LOGIN_SUBMIT_SELECTORS:
            try:
                btn = login_frame.locator(sel)
                if btn.count() == 0:
                    continue
                if btn.first.is_visible():
                    btn.first.click(timeout=10000)
                else:
                    btn.first.evaluate("el => el.click()")  # 影像被攔截時按鈕可能無尺寸
                clicked = True
                break
            except Exception:
                continue
        if not clicked:
            pwd_input.first.press("Enter")

        # 等待真正跳回 ePortal 網域（上限 20 秒）；每 1.5 秒檢查一次是否出現真正的錯誤提示
        started = time.monotonic()
        while time.monotonic() - started < 20:
            try:
                page.wait_for_url(lambda u: _host_of(u) == STUST_ESPORTAL_HOST, timeout=1500)
                return
            except PlaywrightTimeout:
                pass
            if on_identity(page) and time.monotonic() - started > 2 and login_error_visible(page):
                raise _BadCredentials()
        raise stuck(page, "等待跳回 ePortal（SSO 轉址逾時）")

    t0 = time.monotonic()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=_CHROMIUM_ARGS)
        try:
            context = browser.new_context(locale="zh-TW", ignore_https_errors=True)
            context.route("**/*", _route_filter)
            page = context.new_page()
            page.set_default_timeout(20000)
            t1 = _log_stage("啟動瀏覽器", t0)

            bad_credentials = True
            for idx, user in enumerate(candidates):
                try:
                    attempt_login(page, user)
                    bad_credentials = False
                    break
                except _BadCredentials:
                    # 清掉 SSO 殘留狀態，換下一個帳號寫法重試
                    context.clear_cookies()
                    continue
            if bad_credentials:
                raise _stust_login_error()
            t2 = _log_stage("SSO 登入", t1)

            # 已進入 ePortal（可能停在 MenuTop.aspx 等頁）：若沒有課表表格，強制前往課表頁
            if not table_ready(page):
                try:
                    page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
                except PlaywrightTimeout:
                    raise stuck(page, "前往課表頁面")
                try:
                    page.wait_for_selector(ESPORTAL_TABLE_SELECTOR, timeout=20000)
                except PlaywrightTimeout:
                    raise stuck(page, "等待課表表格出現")

            html = page.locator(ESPORTAL_TABLE_SELECTOR).first.evaluate("el => el.outerHTML")
            t3 = _log_stage("前往課表頁並取得表格", t2)
        finally:
            browser.close()

    entries = parse_stust_timetable(html)
    _log_stage("解析課表", t3)
    return entries


# ── 路由：南台校務課表一鍵同步 ────────────────────────────────
@app.post("/api/sync-schedule")
async def sync_schedule(payload: ScheduleSyncRequest):
    """
    接收 { account, password, role, user_id }，取得本學期課表並寫入 Supabase user_schedules。

    - 密碼為 demo（不分大小寫）→ 回傳示範課表（發表展示用）
    - 其他密碼 → 一律執行 Playwright 真實爬蟲；失敗時回傳明確錯誤，不會退回假課表

    安全性：密碼只在本函式記憶體中短暫使用，不寫入資料庫、不印出 log、不回傳前端。
    """
    account = payload.account.strip()
    user_id = payload.user_id.strip()
    role = payload.role if payload.role in ("student", "teacher") else "student"

    if not account or not user_id:
        raise HTTPException(status_code=400, detail="帳號與使用者識別碼不可為空")

    password = payload.password.get_secret_value()
    try:
        if password.strip().lower() == "demo":
            source = "demo"
            message = "展示模式：已產生示範課表"
            entries = generate_demo_schedule(account, role)
        else:
            source = "stust_eportal"
            message = "已成功從南台 ePortal 同步課表"
            try:
                entries = await run_in_threadpool(fetch_stust_schedule_sync, account, password, role)
            except HTTPException:
                raise
            except Exception as e:
                # 只記錄例外類型，避免任何可能含帳密的內容進入 log
                print(f"    ⚠️ 南台 ePortal 課表抓取失敗：{type(e).__name__}")
                if "Executable doesn't exist" in str(e):
                    raise HTTPException(
                        status_code=500,
                        detail="伺服器尚未安裝 Chromium，請在後端執行：python -m playwright install chromium",
                    )
                raise HTTPException(status_code=502, detail="連線南台校務系統失敗，請稍後再試")
    finally:
        password = ""  # 用完立即清除區域變數

    if not entries:
        raise HTTPException(status_code=404, detail="已登入但本學期查無課表資料")

    synced_at = datetime.datetime.now().astimezone().isoformat()
    rows = [
        {
            "user_id": user_id,
            "role": role,
            "course_id": e.get("course_id"),
            "course_name": e["course_name"],
            "day_of_week": e["day_of_week"],
            "period": e.get("period")
            or (
                str(e["period_start"])
                if e["period_start"] == e["period_end"]
                else f"{e['period_start']}-{e['period_end']}"
            ),
            "room": e.get("room") or e.get("classroom"),
            "updated_at": synced_at,
        }
        for e in entries
    ]

    try:
        # 先清除該使用者的舊課表，再批次寫入新課表
        t_db = time.monotonic()
        supabase.table("user_schedules").delete().eq("user_id", user_id).execute()
        inserted = supabase.table("user_schedules").insert(rows).execute()
        _log_stage("寫入資料庫", t_db)
    except Exception as e_db:
        print(f"    ⚠️ 寫入 user_schedules 失敗：{e_db}")
        raise HTTPException(
            status_code=500,
            detail="課表寫入資料庫失敗，請確認 Supabase 已建立 user_schedules 資料表",
        )

    schedules = inserted.data if inserted and inserted.data else rows
    print(f"    📅 課表同步完成：user_id={user_id} role={role} source={source} 共 {len(rows)} 筆")

    return {
        "status": "success",
        "source": source,
        "message": message,
        "count": len(rows),
        "schedules": schedules,
        "schedule": schedules,  # 相容舊版前端欄位
    }
