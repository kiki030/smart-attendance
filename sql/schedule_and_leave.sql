-- ════════════════════════════════════════════════════════════
--  校園智慧點名系統 — 課表同步與請假審核資料表（v0.5.0）
--  請在 Supabase Dashboard → SQL Editor 貼上並執行
-- ════════════════════════════════════════════════════════════

-- 1. 使用者課表（由後端 /api/sync-schedule 寫入；同步時會先刪除該 user_id 舊資料）
--    注意：本表不儲存任何校務系統密碼
CREATE TABLE IF NOT EXISTS user_schedules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,                -- 學生：學號；教師：email
  role         TEXT        NOT NULL CHECK (role IN ('teacher', 'student')),
  course_id    TEXT,
  course_name  TEXT        NOT NULL,
  day_of_week  INTEGER     NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- 1 = 週一
  period       TEXT        NOT NULL,                -- 例如 '2-4' 或 '3'
  room         TEXT,                                -- 教室（如 'E301'）
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sched_user ON user_schedules(user_id);

ALTER TABLE user_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_schedules" ON user_schedules;
CREATE POLICY "allow_all_user_schedules"
  ON user_schedules FOR ALL USING (true) WITH CHECK (true);


-- 2. 請假申請（學生送出 → 教師核准 / 駁回）
CREATE TABLE IF NOT EXISTS leave_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   TEXT        NOT NULL,
  student_name TEXT,
  course_name  TEXT        NOT NULL,
  leave_date   DATE        NOT NULL,
  period       TEXT,                                -- 例如 '2-4'
  leave_type   TEXT        NOT NULL CHECK (leave_type IN ('excused_sick', 'excused_personal')),
  reason       TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leave_student ON leave_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_leave_course  ON leave_requests(course_name, status);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_leave_requests" ON leave_requests;
CREATE POLICY "allow_all_leave_requests"
  ON leave_requests FOR ALL USING (true) WITH CHECK (true);
