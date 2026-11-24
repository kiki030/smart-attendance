import type { ScheduleEntry } from '../types'
import { parsePeriodRange } from '../types'

/** 南台科大節次對照時間表（僅在課表資料本身不含時間，例如展示模式時作為備援） */
const FALLBACK_PERIOD_TIMES: Record<number, [string, string]> = {
  1: ['08:10', '09:00'],
  2: ['09:10', '10:00'],
  3: ['10:10', '11:00'],
  4: ['11:10', '12:00'],
  5: ['12:50', '13:40'],
  6: ['13:50', '14:40'],
  7: ['14:50', '15:40'],
  8: ['15:50', '16:40'],
  9: ['16:50', '17:40'],
  // 第 10 節為空白列（無課）
  11: ['18:20', '19:05'],
  12: ['19:05', '19:50'],
  13: ['20:00', '20:45'],
  14: ['20:45', '21:30'],
}

const TIME_RE = /(\d{1,2}):(\d{2})\s*[~～\-–]\s*(\d{1,2}):(\d{2})/

const pad = (s: string) => s.padStart(2, '0')

/** 合併後的課程區塊（同一門課的連續節次合為一筆） */
export interface MergedCourse extends ScheduleEntry {
  startPeriod: number
  endPeriod: number
  startTime: string // 'HH:MM'
  endTime: string   // 'HH:MM'（該門課最終下課時間）
}

function timesOf(entry: ScheduleEntry, start: number, end: number): [string, string] {
  const m = (entry.period || '').match(TIME_RE)
  if (m) return [`${pad(m[1])}:${m[2]}`, `${pad(m[3])}:${m[4]}`]
  const s = FALLBACK_PERIOD_TIMES[start]?.[0] ?? ''
  const e = FALLBACK_PERIOD_TIMES[end]?.[1] ?? ''
  return [s, e]
}

/** 例如：「第2~4節 (09:10~12:00)」 */
export function formatMergedPeriod(start: number, end: number, startTime: string, endTime: string): string {
  const label = start === end ? `第${start}節` : `第${start}~${end}節`
  return startTime && endTime ? `${label} (${startTime}~${endTime})` : label
}

/** 將同一天、同一門課的連續節次合併成單一區塊，並取出最終下課時間 */
export function mergeSchedule(entries: ScheduleEntry[]): MergedCourse[] {
  const items = entries
    .map(e => {
      const { start, end } = parsePeriodRange(e.period)
      const [st, et] = timesOf(e, start, end)
      return { e, start, end, st, et }
    })
    .sort((a, b) => a.e.day_of_week - b.e.day_of_week || a.start - b.start)

  const merged: MergedCourse[] = []
  for (const it of items) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.day_of_week === it.e.day_of_week &&
      last.course_name === it.e.course_name &&
      it.start <= last.endPeriod + 1
    ) {
      if (it.end > last.endPeriod) {
        last.endPeriod = it.end
        last.endTime = it.et || last.endTime
      }
      last.period = formatMergedPeriod(last.startPeriod, last.endPeriod, last.startTime, last.endTime)
      continue
    }
    merged.push({
      ...it.e,
      startPeriod: it.start,
      endPeriod: it.end,
      startTime: it.st,
      endTime: it.et,
      period: formatMergedPeriod(it.start, it.end, it.st, it.et),
    })
  }
  return merged
}

/** 今天是星期幾（1 = 週一 … 7 = 週日），與 user_schedules.day_of_week 一致 */
export function todayDayOfWeek(now: Date = new Date()): number {
  return now.getDay() === 0 ? 7 : now.getDay()
}

/** 'HH:MM' 轉為今日的 Date；格式不合時回傳 null */
export function timeToDate(hhmm: string, base: Date = new Date()): Date | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const d = new Date(base)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d
}

/** 課名比對用：去除所有空白後比較 */
export const normalizeCourseName = (s?: string | null) => (s ?? '').replace(/\s+/g, '')
