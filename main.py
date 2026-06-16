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


# ── 人臉特徵提取函式（InsightFace 真實推論 + 水平鏡像增強）────
def extract_face_embedding(img_matrix) -> list[list[float]]:
    """
    輸入：OpenCV BGR 影像矩陣 (numpy ndarray)
    輸出：包含 1~2 組 512 維 ArcFace 標準化特徵向量的串列

    流程：
      1. YOLOv8-Face 偵測人臉框 → 對齊裁切 → ArcFace 提取原始 Embedding
      2. 水平翻轉（Horizontal Flip）同一張圖再提取一次 Embedding
         → 若翻轉後仍偵測到人臉，則一次產生雙倍角度特徵
    防呆：若原圖未偵測到人臉，拋出 HTTPException 400
    """
    # ── 原始影像推論 ─────────────────────────────────────────────
    faces = face_app.get(img_matrix)

    if len(faces) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "status": "failed",
                "message": "未偵測到任何人臉，請重新拍照",
            },
        )

    # 取第一張人臉的標準化 Embedding
    original_embedding: list[float] = faces[0].normed_embedding.tolist()
    embeddings: list[list[float]] = [original_embedding]

    # ── 水平翻轉增強：自動產生鏡像角度特徵 ─────────────────────
    flipped = cv2.flip(img_matrix, 1)          # flipCode=1 → 水平翻轉
    flipped_faces = face_app.get(flipped)
    if len(flipped_faces) > 0:
        flipped_embedding: list[float] = flipped_faces[0].normed_embedding.tolist()
        embeddings.append(flipped_embedding)

    return embeddings


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
        # extract_face_embedding 回傳 list[list[float]]（含原始+鏡像）
        # 比對時只需使用原始向量（index 0）即可
        query_embedding: list[float] = extract_face_embedding(img_matrix)[0]

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


# ── 路由：多角度人臉註冊（上傳照片 → 提取特徵 + 鏡像 → 批次寫入）
@app.post("/api/register-face")
async def register_face(
    student_id: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
):
    """
    接收學生 ID、姓名與人臉照片（表單上傳），支援多角度重複呼叫：

    - 不刪除舊資料，每次直接 INSERT 新行（允許同一 student_id 多筆）
    - 自動同時寫入原始特徵 + 水平翻轉（鏡像）特徵，一次獲得雙倍角度覆蓋
    - Supabase match_student_face RPC 在比對時取相似度最高的結果

    流程：
      YOLOv8-Face 偵測 → ArcFace 提取 512 維向量（原始 + 鏡像）
      → 批次 INSERT 至 Supabase student_faces 資料表
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

        # ── Step 3：InsightFace 提取人臉 ArcFace Embedding（含鏡像）
        # 回傳 list[list[float]]，最多 2 組：[原始向量, 鏡像向量]
        # 若未偵測到人臉，extract_face_embedding 會拋出 HTTPException 400
        embeddings: list[list[float]] = extract_face_embedding(img_matrix)

        # ── Step 4：批次 INSERT 每一組向量至 Supabase ──────────────
        # 不刪除舊資料，直接新增（支援同一 student_id 多角度多筆）
        records = [
            {
                "student_id": student_id,
                "name": name,
                "face_embedding": emb,
            }
            for emb in embeddings
        ]
        response = supabase.table("student_faces").insert(records).execute()

        angle_count = len(embeddings)
        flip_note = "（原始 + 水平鏡像）" if angle_count == 2 else "（僅原始，鏡像未偵測到人臉）"

        return {
            "status": "success",
            "message": f"{name}（{student_id}）多角度人臉註冊成功！寫入 {angle_count} 組特徵向量 {flip_note}",
            "vectors_inserted": angle_count,
            "data": response.data,
        }

    except HTTPException:
        raise  # 直接往上拋出（人臉未偵測錯誤）
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }
