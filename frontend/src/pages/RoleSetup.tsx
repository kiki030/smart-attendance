import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppUser, UserRoleType } from '../types'
import '../App.css'

interface Props {
  session: Session
  onSetup: (user: AppUser) => void
}

// 教師驗證碼從環境變數讀取，fallback 為 'STUST2024'（本地開發備援）
const TEACHER_CODE = import.meta.env.VITE_TEACHER_CODE || 'STUST2024'

// ── Google 帳號解析：南台網域信箱 -> 學號、姓名清洗 ──────────
const STUST_DOMAINS = ['stust.edu.tw', 'g2.stust.edu.tw']
const STUDENT_ID_PATTERN = /^[0-9][a-z0-9]{7}$/i

export function parseStustEmail(email: string | undefined): string {
  if (!email) return ''
  const [local, domain] = email.toLowerCase().split('@')
  if (!local || !STUST_DOMAINS.includes(domain)) return ''
  return STUDENT_ID_PATTERN.test(local) ? local.toUpperCase() : ''
}

export function cleanName(fullName: string, studentId: string): string {
  let name = (fullName || '').trim()
  if (studentId && name.toUpperCase().startsWith(studentId.toUpperCase())) {
    name = name.slice(studentId.length)
  }
  return name.trim()
}

export default function RoleSetup({ session, onSetup }: Props) {
  const [role, setRole] = useState<UserRoleType>('student')
  const autoId = parseStustEmail(session.user.email)
  const rawGoogleName: string = session.user.user_metadata?.full_name || session.user.user_metadata?.name || ''
  const [studentId, setStudentId] = useState(autoId)
  const [studentName, setStudentName] = useState(cleanName(rawGoogleName, autoId))
  const [autoMode, setAutoMode] = useState(!!autoId && !session.user.email?.startsWith('demo_'))
  const autoStarted = useRef(false)
  const [teacherCode, setTeacherCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const googleName = cleanName(rawGoogleName, autoId) || session.user.email || ''
  const avatarUrl = session.user.user_metadata?.avatar_url || ''

  // 南台學號信箱：自動建檔（短暫延遲，讓教師可點擊取消）
  useEffect(() => {
    if (!autoMode || autoStarted.current) return
    const t = setTimeout(() => {
      autoStarted.current = true
      void handleSubmit()
    }, 1200)
    return () => clearTimeout(t)
  }, [autoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    setError('')
    if (role === 'teacher' && teacherCode !== TEACHER_CODE) {
      setError('教師驗證碼錯誤，請聯繫系統管理員')
      return
    }
    if (role === 'student' && !studentId.trim()) {
      setError('請輸入您的學號')
      return
    }
    if (role === 'student' && !studentName.trim()) {
      setError('請輸入您的姓名')
      return
    }

    setLoading(true)
    try {
      const displayName = role === 'student'
        ? `${studentId.trim()} ${studentName.trim()}`
        : googleName

      const { error: dbError } = await supabase.from('user_roles').insert({
        email: session.user.email!,
        role,
        student_id: role === 'student' ? studentId.trim() : null,
        display_name: displayName,
      })

      if (dbError) throw dbError

      onSetup({
        email: session.user.email!,
        name: displayName,
        role,
        studentId: role === 'student' ? studentId.trim() : undefined,
        avatarUrl,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '設定失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-root">
      <div className="bg-orb orb1" />
      <div className="bg-orb orb2" />
      <div className="bg-orb orb3" />

      <div className="login-center">
        <div className="login-card setup-card">
          {/* 使用者資訊 */}
          <div className="setup-user">
            {avatarUrl && <img src={avatarUrl} alt="avatar" className="setup-avatar" />}
            <div>
              {session.user.email?.startsWith('demo_') ? (
                <>
                  <p className="setup-hello">🚀 歡迎進入測試模式！</p>
                </>
              ) : (
                <>
                  <p className="setup-hello">歡迎！</p>
                  <p className="setup-email">{session.user.email}</p>
                </>
              )}
            </div>
          </div>

          {autoMode && (
            <div style={{ textAlign: 'center', margin: '0.5rem 0 1rem' }}>
              <p className="setup-hello">✅ 已自動辨識：{studentId} {studentName}</p>
              <p className="setup-email">正在為您建立學生資料...</p>
              <button
                className="role-option"
                style={{ margin: '0.75rem auto 0' }}
                onClick={() => { setAutoMode(false); setRole('teacher') }}
              >
                我是教師，改選教師身分
              </button>
            </div>
          )}

          <div className="badge login-badge">首次登入設定</div>
          {!autoMode && <h2 className="setup-title">請選擇您的身份</h2>}

          {/* 角色切換 */}
          {!autoMode && <div className="role-toggle-group">
            <button
              className={`role-option ${role === 'student' ? 'active student-active' : ''}`}
              onClick={() => { setRole('student'); setError('') }}
            >
              <span className="role-icon">🎒</span>
              <span>學生</span>
            </button>
            <button
              className={`role-option ${role === 'teacher' ? 'active teacher-active' : ''}`}
              onClick={() => { setRole('teacher'); setError('') }}
            >
              <span className="role-icon">👨‍🏫</span>
              <span>教師</span>
            </button>
          </div>}

          {/* 條件輸入 */}
          {!autoMode && role === 'student' && (
            <>
              <div className="setup-field">
                <label className="setup-label">學號</label>
                <input
                  className="setup-input"
                  type="text"
                  placeholder="請輸入學號（如：4B2G0037）"
                  value={studentId}
                  onChange={e => setStudentId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
              <div className="setup-field" style={{ marginTop: '1rem' }}>
                <label className="setup-label">姓名</label>
                <input
                  className="setup-input"
                  type="text"
                  placeholder="請輸入學生姓名（如：王小明）"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            </>
          )}

          {!autoMode && role === 'teacher' && (
            <div className="setup-field">
              <label className="setup-label">教師驗證碼</label>
              <input
                className="setup-input"
                type="password"
                placeholder="請輸入教師驗證碼（如：STUST2024）"
                value={teacherCode}
                onChange={e => setTeacherCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          )}

          {error && <p className="error-msg">⚠️ {error}</p>}

          {!autoMode && <button
            className="setup-submit-btn"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? '設定中...' : '確認身份並進入系統 →'}
          </button>}
        </div>
      </div>
    </div>
  )
}

