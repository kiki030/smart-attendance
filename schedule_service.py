"""
schedule_service.py — 課表展示備援服務

真實課表由 main.py 的 fetch_stust_schedule_sync()（Playwright 爬取南台 ePortal）取得；
本模組只負責「展示模式」：依帳號產生固定且具真實感的示範課表（密碼輸入 demo 時使用）。
"""
from __future__ import annotations

import hashlib
import random
from typing import List


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
