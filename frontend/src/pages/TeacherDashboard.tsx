import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { AppUser, AttendanceRecord } from '../types'
import { STATUS_LABELS } from '../types'
import { useApiBase } from '../hooks/useApiBase'
import '../App.css'

interface Props { user: AppUser }

const MOCK_RECORDS: AttendanceRecord[] = [
  { id: '1', student_id: '4B2G0001', student_name: '王小明', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'present' },
  { id: '2', student_id: '4B2G0002', student_name: '李小花', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'late' },
  { id: '3', student_id: '4B2G0003', student_name: '張大雄', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'absent' },
  { id: '4', student_id: '4B2G0004', student_name: '陳美玲', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'present' },
  { id: '5', student_id: '4B2G0005', student_name: '林志偉', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'excused_sick' },
]

export default function TeacherDashboard({ user }: Props) {
  const navigate = useNavigate()
  const { apiBase, status: backendStatus } = useApiBase()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [rollCallActive, setRollCallActive] = useState(false)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [savedRows, setSavedRows] = useState<Set<string>>(new Set())
  const [time, setTime] = useState(new Date())
  const [camError, setCamError] = useState('')

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [stream])

  // ── 讀取學生名冊與今日出勤紀錄 ────────────────────────────
  const loadRosterAndAttendance = useCallback(async () => {
    try {
      // 1. 從 student_faces 讀取所有註冊學生的學號與姓名
      const { data: students, error: studentError } = await supabase
        .from('student_faces')
        .select('student_id, name')

      if (studentError) throw studentError

      // 2. 讀取今日的出勤紀錄
      const todayStr = new Date().toISOString().slice(0, 10)
      const { data: todayRecords, error: recordError } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('date', todayStr)

      if (recordError) throw recordError

      // 3. 將註冊學生與出勤紀錄進行對接
      const mappedRecords: AttendanceRecord[] = (students || []).map((student) => {
        const record = (todayRecords || []).find(r => r.student_id === student.student_id)
        return {
          id: record?.id || `temp-${student.student_id}`,
          student_id: student.student_id || '',
          student_name: student.name || '未登錄姓名',
          course_name: record?.course_name || '人工智慧概論',
          date: todayStr,
          status: record?.status || 'absent',
          check_in_time: record?.check_in_time,
          note: record?.note || '',
        }
      })

      setRecords(mappedRecords)
    } catch (err) {
      console.error('Error loading roster/attendance:', err)
      // 若 Supabase 載入失敗，則回退到 MOCK_RECORDS 作為示範
      setRecords(MOCK_RECORDS)
    }
  }, [])

  // 組件掛載後載入資料，且每 8 秒自動背景刷新一次，確保與雲端同步
  useEffect(() => {
    loadRosterAndAttendance()
    const interval = setInterval(loadRosterAndAttendance, 8000)
    return () => clearInterval(interval)
  }, [loadRosterAndAttendance])

  // ── 定期抓取 WebCam 畫面並送至 AI 後端進行多人點名 ─────────────────
  useEffect(() => {
    if (!rollCallActive || backendStatus !== 'online') return

    const interval = setInterval(async () => {
      const video = videoRef.current
      if (!video || video.paused || video.ended) return

      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob(async (blob) => {
          if (!blob) return
          const file = new File([blob], 'rollcall_frame.jpg', { type: 'image/jpeg' })
          const formData = new FormData()
          formData.append('file', file)

          try {
            const res = await fetch(`${apiBase}/api/roll-call`, {
              method: 'POST',
              body: formData,
            })
            if (res.ok) {
              const data = await res.json()
              console.log('AI Roll Call Result:', data)
              // 若有成功識別出任何人，立即重新載入出勤資料
              if (data.identified_count > 0) {
                loadRosterAndAttendance()
              }
            }
          } catch (e) {
            console.error('Failed to send frame to AI roll call:', e)
          }
        }, 'image/jpeg', 0.8)
      } catch (err) {
        console.error('Error capturing frame:', err)
      }
    }, 3000) // 每 3 秒比對一次

    return () => clearInterval(interval)
  }, [rollCallActive, backendStatus, apiBase, loadRosterAndAttendance])

  const startWebcam = useCallback(async () => {
    try {
      setCamError('')
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        videoRef.current.play()
      }
    } catch {
      setCamError('無法存取鏡頭，請確認瀏覽器已授予相機權限')
    }
  }, [])

  const stopWebcam = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
  }, [stream])

  function toggleRollCall() {
    if (!rollCallActive) {
      startWebcam()
      setRollCallActive(true)
    } else {
      stopWebcam()
      setRollCallActive(false)
    }
  }

  function updateStatus(id: string, status: AttendanceRecord['status']) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    setSavedRows(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  function updateNote(id: string, note: string) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, note } : r))
    setSavedRows(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  async function saveRow(id: string) {
    const rec = records.find(r => r.id === id)
    if (!rec) return
    try {
      const isTemp = id.startsWith('temp-')
      if (isTemp) {
        // 新增出勤紀錄到 Supabase
        const { data, error } = await supabase
          .from('attendance_records')
          .insert({
            student_id: rec.student_id,
            student_name: rec.student_name,
            course_name: rec.course_name,
            date: rec.date,
            status: rec.status,
            note: rec.note,
            check_in_time: rec.check_in_time || null,
          })
          .select()
          .single()
        
        if (error) throw error
        
        if (data) {
          // 更新本地狀態中的 ID
          setRecords(prev => prev.map(r => r.student_id === rec.student_id ? { ...r, id: data.id } : r))
        }
      } else {
        // 更新現有出勤紀錄
        const { error } = await supabase
          .from('attendance_records')
          .update({
            status: rec.status,
            note: rec.note,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          
        if (error) throw error
      }
      setSavedRows(prev => { const n = new Set(prev); n.add(rec.id); return n })
    } catch (err) {
      console.error('Error saving attendance record:', err)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const present = records.filter(r => r.status === 'present').length
  const late = records.filter(r => r.status === 'late').length
  const absent = records.filter(r => ['absent', 'excused_sick', 'excused_personal'].includes(r.status)).length

  const timeStr = time.toLocaleTimeString('zh-TW', { hour12: false })
  const dateStr = time.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

  return (
    <div className="dashboard-root">
      {/* 動態背景 */}
      <div className="bg-orb orb1" style={{ opacity: 0.08 }} />
      <div className="bg-orb orb2" style={{ opacity: 0.06 }} />

      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-left">
          <div className="nav-logo">🎓 <span className="nav-logo-text">南台科技大學智慧點名</span></div>
          <div className="nav-clock">{timeStr}</div>
          {/* AI 後端狀態點 */}
          <div className={`backend-status-dot ${
            backendStatus === 'online' ? 'bs-online' :
            backendStatus === 'offline' ? 'bs-offline' : 'bs-checking'
          }`} title={`AI 後端：${
            backendStatus === 'online' ? '在線' :
            backendStatus === 'offline' ? '離線' : '檢測中'
          }`}>
            <span className="bs-label">AI {backendStatus === 'online' ? '在線' : backendStatus === 'offline' ? '離線' : '檢測'}</span>
          </div>
        </div>
        <div className="nav-right">
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="avatar" className="nav-avatar" />
            : <div className="nav-avatar-placeholder">👨‍🏫</div>
          }
          <div className="nav-userinfo">
            <span className="nav-username">{user.name}</span>
            <span className="nav-role-badge teacher-badge">教師</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>登出</button>
        </div>
      </nav>

      <div className="dashboard-content">
        {/* 日期標題 */}
        <div className="page-header">
          <h1 className="page-title">教師主控台</h1>
          <p className="page-date">{dateStr}</p>
        </div>

        {/* 統計卡片 */}
        <div className="stats-row">
          <div className="stat-card stat-present">
            <div className="stat-number">{present}</div>
            <div className="stat-label">✅ 出席</div>
          </div>
          <div className="stat-card stat-late">
            <div className="stat-number">{late}</div>
            <div className="stat-label">🟡 遲到</div>
          </div>
          <div className="stat-card stat-absent">
            <div className="stat-number">{absent}</div>
            <div className="stat-label">❌ 缺席 / 假</div>
          </div>
          <div className="stat-card stat-total">
            <div className="stat-number">{records.length}</div>
            <div className="stat-label">👥 總人數</div>
          </div>
        </div>

        {/* 點名開關 + 鏡頭 */}
        <div className="cam-section">
          <div className="cam-header">
            <h2 className="section-title-lg">即時點名監控</h2>
            {/* 點名開關 */}
            <button
              className={`roll-call-btn ${rollCallActive ? 'roll-active' : 'roll-inactive'}`}
              onClick={toggleRollCall}
            >
              <div className="roll-indicator" />
              {rollCallActive ? '🔴 關閉點名' : '🟢 開放點名'}
            </button>
          </div>

          <div className="webcam-container">
            {rollCallActive ? (
              <>
                <video
                  ref={videoRef}
                  className="webcam-video"
                  autoPlay
                  muted
                  playsInline
                />
                {camError && <div className="cam-error">{camError}</div>}
                <div className="cam-overlay">
                  <div className="cam-badge">🔴 LIVE · AI 辨識中</div>
                </div>
              </>
            ) : (
              <div className="webcam-placeholder">
                <div className="placeholder-icon">📷</div>
                <p className="placeholder-text">點擊「開放點名」啟動 AI 鏡頭辨識</p>
                <p className="placeholder-sub">系統將自動偵測畫面中所有學生人臉</p>
              </div>
            )}
          </div>
        </div>

        {/* 出勤紀錄 Table */}
        <div className="table-section">
          <h2 className="section-title-lg">出勤紀錄管理</h2>
          <p className="table-hint">可直接修改狀態與備註後點擊「儲存」</p>
          <div className="table-wrapper">
            <table className="att-table">
              <thead>
                <tr>
                  <th>學號</th>
                  <th>姓名</th>
                  <th>課程</th>
                  <th>狀態</th>
                  <th>備註</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map(rec => (
                  <tr key={rec.id} className={savedRows.has(rec.id) ? 'row-saved' : ''}>
                    <td className="td-id">{rec.student_id}</td>
                    <td className="td-name">{rec.student_name}</td>
                    <td className="td-course">{rec.course_name}</td>
                    <td>
                      <select
                        className={`status-select status-${rec.status}`}
                        value={rec.status}
                        onChange={e => updateStatus(rec.id, e.target.value as AttendanceRecord['status'])}
                      >
                        {(Object.keys(STATUS_LABELS) as AttendanceRecord['status'][]).map(s => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="note-input"
                        type="text"
                        placeholder="備註..."
                        value={rec.note || ''}
                        onChange={e => updateNote(rec.id, e.target.value)}
                      />
                    </td>
                    <td>
                      {savedRows.has(rec.id)
                        ? <span className="saved-badge">✓ 已儲存</span>
                        : <button className="save-row-btn" onClick={() => saveRow(rec.id)}>儲存</button>
                      }
                    </td>
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
