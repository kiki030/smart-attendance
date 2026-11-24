import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 共用攝像頭 Hook：以 useRef 管理 MediaStream，確保任何離開時機都能真正關閉鏡頭。
 *
 * - streamRef：永遠指向目前的 MediaStream（不受 React 閉包影響，cleanup 不會抓到 null）
 * - stopCamera()：停止所有 track、清空 streamRef、解除 <video>.srcObject
 * - startCamera()：取得鏡頭；若在 getUserMedia 回傳前就已呼叫 stopCamera() 或元件已卸載，
 *   會立刻停止剛取得的 stream，避免產生孤兒鏡頭
 * - 元件卸載時自動釋放
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // 每次 start / stop 都會遞增；用來讓尚未完成的 getUserMedia 失效（isCancelled 旗標）
  const requestIdRef = useRef(0)
  // 供 effect 重新綁定 <video> 用（video 元素重新掛載時需重新注入 srcObject）
  const [stream, setStream] = useState<MediaStream | null>(null)

  const releaseTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const stopCamera = useCallback(() => {
    requestIdRef.current += 1 // 讓進行中的 getUserMedia 結果作廢
    releaseTracks()
    setStream(null)
  }, [releaseTracks])

  const startCamera = useCallback(
    async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      // 重新啟動前先釋放舊的 stream
      releaseTracks()
      const myId = ++requestIdRef.current
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
      if (myId !== requestIdRef.current) {
        // 等待期間使用者已離開 / 已停止：立刻關閉剛取得的鏡頭
        mediaStream.getTracks().forEach(track => track.stop())
        throw new DOMException('Camera request cancelled', 'AbortError')
      }
      streamRef.current = mediaStream
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        videoRef.current.play().catch(() => {})
      }
      return mediaStream
    },
    [releaseTracks],
  )

  // 元件卸載：作廢進行中的請求並釋放鏡頭（此處只用 ref，不會抓到過期的 null state）
  useEffect(() => {
    return () => {
      requestIdRef.current += 1
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [])

  return { videoRef, streamRef, stream, startCamera, stopCamera }
}

/** startCamera 因被取消而 reject 時為 true（不應顯示成錯誤） */
export function isCameraCancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
