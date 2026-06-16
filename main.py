import os
import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File, Form
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

# ── 載入環境變數 ──────────────────────────────────────────────
load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

# ── 初始化 Supabase Client ────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── 初始化 FastAPI ────────────────────────────────────────────
app = FastAPI(
    title="Smart Attendance System API",
    description="A smart attendance management system powered by FastAPI & Supabase",
    version="1.0.0"
)


# ── 請求資料模型 ──────────────────────────────────────────────
class StudentInsertRequest(BaseModel):
    student_id: str
    name: str


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


# ── 路由：人臉比對搜尋（呼叫 Supabase RPC）───────────────────
@app.post("/api/search-face")
def search_face():
    """
    模擬攝影機抓取人臉後，生成 512 維 ArcFace Embedding，
    並呼叫 Supabase RPC `match_student_face` 進行向量比對。

    比對規則：
    - similarity >= 0.7 → 識別成功，回傳學生資訊
    - similarity < 0.7 或無結果 → 未知人臉，回傳 Unknown Face
    """
    MATCH_THRESHOLD = 0.7
    MATCH_COUNT = 1

    try:
        # 生成 512 維隨機浮點數向量（模擬攝影機現場擷取的 ArcFace embedding）
        query_embedding: list[float] = np.random.rand(512).tolist()

        # 呼叫 Supabase RPC 進行向量相似度比對
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

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


# ── 人臉特徵提取函式（AI 模型橋接介面）───────────────────────
def extract_face_embedding(img_matrix) -> list:
    """
    輸入：OpenCV BGR 影像矩陣 (numpy ndarray)
    輸出：512 維人臉特徵向量 (list of float)

    TODO: 未來整合 YOLOv8-Face 與 ArcFace 提取真實特徵。
          流程：YOLOv8-Face 偵測人臉框 → 裁切對齊 → ArcFace 提取 512 維 Embedding。
    """
    # TODO: 未來整合 YOLOv8-Face 與 ArcFace 提取真實特徵。
    # 暫時以 NumPy 隨機向量模擬，待模型就緒後替換此段。
    embedding: list[float] = np.random.rand(512).tolist()
    return embedding


# ── 路由：真實人臉註冊（上傳照片 → 提取特徵 → 寫入 Supabase）─
@app.post("/api/register-face")
async def register_face(
    student_id: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
):
    """
    接收學生 ID、姓名與人臉照片（表單上傳），
    利用 OpenCV 解碼影像後呼叫 extract_face_embedding() 提取特徵，
    再將 student_id、name 與 face_embedding 寫入 Supabase student_faces 資料表。
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

        # ── Step 3：提取人臉特徵向量（呼叫 AI 模型橋接函式）─────
        embedding: list[float] = extract_face_embedding(img_matrix)

        # ── Step 4：將學生資料與特徵向量寫入 Supabase ─────────────
        record = {
            "student_id": student_id,
            "name": name,
            "face_embedding": embedding,
        }
        response = supabase.table("student_faces").insert(record).execute()

        return {
            "status": "success",
            "message": f"{name}（{student_id}）人臉註冊成功！",
            "data": response.data,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }
