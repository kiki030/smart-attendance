"""
update_ngrok_url.py
--------------------
Called by start.bat to:
  1. Query local ngrok API to get the current public HTTPS URL
  2. Write the URL to Supabase app_config table (key = 'api_base_url')
  3. Frontend reads this config to dynamically route API requests
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
    """Query local ngrok API to find the HTTPS public URL"""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(NGROK_LOCAL_API, timeout=3)
            tunnels = resp.json().get("tunnels", [])
            for tunnel in tunnels:
                if tunnel.get("proto") == "https":
                    return tunnel["public_url"]
        except Exception:
            pass
        print(f"    Waiting for ngrok... ({attempt + 1}/{MAX_RETRIES})")
        time.sleep(2)
    return None


def update_supabase(url: str) -> bool:
    """Write the ngrok URL to Supabase app_config"""
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        sb.table("app_config").upsert({
            "key": "api_base_url",
            "value": url,
        }).execute()
        return True
    except Exception as e:
        print(f"    [ERROR] Supabase update failed: {e}")
        return False


if __name__ == "__main__":
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("    [ERROR] .env file is missing SUPABASE_URL or SUPABASE_KEY.")
        sys.exit(1)

    print("    Querying ngrok URL...")
    ngrok_url = get_ngrok_url()

    if not ngrok_url:
        print("    [ERROR] Could not retrieve ngrok URL.")
        print("    Please verify that: 1) ngrok is installed  2) ngrok is running (ngrok http 8000)")
        sys.exit(1)

    print(f"    [OK] ngrok URL: {ngrok_url}")

    if update_supabase(ngrok_url):
        print("    [OK] Successfully updated Supabase! Frontend will route requests automatically.")
    else:
        print("    [WARNING] Supabase update failed. Frontend will fallback to localhost:8000")
