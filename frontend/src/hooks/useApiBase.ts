import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const LOCAL_FALLBACK = 'http://127.0.0.1:8000'
const HEALTH_TIMEOUT_MS = 4000

export type BackendStatus = 'checking' | 'online' | 'offline'

interface UseApiBaseResult {
  apiBase: string
  status: BackendStatus
  recheckStatus: () => void
}

/**
 * useApiBase
 * ──────────
 * 動態讀取後端 AI API 的網址：
 *   1. 從 Supabase app_config 表讀取 key='api_base_url'（由 start.bat 寫入 ngrok URL）
 *   2. 發送 /health 請求確認後端是否在線
 *   3. 回傳 apiBase（網址）與 status（online / offline / checking）
 */
export function useApiBase(): UseApiBaseResult {
  const [apiBase, setApiBase] = useState<string>(LOCAL_FALLBACK)
  const [status, setStatus] = useState<BackendStatus>('checking')

  // ── 從 Supabase 讀取最新 API URL ────────────────────────────
  useEffect(() => {
    async function fetchApiBase() {
      try {
        const { data } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'api_base_url')
          .single()
        if (data?.value) {
          setApiBase(data.value)
        }
      } catch {
        // 讀取失敗時保留 localhost fallback
      }
    }
    fetchApiBase()
  }, [])

  // ── 檢查後端是否在線 ─────────────────────────────────────────
  const recheckStatus = useCallback(async () => {
    setStatus('checking')
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
      const resp = await fetch(`${apiBase}/health`, { signal: controller.signal })
      clearTimeout(timer)
      setStatus(resp.ok ? 'online' : 'offline')
    } catch {
      setStatus('offline')
    }
  }, [apiBase])

  // apiBase 確定後立即檢查，之後每 30 秒自動重檢
  useEffect(() => {
    recheckStatus()
    const interval = setInterval(recheckStatus, 30000)
    return () => clearInterval(interval)
  }, [recheckStatus])

  return { apiBase, status, recheckStatus }
}
