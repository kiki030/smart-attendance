import { useEffect, useState } from 'react'
import './App.css'

const modules = [
  { icon: '🎓', label: '學生人臉註冊', status: '就緒', color: '#4ade80' },
  { icon: '📡', label: '即時點名辨識', status: '就緒', color: '#60a5fa' },
  { icon: '🧠', label: 'InsightFace AI 引擎', status: '運行中', color: '#a78bfa' },
  { icon: '☁️', label: 'Supabase 雲端資料庫', status: '已連線', color: '#34d399' },
  { icon: '🔍', label: '多人影像比對', status: '就緒', color: '#f472b6' },
  { icon: '📊', label: '出勤紀錄管理', status: '開發中', color: '#fbbf24' },
]

export default function App() {
  const [time, setTime] = useState(new Date())
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date())
      setPulse(p => !p)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const timeStr = time.toLocaleTimeString('zh-TW', { hour12: false })
  const dateStr = time.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  return (
    <div className="app-root">
      {/* 動態背景光球 */}
      <div className="bg-orb orb1" />
      <div className="bg-orb orb2" />
      <div className="bg-orb orb3" />

      <div className="container">
        {/* 頂部 Header */}
        <header className="header">
          <div className="badge">AI-Powered · v2.0</div>
          <div className={`status-dot ${pulse ? 'pulse-on' : 'pulse-off'}`} />
          <span className="status-text">系統上線中</span>
        </header>

        {/* 主標題 */}
        <main className="hero">
          <div className="ai-core">
            <div className="core-ring ring1" />
            <div className="core-ring ring2" />
            <div className="core-inner">🎓</div>
          </div>

          <h1 className="title">
            校園智慧點名系統
          </h1>
          <p className="subtitle">前端主控台</p>
          <p className="description">
            基於 InsightFace YOLOv8 + ArcFace 512D 特徵向量的<br />
            AI 人臉辨識自動化出勤管理平台
          </p>

          <div className="time-display">
            <span className="time">{timeStr}</span>
            <span className="date">{dateStr}</span>
          </div>
        </main>

        {/* 功能模組卡片 */}
        <section className="modules">
          <h2 className="section-title">系統模組狀態</h2>
          <div className="module-grid">
            {modules.map((mod, i) => (
              <div key={i} className="module-card" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="module-icon">{mod.icon}</div>
                <div className="module-info">
                  <span className="module-label">{mod.label}</span>
                  <span className="module-status" style={{ color: mod.color }}>
                    ● {mod.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* API 端點資訊 */}
        <section className="api-section">
          <div className="api-card">
            <span className="api-label">後端 API 位址</span>
            <code className="api-url">http://127.0.0.1:8000</code>
            <a className="api-link" href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">
              開啟 Swagger Docs →
            </a>
          </div>
        </section>

        <footer className="footer">
          <p>© 2026 Smart Attendance System · Powered by FastAPI + InsightFace + Supabase + React</p>
        </footer>
      </div>
    </div>
  )
}
