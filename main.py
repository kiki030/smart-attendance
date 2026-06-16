import os
import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv
from insightface.app import FaceAnalysis

# ── 載入環境變數 ──────────────────────────────────────────────
load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

# ── 初始化 Supabase Client ────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── 初始化 FastAPI ────────────────────────────────────────────
app = FastAPI(
    title="Smart Attendance System API",
    description="A smart attendance management system powered by FastAPI, InsightFace & Supabase",
    version="2.0.0"
)

# ── 初始化 InsightFace AI 引擎（YOLOv8-Face + ArcFace）────────
# CPUExecutionProvider 確保跨平台相容性，GPU 環境可換成 CUDAExecutionProvider
face_app = FaceAnalysis(providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))


# ── 請求資料模型 ──────────────────────────────────────────────
class StudentInsertRequest(BaseModel):
    student_id: str
    name: str


# ── 人臉特徵提取函式（InsightFace 真實推論）───────────────────
def extract_face_embedding(img_matrix) -> list:
    """
    輸入：OpenCV BGR 影像矩陣 (numpy ndarray)
    輸出：512 維 ArcFace 標準化人臉特徵向量 (list of float)

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

    # 取第一張偵測到的人臉之標準化 Embedding 向量
    embedding: list[float] = faces[0].normed_embedding.tolist()
    return embedding


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


# ── 路由：真實人臉註冊（上傳照片 → 提取特徵 → 寫入 Supabase）─
@app.post("/api/register-face")
async def register_face(
    student_id: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
):
    """
    接收學生 ID、姓名與人臉照片（表單上傳），
    利用 InsightFace (YOLOv8-Face + ArcFace) 提取 512 維標準化特徵向量，
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

        # ── Step 3：InsightFace 提取人臉 ArcFace Embedding ───────
        # 若未偵測到人臉，extract_face_embedding 會拋出 HTTPException 400
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

    except HTTPException:
        raise  # 直接往上拋出（人臉未偵測錯誤）
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }
