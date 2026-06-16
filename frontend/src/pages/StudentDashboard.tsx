import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { supabase } from '../lib/supabase'
import type { AppUser, AttendanceRecord } from '../types'
import '../App.css'

interface Props { user: AppUser }

interface PieData { name: string; value: number; color: string }

export default function StudentDashboard({ user }: Props) {
  const navigate = useNavigate()
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (user.studentId) loadAttendance()
    else {
      // Fallback mock data
      setRecords(getMockRecords())
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

      if (error || !data || data.length === 0) {
        setRecords(getMockRecords())
      } else {
        setRecords(data as AttendanceRecord[])
      }
    } catch {
      setRecords(getMockRecords())
    } finally {
      setLoading(false)
    }
  }

  function getMockRecords(): AttendanceRecord[] {
    const today = new Date().toISOString().slice(0, 10)
    return [
      { id: '1', student_id: user.studentId || '', date: today, status: 'present', course_name: '人工智慧概論' },
      { id: '2', student_id: user.studentId || '', date: '2026-06-10', status: 'late', course_name: '人工智慧概論' },
      { id: '3', student_id: user.studentId || '', date: '2026-06-03', status: 'absent', course_name: '人工智慧概論' },
      { id: '4', student_id: user.studentId || '', date: '2026-05-27', status: 'present', course_name: '人工智慧概論' },
      { id: '5', student_id: user.studentId || '', date: '2026-05-20', status: 'present', course_name: '人工智慧概論' },
      { id: '6', student_id: user.studentId || '', date: '2026-05-13', status: 'excused_sick', course_name: '人工智慧概論' },
      { id: '7', student_id: user.studentId || '', date: '2026-05-06', status: 'present', course_name: '人工智慧概論' },
    ]
  }

  const today = new Date().toISOString().slice(0, 10)
  const todayRecord = records.find(r => r.date === today)
  const todayStatus = todayRecord?.status || 'absent'

  // Pie chart data
  const present = records.filter(r => r.status === 'present').length
  const late = records.filter(r => r.status === 'late').length
  const absent = records.filter(r => r.status === 'absent').length
  const sick = records.filter(r => r.status === 'excused_sick').length
  const personal = records.filter(r => r.status === 'excused_personal').length

  const pieData: PieData[] = [
    { name: '正常出席', value: present, color: '#4ade80' },
    { name: '遲到', value: late, color: '#fbbf24' },
    { name: '缺席', value: absent, color: '#f87171' },
    { name: '病假', value: sick, color: '#60a5fa' },
    { name: '事假', value: personal, color: '#a78bfa' },
  ].filter(d => d.value > 0)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
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
          <div className="nav-clock">{time.toLocaleTimeString('zh-TW', { hour12: false })}</div>
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
          <button className="register-nav-btn" onClick={() => navigate('/register')}>📷 人臉註冊</button>
          <button className="logout-btn" onClick={handleLogout}>登出</button>
        </div>
      </nav>

      <div className="dashboard-content">
        <div className="page-header">
          <h1 className="page-title">學生即時看板</h1>
          <p className="page-date">
            {time.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
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
              <div className="mini-stat" style={{ borderColor: '#60a5fa' }}>
                <span className="mini-num" style={{ color: '#60a5fa' }}>{sick + personal}</span>
                <span className="mini-label">請假</span>
              </div>
            </div>
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
        </div>
      </div>
    </div>
  )
}
