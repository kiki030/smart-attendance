import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppUser, UserRoleType } from '../types'
import '../App.css'

interface Props {
  session: Session
  onSetup: (user: AppUser) => void
}

const TEACHER_CODE = 'STUST2024'

export default function RoleSetup({ session, onSetup }: Props) {
  const [role, setRole] = useState<UserRoleType>('student')
  const [studentId, setStudentId] = useState('')
  const [teacherCode, setTeacherCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const googleName = session.user.user_metadata?.full_name || session.user.email || ''
  const avatarUrl = session.user.user_metadata?.avatar_url || ''

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

    setLoading(true)
    try {
      const displayName = role === 'student'
        ? `${studentId} ${googleName}`
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
              <p className="setup-hello">歡迎！</p>
              <p className="setup-email">{session.user.email}</p>
            </div>
          </div>

          <div className="badge login-badge">首次登入設定</div>
          <h2 className="setup-title">請選擇您的身份</h2>

          {/* 角色切換 */}
          <div className="role-toggle-group">
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
          </div>

          {/* 條件輸入 */}
          {role === 'student' && (
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
          )}

          {role === 'teacher' && (
            <div className="setup-field">
              <label className="setup-label">教師驗證碼</label>
              <input
                className="setup-input"
                type="password"
                placeholder="請輸入教師驗證碼"
                value={teacherCode}
                onChange={e => setTeacherCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              <p className="setup-hint">（驗證碼由系統管理員提供）</p>
            </div>
          )}

          {error && <p className="error-msg">⚠️ {error}</p>}

          <button
            className="setup-submit-btn"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? '設定中...' : '確認身份並進入系統 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
