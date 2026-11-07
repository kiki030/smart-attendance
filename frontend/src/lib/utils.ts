/** 取出錯誤訊息（Supabase 的 PostgrestError 是一般物件，不是 Error 實例） */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

/** 以本地時區輸出 YYYY-MM-DD（避免 toISOString() 在台灣清晨變成前一天） */
export function toLocalDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 從今天起算，下一個指定星期幾的日期（1 = 週一；今天即符合則回傳今天） */
export function nextDateForWeekday(dayOfWeek: number): string {
  const d = new Date()
  d.setDate(d.getDate() + ((dayOfWeek - d.getDay() + 7) % 7))
  return toLocalDateStr(d)
}

/** 'YYYY-MM-DD' 是星期幾（0 = 週日），以本地時區解析 */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDay()
}
