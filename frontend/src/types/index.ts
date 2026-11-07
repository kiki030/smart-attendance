export type UserRoleType = 'teacher' | 'student'

export interface AppUser {
  email: string
  name: string
  role: UserRoleType
  studentId?: string
  avatarUrl?: string
}

export interface UserRoleRow {
  id: string
  email: string
  role: UserRoleType
  student_id?: string
  display_name?: string
  created_at: string
}

export interface AttendanceRecord {
  id: string
  student_id: string
  student_name?: string
  course_name?: string
  date: string
  check_in_time?: string
  status: 'present' | 'late' | 'absent' | 'excused_sick' | 'excused_personal'
  note?: string
}

export const STATUS_LABELS: Record<AttendanceRecord['status'], string> = {
  present: '✅ 出席',
  late: '🟡 遲到',
  absent: '❌ 缺席',
  excused_sick: '💊 病假',
  excused_personal: '📋 事假',
}

// ── 課表同步 ────────────────────────────────────────────────
export type ScheduleSource = 'stust' | 'demo'

export interface ScheduleEntry {
  id?: string
  user_id?: string
  role?: UserRoleType
  course_id?: string | null
  course_name: string
  day_of_week: number      // 1 = 週一 … 5 = 週五
  period: string           // 例如 '2-4' 或 '3'
  room?: string | null
  updated_at?: string
}

export interface ScheduleSyncResult {
  status: string
  source: ScheduleSource
  message: string
  count: number
  schedule: ScheduleEntry[]
}

// ── 請假申請 ────────────────────────────────────────────────
export type LeaveType = 'excused_sick' | 'excused_personal'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  id: string
  student_id: string
  student_name?: string | null
  course_name: string
  leave_date: string
  period?: string | null
  leave_type: LeaveType
  reason: string
  status: LeaveStatus
  reviewed_at?: string | null
  created_at?: string
}

export const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  excused_sick: '💊 病假',
  excused_personal: '📋 事假',
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: '⏳ 待審核',
  approved: '✅ 已核准',
  rejected: '❌ 已駁回',
}

/** 解析節次字串（如 '2-4'、'3'、'第 2-4 節'）為起訖數字 */
export function parsePeriodRange(period?: string | null): { start: number; end: number } {
  if (!period) return { start: 1, end: 1 }
  const nums = (period.match(/\d+/g) || []).map(Number)
  if (nums.length === 0) return { start: 1, end: 1 }
  return { start: Math.min(...nums), end: Math.max(...nums) }
}

/** 格式化節次顯示（如 '2-4' -> '第 2-4 節'） */
export function formatPeriod(period?: string | null): string {
  if (!period) return '—'
  if (period.includes('節')) return period
  const { start, end } = parsePeriodRange(period)
  return start === end ? `第 ${start} 節` : `第 ${start}-${end} 節`
}
