import { useState } from 'react'
import type { ScheduleSyncResult, UserRoleType } from '../types'
import type { BackendStatus } from '../hooks/useApiBase'

interface Props {
  role: UserRoleType
  userId: string
  defaultAccount: string
  apiBase: string
  backendStatus: BackendStatus
  onClose: () => void
  onSynced: (result: ScheduleSyncResult) => void
}

/**
 * 南台校務課表同步彈窗
 * 密碼只存在於本元件的 state，送出後（無論成功失敗）立即清空，不寫入任何儲存空間。
 */
export default function ScheduleSyncModal({
  role, userId, defaultAccount, apiBase, backendStatus, onClose, onSynced,
}: Props) {
  const [account, setAccount] = useState(defaultAccount)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!account.trim() || !password) {
      setError('請輸入校務帳號與密碼')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`${apiBase}/api/sync-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ account: account.trim(), password, role, user_id: userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`
        throw new Error(detail)
      }
      onSynced(data as ScheduleSyncResult)
      onClose()
    } catch (err) {
      if (err instanceof TypeError) {
        setError('無法連線至後端伺服器，請先啟動 python start_server.py 並確認狀態燈號為綠色')
      } else {
        setError(`同步失敗：${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setPassword('') // 無論成功或失敗都立即清除密碼
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !submitting) onClose() }}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">🔄 同步南台校務課表</h3>
            <p className="modal-subtitle">{role === 'teacher' ? '匯入本學期授課課表' : '匯入本學期修課課表'}</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} disabled={submitting}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {backendStatus === 'offline' && (
            <div style={{ fontSize: '0.78rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', padding: '0.5rem 0.75rem', borderRadius: 10 }}>
              ⚠️ 偵測到後端目前離線，同步前請確認已啟動 <code>python start_server.py</code>
            </div>
          )}
          <div className="form-field">
            <label className="form-label" htmlFor="stust-account">校務帳號</label>
            <input
              id="stust-account"
              className="form-input"
              value={account}
              onChange={e => setAccount(e.target.value)}
              placeholder={role === 'teacher' ? '教職員帳號' : '學號'}
              autoComplete="off"
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="stust-password">校務密碼</label>
            <input
              id="stust-password"
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="校務系統密碼"
              autoComplete="new-password"
            />
            <span className="form-hint">🔒 密碼僅供單次連線抓取課表，系統絕不儲存</span>
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? '⏳ 同步中...' : '開始同步'}
          </button>
        </form>
      </div>
    </div>
  )
}
