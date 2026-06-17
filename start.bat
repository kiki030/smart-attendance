@echo off
chcp 65001 > nul
title 南台科技大學智慧點名系統 - 一鍵啟動

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║    南台科技大學  校園智慧點名系統 v2.0           ║
echo  ║    一鍵啟動腳本                                  ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── 步驟 1：啟動後端 AI 伺服器 ──────────────────────────────
echo [1/3] 正在啟動後端 AI 伺服器 (FastAPI + InsightFace)...
echo       請稍候，模型載入約需 10-20 秒...
start "Smart-Attendance-Backend" cmd /k "title 後端伺服器 && python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
timeout /t 12 /nobreak > nul
echo       [OK] 後端伺服器已啟動 ^(http://127.0.0.1:8000^)
echo.

:: ── 步驟 2：啟動 ngrok 穿透 ─────────────────────────────────
echo [2/3] 正在啟動 ngrok 內網穿透...
echo       確認已安裝 ngrok：https://ngrok.com/download
start "Smart-Attendance-ngrok" cmd /k "title ngrok 穿透 && ngrok http 8000"
echo       等待 ngrok 建立通道...
timeout /t 6 /nobreak > nul
echo       [OK] ngrok 已啟動
echo.

:: ── 步驟 3：自動更新 Supabase 設定 ──────────────────────────
echo [3/3] 讀取 ngrok 公開網址並寫入雲端設定...
python update_ngrok_url.py
echo.

echo  ╔══════════════════════════════════════════════════╗
echo  ║  ✅ 系統啟動完成！                              ║
echo  ║                                                  ║
echo  ║  前端網址：                                      ║
echo  ║  https://kiki030.github.io/smart-attendance/     ║
echo  ║                                                  ║
echo  ║  本機 API 文件：                                 ║
echo  ║  http://127.0.0.1:8000/docs                      ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  按任意鍵關閉此視窗（後端與 ngrok 繼續在背景執行）
pause > nul
