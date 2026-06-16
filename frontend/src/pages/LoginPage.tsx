import { supabase } from '../lib/supabase'
import '../App.css'

export default function LoginPage() {
  async function handleGoogleLogin() {
    // Redirect back to this app after Google login
    const base = import.meta.env.BASE_URL || '/'
    const redirectTo = window.location.origin + base
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
  }

  return (
    <div className="app-root">
      {/* 動態背景光球 */}
      <div className="bg-orb orb1" />
      <div className="bg-orb orb2" />
      <div className="bg-orb orb3" />

      <div className="login-center">
        <div className="login-card">
          {/* 動畫核心 */}
          <div className="ai-core login-core">
            <div className="core-ring ring1" />
            <div className="core-ring ring2" />
            <div className="core-inner">🎓</div>
          </div>

          {/* 校名 badge */}
          <div className="badge login-badge">南台科技大學智慧點名</div>

          <h1 className="title login-title">校園智慧點名系統</h1>
          <p className="description login-desc">
            基於 InsightFace YOLOv8 + ArcFace<br />
            AI 人臉辨識自動化出勤管理平台
          </p>

          {/* Google 登入按鈕 */}
          <button className="google-btn" onClick={handleGoogleLogin}>
            <svg className="google-icon" viewBox="0 0 24 24" width="22" height="22">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            使用 Google 帳戶登入
          </button>

          <div className="login-divider" />

          <p className="login-hint">
            🔍 系統將依您的 Google 帳戶自動識別身份<br />
            <span className="hint-sub">首次登入需進行角色設定</span>
          </p>

          <div className="login-features">
            <div className="feature-chip">🧠 AI 人臉辨識</div>
            <div className="feature-chip">☁️ Supabase 雲端</div>
            <div className="feature-chip">📊 即時統計</div>
          </div>
        </div>
      </div>
    </div>
  )
}
