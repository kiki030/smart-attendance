"""
start_server.py
-----------------
One-click launcher for Smart Attendance System.
Starts uvicorn backend and opens a ngrok tunnel automatically.

Usage: python start_server.py
"""

import os
import sys
import time
import subprocess
import threading

# ─────────────────────────────────────────────────────────
# CONFIGURATION: Paste your ngrok authtoken here after getting
# it from https://dashboard.ngrok.com/get-started/your-authtoken
# ─────────────────────────────────────────────────────────
NGROK_AUTHTOKEN = ""   # <-- PASTE YOUR TOKEN HERE

# ─────────────────────────────────────────────────────────

try:
    from pyngrok import ngrok, conf
    from supabase import create_client
    from dotenv import load_dotenv
    import requests as req_lib
except ImportError as e:
    print(f"[ERROR] Missing dependency: {e}")
    print("[ERROR] Please run: python -m pip install pyngrok supabase python-dotenv requests")
    sys.exit(1)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
PORT = 8000


def banner(msg: str):
    print("\n" + "=" * 55)
    print(f"  {msg}")
    print("=" * 55)


def start_uvicorn():
    """Start the FastAPI backend in a subprocess."""
    print("[1/3] Starting FastAPI backend server ...")
    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--reload",
           "--host", "127.0.0.1", "--port", str(PORT)]
    # Run in new window on Windows
    if os.name == "nt":
        subprocess.Popen(
            cmd,
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    else:
        subprocess.Popen(cmd)

    print(f"      Backend launching on http://127.0.0.1:{PORT}")
    print("      Waiting 15s for AI models to load ...")
    time.sleep(15)
    print("      [OK] Backend ready.")


def start_ngrok() -> str | None:
    """Start ngrok tunnel and return the public HTTPS URL."""
    print("[2/3] Starting ngrok tunnel ...")

    if not NGROK_AUTHTOKEN:
        print()
        print("  *** NGROK AUTHTOKEN IS MISSING ***")
        print("  Please do the following:")
        print("  1. Go to https://dashboard.ngrok.com/signup and sign up for FREE")
        print("  2. Go to https://dashboard.ngrok.com/get-started/your-authtoken")
        print("  3. Copy your authtoken")
        print("  4. Open start_server.py in a text editor")
        print("  5. Paste the token at the top of the file: NGROK_AUTHTOKEN = \"your-token-here\"")
        print("  6. Save and run again.")
        print()
        return None

    # Set the authtoken
    conf.get_default().auth_token = NGROK_AUTHTOKEN

    try:
        tunnel = ngrok.connect(PORT, proto="http")
        public_url = tunnel.public_url
        if public_url.startswith("http://"):
            public_url = public_url.replace("http://", "https://", 1)
        print(f"      [OK] ngrok tunnel URL: {public_url}")
        return public_url
    except Exception as e:
        print(f"      [ERROR] ngrok failed: {e}")
        return None


def update_supabase(url: str) -> bool:
    """Write the ngrok URL to Supabase app_config."""
    print("[3/3] Updating Supabase with ngrok URL ...")
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("      [ERROR] .env missing SUPABASE_URL or SUPABASE_KEY")
        return False
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        sb.table("app_config").upsert({
            "key": "api_base_url",
            "value": url,
        }).execute()
        print("      [OK] Supabase updated! Frontend will auto-detect the backend URL.")
        return True
    except Exception as e:
        print(f"      [ERROR] Supabase update failed: {e}")
        return False


if __name__ == "__main__":
    banner("STUST Smart Attendance System  -  One-Click Start")

    # Step 1: Start uvicorn
    start_uvicorn()

    # Step 2: Start ngrok
    public_url = start_ngrok()

    if public_url:
        # Step 3: Write to Supabase
        update_supabase(public_url)

        banner("System Startup Completed!")
        print("  Frontend URL:")
        print("  https://kiki030.github.io/smart-attendance/")
        print()
        print("  Local API Docs:")
        print(f"  http://127.0.0.1:{PORT}/docs")
        print()
        print("  ngrok Public URL:")
        print(f"  {public_url}")
    else:
        banner("Startup Incomplete - ngrok token missing")
        print("  The backend is running locally.")
        print("  The frontend cannot reach it from the cloud without ngrok.")
        print("  Please add your NGROK_AUTHTOKEN to start_server.py and rerun.")

    print()
    input("Press ENTER to close this window (backend and ngrok continue in background) ...")
