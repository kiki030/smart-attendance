import type { ScheduleEntry } from '../types'
import { WEEKDAY_LABELS, parsePeriodRange } from '../types'

interface Props {
  entries: ScheduleEntry[]
}

const DAYS = [1, 2, 3, 4, 5]

/** 週一至週五 × 節次 的課表格，連續節次以 rowSpan 合併顯示 */
export default function ScheduleGrid({ entries }: Props) {
  const parsed = entries.map(e => ({
    ...e,
    range: parsePeriodRange(e.period),
  }))

  const maxPeriod = Math.max(8, ...parsed.map(e => e.range.end))
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1)

  function entryAt(day: number, period: number) {
    return parsed.find(e => e.day_of_week === day && e.range.start <= period && period <= e.range.end)
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="schedule-grid">
        <thead>
          <tr>
            <th style={{ width: 68 }}>節次</th>
            {DAYS.map(d => <th key={d}>{WEEKDAY_LABELS[d]}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map(p => (
            <tr key={p}>
              <td className="period-label">第 {p} 節</td>
              {DAYS.map(d => {
                const entry = entryAt(d, p)
                if (!entry) return <td key={d} className="slot-empty" />
                if (entry.range.start !== p) return null // 已被上方儲存格 rowSpan 覆蓋
                return (
                  <td
                    key={d}
                    className="schedule-cell"
                    rowSpan={entry.range.end - entry.range.start + 1}
                  >
                    <div className="schedule-cell-name">{entry.course_name}</div>
                    {entry.room && <div className="schedule-cell-meta">📍 {entry.room}</div>}
                    {entry.course_id && <div className="schedule-cell-code">{entry.course_id}</div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
