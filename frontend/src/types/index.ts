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
