"""
schedule_service.py — 南台校務課表同步服務

提供兩種取得課表的方式：
  1. fetch_stust_schedule()   ：以 requests.Session + BeautifulSoup 登入校務系統並解析課表（真實模式）
  2. generate_demo_schedule() ：依學號 / 教師帳號產生固定且具真實感的示範課表（展示備援模式）

安全性原則：
  - 密碼只在函式呼叫期間存在於記憶體，不寫入資料庫、不寫入 log、不放進任何例外訊息。
  - 所有對外拋出的 ScheduleFetchError 訊息皆為固定中文說明，不含使用者輸入。
"""
from __future__ import annotations

import hashlib
import os
import random
import re
from typing import Dict, List, Optional, Tuple

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore

try:
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover
    BeautifulSoup = None  # type: ignore


REQUEST_TIMEOUT = 8  # 秒

# 被視為「測試帳密」的密碼：直接使用示範課表，不嘗試連線校務系統
DEMO_PASSWORDS = {"demo", "test", "testing", "1234", "0000", "123456"}


class ScheduleFetchError(Exception):
    """無法從校務系統取得課表（訊息為固定說明文字，不含帳密）。"""


def is_demo_password(password: str) -> bool:
    return password.strip().lower() in DEMO_PASSWORDS


# ════════════════════════════════════════════════════════════
#  真實模式：南台校務系統課表抓取（預留結構）
# ════════════════════════════════════════════════════════════
#
#  校務系統的實際網址與表單欄位名稱需依學校系統調整，透過 .env 設定：
#    STUST_LOGIN_URL       登入頁網址（GET 取得隱藏欄位，POST 送出帳密）
#    STUST_SCHEDULE_URL    登入後的個人課表頁網址
#    STUST_ACCOUNT_FIELD   帳號欄位 name（預設 account）
#    STUST_PASSWORD_FIELD  密碼欄位 name（預設 password）
#
#  若未設定、需要驗證碼、連線失敗或解析不到課表，皆拋出 ScheduleFetchError，
#  由呼叫端改用示範課表。本模組不會嘗試繞過驗證碼。

def _has_captcha(soup) -> bool:
    for inp in soup.find_all("input"):
        name = (inp.get("name") or "") + " " + (inp.get("id") or "")
        if re.search(r"captcha|checkcode|validatecode|verifycode|驗證碼", name, re.I):
            return True
    for img in soup.find_all("img"):
        src = (img.get("src") or "") + " " + (img.get("alt") or "")
        if re.search(r"captcha|checkcode|validatecode|驗證碼", src, re.I):
            return True
    return False


def fetch_stust_schedule(account: str, password: str) -> List[dict]:
    """登入南台校務系統並抓取個人課表。失敗時拋出 ScheduleFetchError。"""
    login_url = os.getenv("STUST_LOGIN_URL", "").strip()
    schedule_url = os.getenv("STUST_SCHEDULE_URL", "").strip()
    if not login_url or not schedule_url:
        raise ScheduleFetchError("尚未設定南台校務系統連線端點")
    if requests is None or BeautifulSoup is None:
        raise ScheduleFetchError("伺服器未安裝 requests / beautifulsoup4")

    account_field = os.getenv("STUST_ACCOUNT_FIELD", "account")
    password_field = os.getenv("STUST_PASSWORD_FIELD", "password")

    with requests.Session() as session:
        session.headers.update({"User-Agent": "Mozilla/5.0 (SmartAttendance schedule sync)"})

        try:
            login_page = session.get(login_url, timeout=REQUEST_TIMEOUT)
            login_page.raise_for_status()
        except requests.RequestException:
            raise ScheduleFetchError("無法連線至南台校務系統") from None

        soup = BeautifulSoup(login_page.text, "html.parser")
        if _has_captcha(soup):
            raise ScheduleFetchError("校務系統登入需要驗證碼，無法自動登入")

        # 帶上登入頁的隱藏欄位（例如 ASP.NET 的 __VIEWSTATE）
        form: Dict[str, str] = {}
        for inp in soup.find_all("input", {"type": "hidden"}):
            if inp.get("name"):
                form[inp["name"]] = inp.get("value", "")
        form[account_field] = account
        form[password_field] = password

        try:
            resp = session.post(login_url, data=form, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            resp.raise_for_status()
            schedule_page = session.get(schedule_url, timeout=REQUEST_TIMEOUT)
            schedule_page.raise_for_status()
        except requests.RequestException:
            raise ScheduleFetchError("登入或讀取校務系統課表頁面失敗") from None
        finally:
            form.clear()  # 立即清除含密碼的表單資料

        return parse_schedule_html(schedule_page.text)


_DAY_PATTERN = re.compile(r"(?:星期|週|周)\s*([一二三四五])|\b(mon|tue|wed|thu|fri)", re.I)
_DAY_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
            "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5}


def parse_schedule_html(html: str) -> List[dict]:
    """
    從課表頁 HTML 中找出「列 = 節次、欄 = 星期」的表格並轉為課表陣列。
    連續節次且課名相同者合併為同一筆（例如第 2、3、4 節 → period 2-4）。
    註：未處理 rowspan 合併儲存格，若學校頁面使用 rowspan 需另行調整。
    """
    if BeautifulSoup is None:
        raise ScheduleFetchError("伺服器未安裝 beautifulsoup4")

    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        header_cells = rows[0].find_all(["th", "td"])
        day_cols: Dict[int, int] = {}
        for idx, cell in enumerate(header_cells):
            m = _DAY_PATTERN.search(cell.get_text(" ", strip=True))
            if m:
                token = (m.group(1) or m.group(2) or "").lower()
                if token in _DAY_MAP:
                    day_cols[idx] = _DAY_MAP[token]
        if len(day_cols) < 3:
            continue

        grid: Dict[Tuple[int, int], Tuple[str, str]] = {}
        for row in rows[1:]:
            cells = row.find_all(["th", "td"])
            if not cells:
                continue
            m = re.search(r"(\d+)", cells[0].get_text(" ", strip=True))
            if not m:
                continue
            period = int(m.group(1))
            for idx, dow in day_cols.items():
                if idx >= len(cells):
                    continue
                lines = list(cells[idx].stripped_strings)
                if lines:
                    grid[(dow, period)] = (lines[0], lines[1] if len(lines) > 1 else "")

        entries = _merge_grid(grid)
        if entries:
            return entries

    raise ScheduleFetchError("無法從校務系統頁面解析出課表")


def _merge_grid(grid: Dict[Tuple[int, int], Tuple[str, str]]) -> List[dict]:
    entries: List[dict] = []
    for dow in range(1, 6):
        periods = sorted(p for (d, p) in grid if d == dow)
        current: Optional[dict] = None
        for p in periods:
            name, room = grid[(dow, p)]
            if current and current["course_name"] == name and p == current["period_end"] + 1:
                current["period_end"] = p
                continue
            if current:
                entries.append(current)
            current = {
                "course_id": None,
                "course_name": name,
                "day_of_week": dow,
                "period_start": p,
                "period_end": p,
                "period": str(p),
                "room": room or None,
            }
        if current:
            current["period"] = (
                str(current["period_start"])
                if current["period_start"] == current["period_end"]
                else f"{current['period_start']}-{current['period_end']}"
            )
            entries.append(current)
    for item in entries:
        item["period"] = (
            str(item["period_start"])
            if item["period_start"] == item["period_end"]
            else f"{item['period_start']}-{item['period_end']}"
        )
    return entries


# ════════════════════════════════════════════════════════════
#  展示備援模式：依帳號產生固定的示範課表
# ════════════════════════════════════════════════════════════

# (課程代碼, 課程名稱, 連續節數)
_CORE_COURSES = [
    ("CSIE301", "人工智慧概論", 3),
    ("CSIE401", "專題討論", 2),
    ("CSIE201", "資料結構", 3),
    ("CSIE302", "電腦網路", 3),
    ("CSIE405", "深度學習", 3),
]
_ELECTIVE_COURSES = [
    ("CSIE303", "演算法", 3),
    ("CSIE204", "資料庫系統", 3),
    ("CSIE205", "作業系統", 3),
]
_CLASSROOMS = ["E301", "E302", "E405", "E506", "E601 電腦教室", "N101", "S204", "T0502"]

# 上午可用節次範圍 1–4、下午 5–8
_HALF_RANGES = {"am": (1, 4), "pm": (5, 8)}


def generate_demo_schedule(account: str, role: str) -> List[dict]:
    """
    依帳號產生南台科大資工系示範課表。同一帳號每次產生的結果都相同（以 SHA-256 作為亂數種子）。
      - 學生：5 門資工核心課程 + 1 門選修
      - 教師：人工智慧概論 + 另外 2 門授課
    每個「星期 × 上午/下午」最多排一門課，保證不衝堂。
    """
    seed = int(hashlib.sha256(f"{role}:{account}".encode("utf-8")).hexdigest(), 16)
    rng = random.Random(seed)

    if role == "teacher":
        others = rng.sample(_CORE_COURSES[1:], 2)
        courses = [_CORE_COURSES[0]] + others
    else:
        courses = list(_CORE_COURSES) + [rng.choice(_ELECTIVE_COURSES)]

    slots = [(dow, half) for dow in range(1, 6) for half in ("am", "pm")]
    rng.shuffle(slots)

    entries: List[dict] = []
    for (course_id, name, length), (dow, half) in zip(courses, slots):
        lo, hi = _HALF_RANGES[half]
        start = rng.randint(lo, hi - length + 1)
        end = start + length - 1
        period_str = str(start) if start == end else f"{start}-{end}"
        entries.append({
            "course_id": course_id,
            "course_name": name,
            "day_of_week": dow,
            "period_start": start,
            "period_end": end,
            "period": period_str,
            "room": rng.choice(_CLASSROOMS),
        })

    entries.sort(key=lambda e: (e["day_of_week"], e["period_start"]))
    return entries
