import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppUser } from '../types'
import '../App.css'

interface Props { user: AppUser }

const STEPS = [
  { label: '正面', icon: '😊', hint: '請正對鏡頭，保持臉部在框架內' },
  { label: '左側臉', icon: '👈', hint: '請稍微向右轉頭，露出左側臉輪廓' },
  { label: '右側臉', icon: '👉', hint: '請稍微向左轉頭，露出右側臉輪廓' },
]

const API_BASE = 'http://127.0.0.1:8000'

export default function FaceRegistration({ user }: Props) {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [previews, setPreviews] = useState<(string | null)[]>([null, null, null])
  const [uploadStatus, setUploadStatus] = useState<('idle' | 'uploading' | 'done' | 'error')[]>(['idle', 'idle', 'idle'])
  const [camError, setCamError] = useState('')
  const [uploadMsg, setUploadMsg] = useState('')

  useEffect(() => {
    startWebcam()
    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function startWebcam() {
    try {
      setCamError('')
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        videoRef.current.play()
      }
    } catch {
      setCamError('無法存取鏡頭，請確認瀏覽器已授予相機權限')
    }
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const newPreviews = [...previews]
    newPreviews[currentStep] = dataUrl
    setPreviews(newPreviews)

    const newStatus = [...uploadStatus]
    newStatus[currentStep] = 'idle'
    setUploadStatus(newStatus)
    setUploadMsg('')
  }

  function retakePhoto() {
    const newPreviews = [...previews]
    newPreviews[currentStep] = null
    setPreviews(newPreviews)
    setUploadMsg('')
  }

  async function uploadCurrentStep() {
    const preview = previews[currentStep]
    if (!preview) return

    const newStatus = [...uploadStatus]
    newStatus[currentStep] = 'uploading'
    setUploadStatus(newStatus)
    setUploadMsg('上傳中，請稍候...')

    try {
      // Convert dataURL to Blob
      const res = await fetch(preview)
      const blob = await res.blob()
      const file = new File([blob], `face_${currentStep}.jpg`, { type: 'image/jpeg' })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('student_id', user.studentId || user.email)
      formData.append('name', user.name)

      const response = await fetch(`${API_BASE}/api/register-face`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error(`伺服器錯誤：${response.status}`)

      newStatus[currentStep] = 'done'
      setUploadStatus([...newStatus])
      setUploadMsg(`✅ ${STEPS[currentStep].label}角度註冊成功！`)

      // Auto advance to next step after 1.5s
      if (currentStep < STEPS.length - 1) {
        setTimeout(() => {
          setCurrentStep(s => s + 1)
          setUploadMsg('')
        }, 1500)
      }
    } catch (e) {
      newStatus[currentStep] = 'error'
      setUploadStatus([...newStatus])
      setUploadMsg(`⚠️ 上傳失敗：${e instanceof Error ? e.message : '請確認後端伺服器已啟動'}`)
    }
  }

  const allDone = uploadStatus.every(s => s === 'done')
  const currentPreview = previews[currentStep]

  return (
    <div className="dashboard-root">
      <div className="bg-orb orb1" style={{ opacity: 0.08 }} />
      <div className="bg-orb orb2" style={{ opacity: 0.06 }} />

      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-left">
          <button className="back-btn" onClick={() => navigate(-1)}>← 返回</button>
          <div className="nav-logo">🎓 <span className="nav-logo-text">人臉特徵註冊</span></div>
        </div>
        <div className="nav-right">
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="avatar" className="nav-avatar" />
            : <div className="nav-avatar-placeholder">🎒</div>
          }
          <span className="nav-username">{user.studentId || user.email}</span>
        </div>
      </nav>

      <div className="dashboard-content">
        <div className="page-header">
          <h1 className="page-title">多角度人臉特徵註冊</h1>
          <p className="page-date">系統僅儲存 512 維特徵向量，不保留原始相片</p>
        </div>

        {/* 步驟進度條 */}
        {!allDone && (
          <div className="steps-header">
            {STEPS.map((step, i) => (
              <div key={i} className={`step-item ${i === currentStep ? 'step-current' : i < currentStep || uploadStatus[i] === 'done' ? 'step-done' : 'step-pending'}`}>
                <div className="step-dot">
                  {uploadStatus[i] === 'done' ? '✓' : i + 1}
                </div>
                <span className="step-label">{step.icon} {step.label}</span>
                {i < STEPS.length - 1 && <div className={`step-line ${uploadStatus[i] === 'done' ? 'line-done' : ''}`} />}
              </div>
            ))}
          </div>
        )}

        {/* 完成畫面 */}
        {allDone ? (
          <div className="done-card">
            <div className="done-icon">🎉</div>
            <h2 className="done-title">人臉特徵註冊完成！</h2>
            <p className="done-desc">
              三個角度的特徵向量已成功儲存至雲端。<br />
              AI 系統將使用這些特徵進行多角度辨識比對。
            </p>
            <button className="setup-submit-btn" onClick={() => navigate('/student')}>
              返回學生看板 →
            </button>
          </div>
        ) : (
          <div className="register-layout">
            {/* 左：鏡頭 / 預覽 */}
            <div className="register-cam-col">
              <div className="step-hint-bar">
                <span className="step-hint-icon">{STEPS[currentStep].icon}</span>
                <span>{STEPS[currentStep].hint}</span>
              </div>

              {camError ? (
                <div className="cam-error-box">{camError}</div>
              ) : currentPreview ? (
                <div className="capture-preview-wrapper">
                  <img src={currentPreview} alt="preview" className="capture-preview" />
                  <div className="preview-overlay">📸 預覽中</div>
                </div>
              ) : (
                <div className="webcam-container register-cam">
                  <video ref={videoRef} className="webcam-video" autoPlay muted playsInline />
                  <div className="face-guide-box" />
                </div>
              )}

              {/* 隱藏 canvas */}
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* 操作按鈕 */}
              <div className="capture-actions">
                {!currentPreview ? (
                  <button className="capture-btn" onClick={capturePhoto} disabled={!!camError}>
                    📸 拍照
                  </button>
                ) : (
                  <>
                    <button className="retake-btn" onClick={retakePhoto}>🔄 重拍</button>
                    <button
                      className="upload-btn"
                      onClick={uploadCurrentStep}
                      disabled={uploadStatus[currentStep] === 'uploading' || uploadStatus[currentStep] === 'done'}
                    >
                      {uploadStatus[currentStep] === 'uploading' ? '⏳ 上傳中...'
                        : uploadStatus[currentStep] === 'done' ? '✅ 已完成'
                        : '⬆️ 上傳並註冊'}
                    </button>
                  </>
                )}
              </div>

              {uploadMsg && (
                <div className={`upload-msg ${uploadStatus[currentStep] === 'error' ? 'msg-error' : 'msg-success'}`}>
                  {uploadMsg}
                </div>
              )}
            </div>

            {/* 右：角度縮圖 */}
            <div className="register-thumbs-col">
              <h3 className="thumbs-title">拍攝進度</h3>
              {STEPS.map((step, i) => (
                <div
                  key={i}
                  className={`thumb-card ${i === currentStep ? 'thumb-current' : ''} ${uploadStatus[i] === 'done' ? 'thumb-done' : ''}`}
                  onClick={() => uploadStatus[i] !== 'uploading' && setCurrentStep(i)}
                >
                  {previews[i] ? (
                    <img src={previews[i]!} alt={step.label} className="thumb-img" />
                  ) : (
                    <div className="thumb-placeholder">{step.icon}</div>
                  )}
                  <div className="thumb-info">
                    <span className="thumb-label">{step.label}</span>
                    <span className={`thumb-status ${uploadStatus[i]}`}>
                      {uploadStatus[i] === 'done' ? '✅ 完成'
                        : uploadStatus[i] === 'uploading' ? '⏳ 上傳中'
                        : uploadStatus[i] === 'error' ? '❌ 失敗'
                        : previews[i] ? '📸 已拍照'
                        : '⬜ 待拍照'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
