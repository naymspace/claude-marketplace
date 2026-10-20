import { HOUR, clip, hm, merge, pad, shortProject } from './model'
import type { Range, Span } from './model'

export const PALETTE = ['#1D9E75', '#7F77DD', '#D85A30', '#378ADD', '#D4537E', '#BA7517']
const NOW = '#ECEAE6'
const MUTED = '#888780'
const FONT = 'font-family="system-ui, sans-serif" font-size="13"'
const CHAR_PX = 8

export type Colors = Readonly<Record<string, number>>

export const assignColors = (known: Colors, projects: readonly string[]): Colors => {
  const colors: Record<string, number> = { ...known }
  for (const project of projects) {
    if (project in colors) continue
    const uses = PALETTE.map((_, i) => Object.values(colors).filter(used => used === i).length)
    colors[project] = uses.indexOf(Math.min(...uses))
  }
  return colors
}

export const colorOf = (colors: Colors, project: string): string => PALETTE[(colors[project] ?? 0) % PALETTE.length]!

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export const parallelRanges = (spans: readonly Span[], from: number, to: number): Range[] => {
  const sessions = new Map<string, Span[]>()
  for (const span of spans) {
    if (span.kind === 'writing') continue
    sessions.set(span.session, [...(sessions.get(span.session) ?? []), span])
  }
  const steps = [...sessions.values()]
    .flatMap(list => merge(clip(list, from, to)))
    .flatMap(([start, end]): Range[] => [
      [start, 1],
      [end, -1],
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const ranges: Range[] = []
  let active = 0
  let since = 0
  for (const [t, step] of steps) {
    if (active === 1 && step === 1) since = t
    if (active === 2 && step === -1 && t > since) ranges.push([since, t])
    active += step
  }
  return merge(ranges)
}

export type ChartRow = { project: string; name: string; color: string }

type Chart = { source: string; width: number; height: number }

const chart = (width: number, height: number, parts: readonly string[]): Chart => ({
  source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`,
  width,
  height,
})

const clock = (t: number) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const floorHour = (t: number) => {
  const d = new Date(t)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

const LABEL_GAP = 8
const ROW = 30

export const timelineSvg = ({
  spans,
  rows,
  from,
  to,
  now,
  width,
}: {
  spans: readonly Span[]
  rows: readonly ChartRow[]
  from: number
  to: number
  now: number
  width: number
}): Chart => {
  const shown = clip(spans, from, to)
  const isToday = now >= from && now < to
  const first = Math.min(...shown.map(([start]) => start), isToday ? now : to)
  const last = Math.max(...shown.map(([, end]) => end), isToday ? now : from)
  const start = floorHour(first)
  const end = Math.max(floorHour(last) + HOUR, start + HOUR)
  const parallel = parallelRanges(spans, from, to)
  const longest = Math.max(0, ...rows.map(row => row.name.length), parallel.length > 0 ? 'parallel'.length : 0)
  const labelWidth = Math.round(Math.min(140, width * 0.4, longest * CHAR_PX + LABEL_GAP))
  const fit = (text: string) =>
    text.length * CHAR_PX + LABEL_GAP <= labelWidth ? text : `${text.slice(0, Math.max(1, Math.floor((labelWidth - LABEL_GAP) / CHAR_PX) - 1))}…`
  const plot = width - labelWidth - LABEL_GAP - 12
  const x = (t: number) => labelWidth + LABEL_GAP + ((t - start) / (end - start)) * plot
  const w = ([a, b]: Range) => Math.max(1, x(b) - x(a))
  const height = 20 + rows.length * ROW + (parallel.length > 0 ? ROW : 0) + 4
  const hours = (end - start) / HOUR
  const every = Math.max(1, Math.ceil(hours / Math.max(1, Math.floor(plot / 48))))
  const parts: string[] = []
  for (let h = 0; h <= hours; h += every) {
    const t = start + h * HOUR
    parts.push(
      `<line x1="${x(t)}" y1="16" x2="${x(t)}" y2="${height - 4}" stroke="${MUTED}" stroke-opacity="0.25"/>`,
      `<text x="${x(t)}" y="11" text-anchor="middle" fill="${MUTED}" ${FONT}>${clock(t).slice(0, 2)}</text>`,
    )
  }
  rows.forEach((row, i) => {
    const y = 20 + i * ROW
    const color = row.color
    const name = escapeXml(row.name)
    parts.push(`<text x="${labelWidth}" y="${y + 15}" text-anchor="end" fill="${color}" ${FONT}>${escapeXml(fit(row.name))}</text>`)
    const own = spans.filter(s => s.project === row.project)
    for (const [kind, top, h, opacity, what] of [
      ['selected', y + 5, 12, 1, 'aktiv'],
      ['claude', y + 19, 6, 0.65, 'Claude'],
    ] as const) {
      for (const range of merge(clip(own.filter(s => s.kind === kind), start, end))) {
        parts.push(
          `<rect x="${x(range[0])}" y="${top}" width="${w(range)}" height="${h}" rx="2" fill="${color}" fill-opacity="${opacity}">` +
            `<title>${name} · ${what} ${clock(range[0])}–${clock(range[1])} (${hm(range[1] - range[0])})</title></rect>`,
        )
      }
    }
  })
  if (parallel.length > 0) {
    const y = 20 + rows.length * ROW
    parts.push(`<text x="${labelWidth}" y="${y + 15}" text-anchor="end" fill="${MUTED}" ${FONT}>parallel</text>`)
    for (const range of parallel) {
      parts.push(
        `<rect x="${x(range[0])}" y="${y + 7}" width="${w(range)}" height="10" rx="2" fill="${MUTED}" fill-opacity="0.9">` +
          `<title>parallel ${clock(range[0])}–${clock(range[1])} (${hm(range[1] - range[0])})</title></rect>`,
      )
    }
  }
  if (isToday) {
    parts.push(
      `<line x1="${x(now)}" y1="14" x2="${x(now)}" y2="${height - 2}" stroke="${NOW}" stroke-width="2">` +
        `<animate attributeName="stroke-opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>` +
        `<title>jetzt ${clock(now)}</title></line>`,
    )
  }
  return chart(width, height, parts)
}

export type ChartDay = { labels: readonly string[]; isMonday: boolean; target: number; byProject: readonly (readonly [string, number])[] }

export const barsSvg = ({ days, rows, width }: { days: readonly ChartDay[]; rows: readonly ChartRow[]; width: number }): Chart => {
  const height = 200
  const top = 24
  const bottom = height - 22
  const totals = days.map(day => day.byProject.reduce((sum, [, ms]) => sum + ms, 0))
  const maxHours = Math.max(1, Math.ceil(Math.max(...totals, ...days.map(day => day.target), 0) / HOUR))
  const y = (ms: number) => bottom - (ms / (maxHours * HOUR)) * (bottom - top)
  const left = 28
  const slot = (width - left - 8) / Math.max(1, days.length)
  const barWidth = Math.max(4, Math.min(40, slot * 0.6))
  const order = new Map(rows.map((row, i) => [row.project, i]))
  const colors = new Map(rows.map(row => [row.project, row.color]))
  const step = Math.max(1, Math.ceil(maxHours / 4))
  const parts: string[] = []
  for (let h = 0; h <= maxHours; h += step) {
    parts.push(
      `<line x1="${left}" y1="${y(h * HOUR)}" x2="${width - 8}" y2="${y(h * HOUR)}" stroke="${MUTED}" stroke-opacity="0.25"/>`,
      `<text x="${left - 6}" y="${y(h * HOUR) + 4}" text-anchor="end" fill="${MUTED}" ${FONT}>${h}</text>`,
    )
  }
  days.forEach((day, i) => {
    const cx = left + slot * i + slot / 2
    const x0 = cx - barWidth / 2
    let reach = 0
    for (const [project, ms] of [...day.byProject].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))) {
      if (ms <= 0) continue
      const name = escapeXml(rows.find(row => row.project === project)?.name ?? shortProject(project))
      parts.push(
        `<rect x="${x0}" y="${y(reach + ms)}" width="${barWidth}" height="${y(reach) - y(reach + ms)}" fill="${colors.get(project) ?? MUTED}">` +
          `<title>${escapeXml(day.labels[0]!)} · ${name} ${hm(ms)}</title></rect>`,
      )
      reach += ms
    }
    if (day.target > 0) {
      parts.push(
        `<line x1="${x0 - 3}" y1="${y(day.target)}" x2="${x0 + barWidth + 3}" y2="${y(day.target)}" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="3 2">` +
          `<title>Soll ${hm(day.target)}</title></line>`,
      )
    }
    if (totals[i]! > 0 && slot >= 30) {
      const above = y(totals[i]!) - 7
      const isOnTarget = day.target > totals[i]! && above - y(day.target) < 16
      parts.push(`<text x="${cx}" y="${isOnTarget ? y(day.target) - 7 : above}" text-anchor="middle" fill="${MUTED}" ${FONT}>${hm(totals[i]!)}</text>`)
    }
    const label = day.labels.find(text => slot >= text.length * CHAR_PX + 8) ?? day.labels.at(-1)!
    const isRoomy = slot >= label.length * CHAR_PX + 8
    if (isRoomy || day.isMonday) {
      parts.push(`<text x="${cx}" y="${height - 6}" text-anchor="middle" fill="${MUTED}" ${FONT}>${escapeXml(label)}</text>`)
    }
  })
  return chart(width, height, parts)
}
