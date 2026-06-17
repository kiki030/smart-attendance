"""
update_ngrok_url.py
────────────────────
被 start.bat 呼叫，自動完成：
  1. 向 ngrok 本地 API 查詢目前的公開 HTTPS 網址
  2. 將網址寫入 Supabase app_config 表（key = 'api_base_url'）
  3. 前端讀取此設定，動態決定要呼叫哪個 API 網址

執行需求：python update_ngrok_url.py
"""

import time
import sys
import os
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
NGROK_LOCAL_API = "http://localhost:4040/api/tunnels"
MAX_RETRIES = 15

def get_ngrok_url() -> str | None:
    """查詢 ngrok 本地 API，取得 HTTPS 公開網址"""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(NGROK_LOCAL_API, timeout=3)
            tunnels = resp.json().get("tunnels", [])
            for tunnel in tunnels:
                if tunnel.get("proto") == "https":
                    return tunnel["public_url"]
        except Exception:
            pass
        print(f"    等待 ngrok... ({attempt + 1}/{MAX_RETRIES})")
        time.sleep(2)
    return None


def update_supabase(url: str) -> bool:
    """將 ngrok URL 寫入 Supabase app_config"""
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        sb.table("app_config").upsert({
            "key": "api_base_url",
            "value": url,
        }).execute()
        return True
    except Exception as e:
        print(f"    ⚠️  Supabase 更新失敗：{e}")
        return False


if __name__ == "__main__":
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("    ❌ 找不到 .env 設定，請確認 SUPABASE_URL 與 SUPABASE_KEY 已填入")
        sys.exit(1)

    print("    正在查詢 ngrok 網址...")
    ngrok_url = get_ngrok_url()

    if not ngrok_url:
        print("    ❌ 無法取得 ngrok URL。")
        print("    請確認：1) ngrok 已安裝  2) ngrok http 8000 已執行")
        sys.exit(1)

    print(f"    ✅ ngrok URL：{ngrok_url}")

    if update_supabase(ngrok_url):
        print(f"    ✅ 已寫入 Supabase！前端將自動使用此 API 網址")
    else:
        print(f"    ⚠️  Supabase 更新失敗，前端仍可透過本機 127.0.0.1:8000 存取")
