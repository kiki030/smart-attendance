import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { supabase } from '../lib/supabase'
import type {
  AppUser, AttendanceRecord, LeaveRequest, LeaveType, ScheduleEntry, ScheduleSource, ScheduleSyncResult,
} from '../types'
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, WEEKDAY_LABELS, formatPeriod, parsePeriodRange } from '../types'
import { useApiBase } from '../hooks/useApiBase'
import { errorMessage, nextDateForWeekday, weekdayOf } from '../lib/utils'
import ScheduleSyncModal from '../components/ScheduleSyncModal'
import ScheduleGrid from '../components/ScheduleGrid'
import '../App.css'

interface Props { user: AppUser }

interface PieData { name: string; value: number; color: string }

// 課表項目的唯一鍵（下拉選單用）
const slotKey = (e: ScheduleEntry) => `${e.course_name}|${e.day_of_week}|${e.period}`

export default function StudentDashboard({ user }: Props) {
  const navigate = useNavigate()
  const { apiBase, status: backendStatus } = useApiBase()
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [time, setTime] = useState(new Date())

  // ── 課表同步 ───────────────────────────────────────────
  const scheduleUserId = user.studentId || user.email
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncNotice, setSyncNotice] = useState<{ source: ScheduleSource; message: string } | null>(null)

  // ── 請假申請 ───────────────────────────────────────────
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [leaveSlot, setLeaveSlot] = useState('')
  const [leaveDate, setLeaveDate] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('excused_sick')
  const [leaveReason, setLeaveReason] = useState('')
  const [leaveSubmitting, setLeaveSubmitting] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const [leaveSuccess, setLeaveSuccess] = useState('')

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadSchedule = useCallback(async () => {
    if (!scheduleUserId) return
    const { data, error } = await supabase
      .from('user_schedules')
      .select('*')
      .eq('user_id', scheduleUserId)
      .order('day_of_week', { ascending: true })
    if (error) {
      console.error('loadSchedule error:', error)
      return
    }
    const sorted = ((data ?? []) as ScheduleEntry[]).sort(
      (a, b) => a.day_of_week - b.day_of_week || parsePeriodRange(a.period).start - parsePeriodRange(b.period).start
    )
    setSchedule(sorted)
  }, [scheduleUserId])

  const loadLeaves = useCallback(async () => {
    if (!scheduleUserId) return
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('student_id', scheduleUserId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('loadLeaves error:', error)
      return
    }
    setLeaves((data ?? []) as LeaveRequest[])
  }, [scheduleUserId])

  useEffect(() => {
    loadSchedule()
    loadLeaves()
  }, [loadSchedule, loadLeaves])

  function handleSynced(result: ScheduleSyncResult) {
    setSyncNotice({ source: result.source, message: `${result.message}（共 ${result.count} 門課）` })
    loadSchedule()
  }

  function handleSlotChange(key: string) {
    setLeaveSlot(key)
    setLeaveError('')
    setLeaveSuccess('')
    const entry = schedule.find(s => slotKey(s) === key)
    if (entry) setLeaveDate(nextDateForWeekday(entry.day_of_week)) // 自動帶入下一次上課日
  }

  async function submitLeave(e: React.FormEvent) {
    e.preventDefault()
    setLeaveError('')
    setLeaveSuccess('')

    const entry = schedule.find(s => slotKey(s) === leaveSlot)
    if (!entry) return setLeaveError('請選擇要請假的課程與節次')
    if (!leaveDate) return setLeaveError('請選擇請假日期')
    const dow = weekdayOf(leaveDate)
    if (dow !== entry.day_of_week) {
      return setLeaveError(
        `所選日期為${WEEKDAY_LABELS[dow]}，與「${entry.course_name}」的上課日（${WEEKDAY_LABELS[entry.day_of_week]}）不符`
      )
    }
    if (!leaveReason.trim()) return setLeaveError('請填寫請假事由')

    setLeaveSubmitting(true)
    try {
      // 防止同一課程同一天重複申請（已駁回者可重新申請）
      const { data: dup, error: dupError } = await supabase
        .from('leave_requests')
        .select('id')
        .eq('student_id', scheduleUserId)
        .eq('course_name', entry.course_name)
        .eq('leave_date', leaveDate)
        .in('status', ['pending', 'approved'])
        .limit(1)
      if (dupError) throw dupError
      if (dup && dup.length > 0) {
        setLeaveError('此課程在該日期已有待審核或已核准的請假申請')
        return
      }

      const cleanStudentName = user.studentId
        ? (user.name.replace(user.studentId, '').trim() || user.name)
        : user.name

      const { error } = await supabase.from('leave_requests').insert({
        student_id: scheduleUserId,
        student_name: cleanStudentName,
        course_name: entry.course_name,
        leave_date: leaveDate,
        period: entry.period,
        leave_type: leaveType,
        reason: leaveReason.trim(),
        status: 'pending',
      })
      if (error) throw error

      setLeaveSuccess('✅ 請假申請已送出，等待教師審核')
      setLeaveReason('')
      await loadLeaves()
    } catch (err) {
      setLeaveError(`送出失敗：${errorMessage(err)}`)
    } finally {
      setLeaveSubmitting(false)
    }
  }

  useEffect(() => {
    if (user.studentId) loadAttendance()
    else {
      // 無學號：直接顯示空狀態，不填入假資料
      setLoading(false)
    }
  }, [user.studentId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAttendance() {
    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('student_id', user.studentId)
        .order('date', { ascending: false })

      if (error) throw error
      // 空陣列也直接設定，不替換為假資料
      setRecords((data ?? []) as AttendanceRecord[])
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const todayRecord = records.find(r => r.date === today)
  const todayStatus = todayRecord?.status || 'absent'

  // Pie chart data（僅保留出席/遲到/缺席）
  const present = records.filter(r => r.status === 'present').length
  const late = records.filter(r => r.status === 'late').length
  const absent = records.filter(r => r.status === 'absent').length

  const pieData: PieData[] = [
    { name: '正常出席', value: present, color: '#4ade80' },
    { name: '遲到', value: late, color: '#fbbf24' },
    { name: '缺席', value: absent, color: '#f87171' },
  ].filter(d => d.value > 0)

  async function handleLogout() {
    localStorage.removeItem('smart_attendance_demo_session')
    await supabase.auth.signOut().catch(() => {})
    window.location.reload()
  }

  const statusConfig = {
    present: { label: '已出席', color: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '✅' },
    late: { label: '遲到', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '🟡' },
    absent: { label: '缺席', color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: '❌' },
    excused_sick: { label: '病假', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', icon: '💊' },
    excused_personal: { label: '事假', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '📋' },
  }
  const todayConfig = statusConfig[todayStatus as keyof typeof statusConfig] || statusConfig.absent

  return (
    <div className="dashboard-root">
      <div className="bg-orb orb1" style={{ opacity: 0.07 }} />
      <div className="bg-orb orb3" style={{ opacity: 0.05 }} />

      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-left">
          <div className="nav-logo">🎓 <span className="nav-logo-text">南台科技大學智慧點名</span></div>
        </div>
        <div className="nav-right">
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="avatar" className="nav-avatar" />
            : <div className="nav-avatar-placeholder">🎒</div>
          }
          <div className="nav-userinfo">
            <span className="nav-username">{user.name}</span>
            <span className="nav-role-badge student-badge">學生</span>
          </div>
          <button className="sync-schedule-btn" onClick={() => setSyncOpen(true)}>
            🔄 同步南台校務課表
          </button>
          <button className="register-nav-btn" onClick={() => navigate('/register')}>📷 人臉註冊</button>
          <button className="logout-btn" onClick={handleLogout}>登出</button>
        </div>
      </nav>

      <div className="dashboard-content">
        <div className="page-header">
          <h1 className="page-title">學生即時看板</h1>
          <div className="page-date-row">
            <p className="page-date">
              {time.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
            <span className="page-time-inline">{time.toLocaleTimeString('zh-TW', { hour12: false })}</span>
          </div>
        </div>

        {/* 今日出勤狀態卡片 */}
        <div className="today-section">
          <h2 className="section-title-lg">今日出勤狀態</h2>
          <div className="today-cards">
            <div
              className="today-main-card"
              style={{ borderColor: todayConfig.color, background: todayConfig.bg }}
            >
              <div className="today-icon">{todayConfig.icon}</div>
              <div className="today-status-text" style={{ color: todayConfig.color }}>
                {todayConfig.label}
              </div>
              <div className="today-course">{todayRecord?.course_name || '人工智慧概論'}</div>
              {todayRecord?.check_in_time && (
                <div className="today-time">
                  簽到時間：{new Date(todayRecord.check_in_time).toLocaleTimeString('zh-TW')}
                </div>
              )}
            </div>

            <div className="today-stats-mini">
              <div className="mini-stat" style={{ borderColor: '#4ade80' }}>
                <span className="mini-num" style={{ color: '#4ade80' }}>{present}</span>
                <span className="mini-label">出席</span>
              </div>
              <div className="mini-stat" style={{ borderColor: '#fbbf24' }}>
                <span className="mini-num" style={{ color: '#fbbf24' }}>{late}</span>
                <span className="mini-label">遲到</span>
              </div>
              <div className="mini-stat" style={{ borderColor: '#f87171' }}>
                <span className="mini-num" style={{ color: '#f87171' }}>{absent}</span>
                <span className="mini-label">缺席</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 📅 我的本學期課表 ── */}
        <div className="table-section">
          <div className="section-header-row">
            <div>
              <h2 className="section-title-lg" style={{ margin: 0 }}>📅 我的本學期課表</h2>
              <p className="table-hint" style={{ margin: '0.3rem 0 0' }}>
                同步南台校務系統課表後，即可直接依課程節次線上申請請假
              </p>
            </div>
            <button className="sync-schedule-btn" onClick={() => setSyncOpen(true)}>
              🔄 同步南台校務課表
            </button>
          </div>

          {syncNotice && (
            <div className="sync-notice-banner">
              <span>{syncNotice.source === 'stust' ? '🏫' : '✨'}</span>
              <span>{syncNotice.message}</span>
            </div>
          )}

          {schedule.length === 0 ? (
            <div className="empty-state-box">
              <div style={{ fontSize: '2.2rem' }}>🗓️</div>
              <div style={{ fontSize: '0.98rem', fontWeight: 600, color: '#94a3b8' }}>尚未同步本學期課表</div>
              <div style={{ fontSize: '0.82rem', color: '#64748b', textAlign: 'center' }}>
                點擊右上角「🔄 同步南台校務課表」輸入校務帳密（展示環境密碼可輸入 <code>demo</code>）一鍵匯入課表。
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <ScheduleGrid entries={schedule} />
            </div>
          )}
        </div>

        {/* ── 📝 線上請假申請 & 請假申請進度 ── */}
        <div className="table-section">
          <h2 className="section-title-lg">📝 線上請假申請</h2>
          <p className="table-hint">從已同步的課表選擇課程與節次，填寫日期與事由送交授課教師審核</p>

          <form onSubmit={submitLeave} className="leave-form-grid">
            <div className="form-field">
              <label className="form-label" htmlFor="leave-slot">選擇課程與節次</label>
              <select
                id="leave-slot"
                className="form-input"
                value={leaveSlot}
                onChange={e => handleSlotChange(e.target.value)}
                disabled={schedule.length === 0}
              >
                <option value="">
                  {schedule.length === 0 ? '請先同步課表後再選擇課程' : '— 請選擇課程與節次 —'}
                </option>
                {schedule.map(s => (
                  <option key={slotKey(s)} value={slotKey(s)}>
                    {s.course_name}（{WEEKDAY_LABELS[s.day_of_week]} {formatPeriod(s.period)}{s.room ? ` · ${s.room}` : ''}）
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="leave-date">請假日期</label>
              <input
                id="leave-date"
                type="date"
                className="form-input"
                value={leaveDate}
                onChange={e => setLeaveDate(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="leave-type">假別</label>
              <select
                id="leave-type"
                className="form-input"
                value={leaveType}
                onChange={e => setLeaveType(e.target.value as LeaveType)}
              >
                <option value="excused_sick">{LEAVE_TYPE_LABELS.excused_sick}</option>
                <option value="excused_personal">{LEAVE_TYPE_LABELS.excused_personal}</option>
              </select>
            </div>

            <div className="form-field leave-reason-field">
              <label className="form-label" htmlFor="leave-reason">請假事由</label>
              <input
                id="leave-reason"
                type="text"
                className="form-input"
                placeholder="請簡述請假原因（如：發燒就醫、家中有事需處理）"
                value={leaveReason}
                onChange={e => setLeaveReason(e.target.value)}
              />
            </div>

            <div className="leave-submit-wrap">
              <button
                type="submit"
                className="primary-btn"
                disabled={leaveSubmitting || schedule.length === 0}
              >
                {leaveSubmitting ? '⏳ 送出中...' : '📤 送出請假申請'}
              </button>
            </div>
          </form>

          {leaveError && <div className="form-error" style={{ marginTop: '0.85rem' }}>{leaveError}</div>}
          {leaveSuccess && <div className="form-success" style={{ marginTop: '0.85rem' }}>{leaveSuccess}</div>}

          {/* 請假申請進度列表 */}
          <div style={{ marginTop: '1.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#cbd5e1' }}>
                📌 請假申請進度列表
              </h3>
              <button
                type="button"
                className="save-row-btn"
                onClick={loadLeaves}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
              >
                ↻ 重新整理
              </button>
            </div>

            {leaves.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid var(--border)' }}>
                目前尚無請假申請紀錄
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="att-table">
                  <thead>
                    <tr>
                      <th>請假日期</th>
                      <th>課程</th>
                      <th>節次</th>
                      <th>假別</th>
                      <th>請假事由</th>
                      <th>審核狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map(lv => (
                      <tr key={lv.id}>
                        <td className="td-id">{lv.leave_date}</td>
                        <td className="td-name">{lv.course_name}</td>
                        <td style={{ color: '#94a3b8' }}>{formatPeriod(lv.period)}</td>
                        <td>
                          <span className={`status-chip chip-${lv.leave_type}`}>
                            {LEAVE_TYPE_LABELS[lv.leave_type] ?? lv.leave_type}
                          </span>
                        </td>
                        <td className="td-note">{lv.reason}</td>
                        <td>
                          <span className={`status-chip leave-status-${lv.status}`}>
                            {LEAVE_STATUS_LABELS[lv.status] ?? lv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 圓餅圖 */}
        <div className="chart-section">
          <h2 className="section-title-lg">本學期出勤統計</h2>
          {loading ? (
            <div className="chart-loading"><div className="spinner" /></div>
          ) : (
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={120}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }: PieLabelRenderProps) => `${name ?? ''} ${(((percent as number) ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`${value} 堂`, '']}
                    contentStyle={{
                      background: 'rgba(5,10,20,0.9)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      color: '#e2e8f0',
                    }}
                  />
                  <Legend
                    formatter={(value) => <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-total">共 {records.length} 堂課程記錄</div>
            </div>
          )}
        </div>

        {/* 歷史紀錄 */}
        <div className="table-section">
          <h2 className="section-title-lg">歷史出勤紀錄</h2>
          {!loading && records.length === 0 ? (
            /* 空狀態提示 */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3rem 1rem',
              color: '#475569',
              gap: '0.6rem',
            }}>
              <div style={{ fontSize: '2.5rem' }}>📋</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#64748b' }}>目前尚無出勤紀錄</div>
              <div style={{ fontSize: '0.82rem', color: '#475569', textAlign: 'center' }}>
                完成人臉註冊後，待教師進行 AI 點名，紀錄將自動出現在此。
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="att-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>課程</th>
                    <th>狀態</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 10).map(rec => (
                    <tr key={rec.id}>
                      <td>{rec.date}</td>
                      <td>{rec.course_name || '人工智慧概論'}</td>
                      <td>
                        <span className={`status-chip chip-${rec.status}`}>
                          {rec.status === 'present' && '✅ 出席'}
                          {rec.status === 'late' && '🟡 遲到'}
                          {rec.status === 'absent' && '❌ 缺席'}
                          {rec.status === 'excused_sick' && '💊 病假'}
                          {rec.status === 'excused_personal' && '📋 事假'}
                        </span>
                      </td>
                      <td className="td-note">{rec.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── 南台校務課表同步 Modal ── */}
      {syncOpen && (
        <ScheduleSyncModal
          role="student"
          userId={scheduleUserId}
          defaultAccount={user.studentId || ''}
          apiBase={apiBase}
          backendStatus={backendStatus}
          onClose={() => setSyncOpen(false)}
          onSynced={handleSynced}
        />
      )}
    </div>
  )
}
