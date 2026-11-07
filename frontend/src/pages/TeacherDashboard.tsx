import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { AppUser, AttendanceRecord } from '../types'
import { STATUS_LABELS } from '../types'
import { useApiBase } from '../hooks/useApiBase'
import '../App.css'

// Draft state shape per record
interface DraftEntry {
  status: AttendanceRecord['status']
  note: string
}

interface Props { user: AppUser }

// 可選課程清單
const COURSE_OPTIONS = [
  '人工智慧概論',
  '專題討論',
  '資料結構',
  '演算法',
  '計算機網路',
  '作業系統',
  '資料庫系統',
  '機器學習',
]

const MOCK_RECORDS: AttendanceRecord[] = [
  { id: '1', student_id: '4B2G0001', student_name: '王小明', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'present' },
  { id: '2', student_id: '4B2G0002', student_name: '李小花', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'late' },
  { id: '3', student_id: '4B2G0003', student_name: '張大雄', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'absent' },
  { id: '4', student_id: '4B2G0004', student_name: '陳美玲', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'present' },
  { id: '5', student_id: '4B2G0005', student_name: '林志偉', course_name: '人工智慧概論', date: new Date().toISOString().slice(0, 10), status: 'excused_sick' },
]

export default function TeacherDashboard({ user }: Props) {
  const { apiBase, status: backendStatus } = useApiBase()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [rollCallActive, setRollCallActive] = useState(false)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [time, setTime] = useState(new Date())
  const [camError, setCamError] = useState('')

  // ── 課程與上課時間設定 ─────────────────────────────────
  const [selectedCourse, setSelectedCourse] = useState(COURSE_OPTIONS[0])
  const [classStartTime, setClassStartTime] = useState('')  // 格式 'HH:MM'

  const [rollCallResult, setRollCallResult] = useState<{
    total_detected: number
    identified_count: number
    unknown_count: number
    attendance_status?: string
    results: Array<{ student_id: string; name: string; similarity: number; status: string }>
  } | null>(null)
  const [manualUploading, setManualUploading] = useState(false)
  const [liveRollCallResult, setLiveRollCallResult] = useState<{
    total_detected: number
    identified_count: number
    unknown_count: number
    results: Array<{ student_id: string; name: string; similarity: number; status: string }>
  } | null>(null)
  const [liveChecking, setLiveChecking] = useState(false)

  // ── 草稿暫存 ──────────────────────────────────────────
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({})
  const draftsRef = useRef<Record<string, DraftEntry>>({})
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set())
  const [savedRows, setSavedRows] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState('')

  // Keep draftsRef in sync so loadRosterAndAttendance can read latest drafts without stale closure
  useEffect(() => { draftsRef.current = drafts }, [drafts])

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
      const { data: students, error: studentError } = await supabase
        .from('student_faces')
        .select('student_id, name')

      if (studentError) throw studentError

      const todayStr = new Date().toISOString().slice(0, 10)
      const { data: todayRecords, error: recordError } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('date', todayStr)

      if (recordError) throw recordError

      const mappedRecords: AttendanceRecord[] = (students || []).map((student) => {
        const record = (todayRecords || []).find(r => r.student_id === student.student_id)
        const recordId = record?.id || `temp-${student.student_id}`
        return {
          id: recordId,
          student_id: student.student_id || '',
          student_name: student.name || '未登錄姓名',
          course_name: record?.course_name || selectedCourse,
          date: todayStr,
          status: record?.status || 'absent',
          check_in_time: record?.check_in_time,
          note: record?.note || '',
        }
      })

      // 保留有未儲存草稿的列，避免背景輪詢覆蓋編輯中的內容
      setRecords(prev => {
        const dirtyIds = new Set(Object.keys(draftsRef.current))
        return mappedRecords.map(newRec => {
          if (dirtyIds.has(newRec.id)) {
            const existing = prev.find(p => p.id === newRec.id)
            return existing ?? newRec
          }
          return newRec
        })
      })
    } catch (err) {
      console.error('Error loading roster/attendance:', err)
      setRecords(MOCK_RECORDS)
    }
  }, [selectedCourse])

  useEffect(() => {
    loadRosterAndAttendance()
    const interval = setInterval(loadRosterAndAttendance, 8000)
    return () => clearInterval(interval)
  }, [loadRosterAndAttendance])

  // ── 綁定 video stream ──────────────────────────────────
  useEffect(() => {
    if (rollCallActive && stream && videoRef.current) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch((err) => {
        console.error('Video play failed:', err)
      })
    }
  }, [rollCallActive, stream])

  // ── 定期抓取 WebCam 畫面並送至 AI 後端 ────────────────────
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
          formData.append('course_name', selectedCourse)
          if (classStartTime) formData.append('class_start_time', classStartTime)

          try {
            setLiveChecking(true)
            const res = await fetch(`${apiBase}/api/roll-call`, {
              method: 'POST',
              body: formData,
              headers: { 'ngrok-skip-browser-warning': 'true' }
            })
            setLiveChecking(false)
            if (res.ok) {
              const data = await res.json()
              setLiveRollCallResult(data)
              if (data.identified_count > 0) loadRosterAndAttendance()
            }
          } catch (e) {
            setLiveChecking(false)
            console.error('Failed to send frame to AI roll call:', e)
          }
        }, 'image/jpeg', 0.8)
      } catch (err) {
        console.error('Error capturing frame:', err)
      }
    }, 3000)

    return () => {
      clearInterval(interval)
      setLiveChecking(false)
    }
  }, [rollCallActive, backendStatus, apiBase, selectedCourse, classStartTime, loadRosterAndAttendance])

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
    setLiveRollCallResult(null)
    setLiveChecking(false)
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

  // ── 草稿更新：修改 status 僅更新本地草稿狀態 ───────────
  function updateStatus(id: string, status: AttendanceRecord['status']) {
    const base = records.find(r => r.id === id)
    if (!base) return
    setDrafts(prev => ({
      ...prev,
      [id]: { status, note: prev[id]?.note ?? base.note ?? '' }
    }))
  }

  // ── 草稿更新：修改 note 僅更新本地草稿狀態 ─────────────
  function updateNote(id: string, note: string) {
    const base = records.find(r => r.id === id)
    if (!base) return
    setDrafts(prev => ({
      ...prev,
      [id]: { status: prev[id]?.status ?? base.status, note }
    }))
  }

  // ── 判斷某列是否有未儲存變更 ──────────────────────────
  function isDirty(id: string): boolean {
    return id in drafts
  }

  // ── 顯示 Toast 訊息（2.5 秒後自動消失）──────────────────
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // ── 確認儲存：將草稿寫入 Supabase ───────────────────────
  async function saveRow(id: string) {
    const draft = drafts[id]
    const base = records.find(r => r.id === id)
    if (!draft || !base) return

    setSavingRows(prev => new Set(prev).add(id))
    try {
      if (id.startsWith('temp-')) {
        // 尚未在 DB 中，INSERT 一筆新紀錄
        const { error } = await supabase.from('attendance_records').insert({
          student_id: base.student_id,
          student_name: base.student_name,
          course_name: base.course_name,
          date: base.date,
          status: draft.status,
          note: draft.note,
          updated_at: new Date().toISOString(),
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('attendance_records')
          .update({ status: draft.status, note: draft.note, updated_at: new Date().toISOString() })
          .eq('id', id)
        if (error) throw error
      }

      // 儲存成功：清除草稿、顯示 ✓ 標記與 Toast
      setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
      setSavedRows(prev => { const n = new Set(prev); n.add(id); return n })
      setTimeout(() => setSavedRows(prev => { const n = new Set(prev); n.delete(id); return n }), 2500)
      showToast(`✅ ${base.student_name} 的出勤紀錄已儲存`)
      await loadRosterAndAttendance()
    } catch (err) {
      console.error('saveRow failed:', err)
      showToast(`❌ 儲存失敗：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingRows(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function handleLogout() {
    localStorage.removeItem('smart_attendance_demo_session')
    await supabase.auth.signOut().catch(() => {})
    window.location.reload()
  }

  // ── 手動上傳照片進行 AI 多人點名 ─────────────────────────
  async function manualRollCall(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (backendStatus !== 'online') {
      alert('AI 後端尚未連線，請先啟動 start.bat 並確認狀態燈號為綠色。')
      return
    }
    setManualUploading(true)
    setRollCallResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('course_name', selectedCourse)
      if (classStartTime) formData.append('class_start_time', classStartTime)

      const res = await fetch(`${apiBase}/api/roll-call`, {
        method: 'POST',
        body: formData,
        headers: { 'ngrok-skip-browser-warning': 'true' }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRollCallResult(data)
      if (data.identified_count > 0) loadRosterAndAttendance()
    } catch (err) {
      alert(`辨識失敗：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setManualUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const present = records.filter(r => r.status === 'present').length
  const late = records.filter(r => r.status === 'late').length
  const absent = records.filter(r => ['absent', 'excused_sick', 'excused_personal'].includes(r.status)).length

  const timeStr = time.toLocaleTimeString('zh-TW', { hour12: false })
  const dateStr = time.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

  return (
    <div className="dashboard-root">
      <div className="bg-orb orb1" style={{ opacity: 0.08 }} />
      <div className="bg-orb orb2" style={{ opacity: 0.06 }} />

      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-left">
          <div className="nav-logo">🎓 <span className="nav-logo-text">南台科技大學智慧點名</span></div>
          <div className="nav-clock">{timeStr}</div>
          <div className={`backend-status-dot ${
            backendStatus === 'online' ? 'bs-online' :
            backendStatus === 'offline' ? 'bs-offline' : 'bs-checking'
          }`} title={`AI 後端：${backendStatus === 'online' ? '在線' : backendStatus === 'offline' ? '離線' : '檢測中'}`}>
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
        <div className="page-header">
          <h1 className="page-title">教師主控台</h1>
          <p className="page-date">{dateStr}</p>
        </div>

        {/* ── 課程與上課時間設定面板 ── */}
        <div className="cam-section" style={{ marginBottom: '1.5rem' }}>
          <h2 className="section-title-lg">⚙️ 課程設定</h2>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem', alignItems: 'flex-end' }}>
            {/* 課程選擇 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600 }}>📚 課程名稱</label>
              <select
                value={selectedCourse}
                onChange={e => setSelectedCourse(e.target.value)}
                className="status-select"
                style={{ minWidth: '180px', padding: '0.55rem 0.8rem', fontSize: '0.9rem' }}
              >
                {COURSE_OPTIONS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            {/* 上課時間 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600 }}>
                🕐 上課開始時間 <span style={{ color: '#64748b', fontWeight: 400 }}>(逾 15 分鐘視為遲到)</span>
              </label>
              <input
                type="time"
                value={classStartTime}
                onChange={e => setClassStartTime(e.target.value)}
                className="note-input"
                style={{ padding: '0.55rem 0.8rem', fontSize: '0.9rem', width: '140px' }}
              />
            </div>
            {/* 目前設定摘要 */}
            <div style={{ padding: '0.5rem 1rem', background: 'rgba(99,102,241,0.12)', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.82rem', color: '#a5b4fc' }}>
              <div>課程：<strong>{selectedCourse}</strong></div>
              <div>上課時間：<strong>{classStartTime || '未設定（不判斷遲到）'}</strong></div>
            </div>
          </div>
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

        {/* 即時鏡頭點名 */}
        <div className="cam-section">
          <div className="cam-header">
            <h2 className="section-title-lg">即時點名監控</h2>
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
                <video ref={videoRef} className="webcam-video" autoPlay muted playsInline />
                {camError && <div className="cam-error">{camError}</div>}
                <div className="cam-overlay">
                  <div className="cam-badge">🔴 LIVE · {selectedCourse} · AI 辨識中</div>
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

          {/* 即時比對狀態面板 */}
          {rollCallActive && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>🤖 AI 即時比對狀態</span>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  {liveChecking ? '⏳ 正在掃描比對...' : '🟢 監控中 (每 3 秒比對)'}
                </span>
              </div>

              {liveRollCallResult ? (
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', fontSize: '0.8rem' }}>
                    <div style={{ background: 'rgba(99,102,241,0.15)', padding: '0.25rem 0.6rem', borderRadius: '6px' }}>
                      🔍 偵測人臉: {liveRollCallResult.total_detected}
                    </div>
                    <div style={{ background: 'rgba(74,222,128,0.15)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#4ade80' }}>
                      ✅ 成功辨識: {liveRollCallResult.identified_count}
                    </div>
                    <div style={{ background: 'rgba(248,113,113,0.15)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#f87171' }}>
                      ⚠️ 未知人臉: {liveRollCallResult.unknown_count}
                    </div>
                  </div>

                  {liveRollCallResult.results.length > 0 ? (
                    <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                      <table className="att-table" style={{ fontSize: '0.8rem', margin: 0 }}>
                        <tbody>
                          {liveRollCallResult.results.map((r, i) => (
                            <tr key={i}>
                              <td style={{ padding: '0.4rem' }}>{r.status === 'unknown_alert' ? '❓ 未註冊未知人臉' : `${r.student_id} ${r.name}`}</td>
                              <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 'bold', color: r.similarity >= 0.7 ? '#4ade80' : '#f87171' }}>
                                {(r.similarity * 100).toFixed(0)}% 相似度
                              </td>
                              <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                                {r.status === 'present' ? '🟢 出席' : r.status === 'late' ? '🟡 遲到' : '🔴 警報'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>目前畫面中沒有人臉</p>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>等待首輪比對結果中...</p>
              )}
            </div>
          )}
        </div>

        {/* 手動上傳點名 */}
        <div className="cam-section" style={{ marginTop: '1.5rem' }}>
          <div className="cam-header">
            <h2 className="section-title-lg">📁 上傳照片 AI 點名</h2>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>拍攝課堂全景後上傳，系統自動辨識所有學生</span>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={manualRollCall}
              style={{ display: 'none' }}
              id="manual-upload-input"
            />
            <label
              htmlFor="manual-upload-input"
              className={`roll-call-btn ${backendStatus === 'online' ? 'roll-active' : 'roll-inactive'}`}
              style={{ cursor: backendStatus === 'online' ? 'pointer' : 'not-allowed', opacity: backendStatus === 'online' ? 1 : 0.6 }}
            >
              {manualUploading ? '⏳ AI 辨識中...' : '📸 選擇/拍攝照片送出辨識'}
            </label>
            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
              {backendStatus === 'online' ? '🟢 AI 後端在線，可上傳' : backendStatus === 'checking' ? '🟡 連線檢測中...' : '🔴 AI 後端離線，請啟動 start.bat'}
            </span>
          </div>

          {/* AI 辨識結果卡片 */}
          {rollCallResult && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
                <div className="stat-card" style={{ flex: '1', minWidth: '130px', background: 'rgba(99,102,241,0.12)', borderColor: '#6366f1' }}>
                  <div className="stat-number" style={{ color: '#818cf8' }}>{rollCallResult.total_detected}</div>
                  <div className="stat-label">🔍 偵測到人臉</div>
                </div>
                <div className="stat-card stat-present" style={{ flex: '1', minWidth: '130px' }}>
                  <div className="stat-number">{rollCallResult.identified_count}</div>
                  <div className="stat-label">✅ 辨識成功</div>
                </div>
                <div className="stat-card stat-absent" style={{ flex: '1', minWidth: '130px' }}>
                  <div className="stat-number">{rollCallResult.unknown_count}</div>
                  <div className="stat-label">⚠️ 未知人臉</div>
                </div>
                {rollCallResult.attendance_status && (
                  <div className="stat-card stat-late" style={{ flex: '1', minWidth: '130px' }}>
                    <div className="stat-number" style={{ fontSize: '1rem' }}>
                      {rollCallResult.attendance_status === 'late' ? '🟡 遲到' : '✅ 出席'}
                    </div>
                    <div className="stat-label">本次簽到狀態</div>
                  </div>
                )}
              </div>

              {rollCallResult.results.length > 0 && (
                <div className="table-wrapper">
                  <table className="att-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>學號</th>
                        <th>姓名</th>
                        <th>相似度</th>
                        <th>狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollCallResult.results.map((r, i) => (
                        <tr key={i} style={{ opacity: r.status === 'unknown_alert' ? 0.7 : 1 }}>
                          <td style={{ color: '#64748b' }}>{i + 1}</td>
                          <td className="td-id">{r.status === 'unknown_alert' ? '—' : r.student_id}</td>
                          <td className="td-name">{r.status === 'unknown_alert' ? 'Unknown' : r.name}</td>
                          <td>
                            <span style={{ fontWeight: 700, color: r.similarity >= 0.7 ? '#4ade80' : '#f87171' }}>
                              {(r.similarity * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td>
                            {r.status === 'present' && <span className="saved-badge" style={{ background: 'rgba(74,222,128,0.18)', color: '#4ade80' }}>✅ 出席</span>}
                            {r.status === 'late' && <span className="saved-badge" style={{ background: 'rgba(251,191,36,0.18)', color: '#fbbf24' }}>🟡 遲到</span>}
                            {r.status === 'unknown_alert' && <span className="saved-badge" style={{ background: 'rgba(248,113,113,0.18)', color: '#f87171' }}>⚠️ 未知警報</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 出勤紀錄管理（草稿暫存，確認後儲存） */}
        <div className="table-section">
          <h2 className="section-title-lg">出勤紀錄管理</h2>
          <p className="table-hint">修改狀態或備註後，點擊「確認儲存」寫入雲端</p>

          {/* Toast 提示 */}
          {toast && (
            <div style={{
              background: toast.startsWith('❌') ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.12)',
              border: `1px solid ${toast.startsWith('❌') ? '#f87171' : '#4ade80'}`,
              color: toast.startsWith('❌') ? '#f87171' : '#4ade80',
              padding: '0.6rem 1rem',
              borderRadius: '10px',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}>
              {toast}
            </div>
          )}

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
                {records.map(rec => {
                  const draft = drafts[rec.id]
                  const dirty = isDirty(rec.id)
                  const saving = savingRows.has(rec.id)
                  const saved = savedRows.has(rec.id)
                  const currentStatus = draft?.status ?? rec.status
                  const currentNote = draft?.note ?? rec.note ?? ''
                  return (
                    <tr key={rec.id} className={saved ? 'row-saved' : ''}>
                      <td className="td-id">{rec.student_id}</td>
                      <td className="td-name">{rec.student_name}</td>
                      <td className="td-course">{rec.course_name}</td>
                      <td>
                        <select
                          className={`status-select status-${currentStatus}${dirty ? ' draft-unsaved' : ''}`}
                          value={currentStatus}
                          onChange={e => updateStatus(rec.id, e.target.value as AttendanceRecord['status'])}
                        >
                          {(Object.keys(STATUS_LABELS) as AttendanceRecord['status'][]).map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        {dirty && <span className="unsaved-badge">未儲存</span>}
                      </td>
                      <td>
                        <input
                          className={`note-input${dirty ? ' draft-unsaved' : ''}`}
                          type="text"
                          placeholder="備註"
                          value={currentNote}
                          onChange={e => updateNote(rec.id, e.target.value)}
                        />
                      </td>
                      <td>
                        {saved ? (
                          <span className="saved-badge">✓ 已儲存</span>
                        ) : (
                          <button
                            className="save-row-btn"
                            onClick={() => saveRow(rec.id)}
                            disabled={!dirty || saving}
                            style={{ opacity: dirty ? 1 : 0.35, cursor: dirty ? 'pointer' : 'default' }}
                          >
                            {saving ? '⏳ 儲存中...' : '確認儲存'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
