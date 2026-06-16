import os
import numpy as np
from fastapi import FastAPI
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
