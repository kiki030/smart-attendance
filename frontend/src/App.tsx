import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { AppUser } from './types'
import LoginPage from './pages/LoginPage'
import RoleSetup from './pages/RoleSetup'
import TeacherDashboard from './pages/TeacherDashboard'
import StudentDashboard from './pages/StudentDashboard'
import FaceRegistration from './pages/FaceRegistration'
import './App.css'

export default function App() {
  // undefined = still loading, null = not logged in
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    // Check for existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) void loadUserRole(session)
      else setSession(null)
    })

    // Listen for auth state changes (login / logout / token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        void loadUserRole(session)
      } else {
        setAppUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadUserRole(session: Session) {
    const email = session.user.email!
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .eq('email', email)
      .single()

    if (data && !error) {
      const user: AppUser = {
        email,
        name: data.display_name || session.user.user_metadata?.full_name || email,
        role: data.role,
        studentId: data.student_id,
        avatarUrl: session.user.user_metadata?.avatar_url,
      }
      setAppUser(user)
      navigate(data.role === 'teacher' ? '/teacher' : '/student', { replace: true })
    } else {
      // First time user — needs role selection
      setAppUser(null)
      navigate('/setup', { replace: true })
    }
  }

  // ── Loading state ─────────────────────────────────────────
  if (session === undefined) {
    return (
      <div className="app-root loading-screen">
        <div className="bg-orb orb1" />
        <div className="bg-orb orb2" />
        <div className="bg-orb orb3" />
        <div className="spinner-container">
          <div className="spinner" />
          <p className="loading-text">南台科技大學智慧點名</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      {/* 登入頁 */}
      <Route
        path="/login"
        element={
          session
            ? <Navigate to={appUser ? (appUser.role === 'teacher' ? '/teacher' : '/student') : '/setup'} replace />
            : <LoginPage />
        }
      />

      {/* 角色設定（首次 Google 登入） */}
      <Route
        path="/setup"
        element={
          session
            ? <RoleSetup
                session={session}
                onSetup={(user) => {
                  setAppUser(user)
                  navigate(user.role === 'teacher' ? '/teacher' : '/student', { replace: true })
                }}
              />
            : <Navigate to="/login" replace />
        }
      />

      {/* 教師主控台 */}
      <Route
        path="/teacher"
        element={
          appUser?.role === 'teacher'
            ? <TeacherDashboard user={appUser} />
            : <Navigate to="/login" replace />
        }
      />

      {/* 學生即時看板 */}
      <Route
        path="/student"
        element={
          appUser?.role === 'student'
            ? <StudentDashboard user={appUser} />
            : <Navigate to="/login" replace />
        }
      />

      {/* 人臉註冊 */}
      <Route
        path="/register"
        element={
          appUser
            ? <FaceRegistration user={appUser} />
            : <Navigate to="/login" replace />
        }
      />

      {/* 預設導向 */}
      <Route
        path="*"
        element={
          <Navigate
            to={
              session
                ? appUser
                  ? appUser.role === 'teacher' ? '/teacher' : '/student'
                  : '/setup'
                : '/login'
            }
            replace
          />
        }
      />
    </Routes>
  )
}
