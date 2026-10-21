export const EVENT_TYPES = ['attach', 'detach', 'edit', 'submit', 'turn-start', 'turn-end', 'claude'] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type TimyEvent = { t: number; type: EventType; project: string; session: string; title?: string; branch?: string; ranges?: Range[] }

type Kind = 'selected' | 'writing' | 'claude'

export type Span = { kind: Kind; project: string; session: string; start: number; end: number }

export const NO_PROJECT = 'ohne Projekt'

export const HOUR = 3_600_000

export const pad = (n: number): string => String(n).padStart(2, '0')

export const mondayIndex = (t: number): number => (new Date(t).getDay() + 6) % 7

export type Range = [number, number]

export const merge = (ranges: readonly Range[]): Range[] => {
  const merged: Range[] = []
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

export const clip = (spans: readonly Span[], from: number, to: number): Range[] =>
  spans.map((s): Range => [Math.max(s.start, from), Math.min(s.end, to)]).filter(([start, end]) => end > start)

const WRITING_GAP_MS = 30_000
const EDIT_SLICE_MS = 10_000
const OPEN_CAP_MS = 2 * HOUR

export const sessionSpans = (events: readonly TimyEvent[], idleMs: number, now: number): Span[] => {
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const last = sorted.at(-1)
  if (last === undefined) return []

  const { project, session } = last
  const closeAt = Math.min(now, last.t + OPEN_CAP_MS)
  const spans: Span[] = []
  const add = (kind: Kind, start: number, end: number) => {
    if (end > start) spans.push({ kind, project, session, start, end })
  }

  const work = sorted.flatMap(event => (event.type === 'claude' ? (event.ranges ?? []) : []))
  for (const [start, end] of merge(work)) add('claude', start, end)
  const hasWork = sorted.some(event => event.type === 'claude')

  let turnStart: number | null = null
  let attached = false
  let lastActivity: number | null = null
  let phaseStart: number | null = null
  let lastTyping = 0

  const closeSelected = (until: number) => {
    if (lastActivity !== null) add('selected', lastActivity, Math.min(until, lastActivity + idleMs))
  }

  for (const event of sorted) {
    if (event.type === 'turn-start' && turnStart === null && !hasWork) turnStart = event.t
    if (event.type === 'turn-end' && turnStart !== null) {
      add('claude', turnStart, Math.min(event.t, turnStart + OPEN_CAP_MS))
      turnStart = null
    }

    if (event.type === 'edit' || event.type === 'submit') {
      if (phaseStart !== null && event.t - lastTyping > WRITING_GAP_MS) {
        add('writing', phaseStart, lastTyping + EDIT_SLICE_MS)
        phaseStart = null
      }
      if (phaseStart === null) phaseStart = event.t
      lastTyping = event.t
    }

    if (event.type === 'detach') {
      if (attached) closeSelected(event.t)
      attached = false
      lastActivity = null
      continue
    }

    if (event.type !== 'attach' && event.type !== 'edit' && event.type !== 'submit') continue

    if (attached) closeSelected(event.t)
    attached = true
    lastActivity = event.t
  }

  if (turnStart !== null) add('claude', turnStart, Math.min(closeAt, turnStart + OPEN_CAP_MS))
  if (phaseStart !== null) add('writing', phaseStart, Math.min(lastTyping + EDIT_SLICE_MS, closeAt))
  if (attached) closeSelected(now)

  return spans
}

export const sessionState = (
  events: readonly TimyEvent[],
  idleMs: number,
  now: number,
  from: number,
): { selected: number; isCounting: boolean } => {
  const selected = sessionSpans(events, idleMs, now).filter(span => span.kind === 'selected')
  return {
    selected: selected.reduce((sum, span) => sum + Math.max(0, span.end - Math.max(span.start, from)), 0),
    isCounting: selected.some(span => span.end === now),
  }
}

export const unionLength = (spans: readonly Span[], kind: Kind, from: number, to: number): number =>
  merge(clip(spans.filter(span => span.kind === kind), from, to)).reduce((sum, [start, end]) => sum + end - start, 0)

export const allSpans = (events: readonly TimyEvent[], idleMs: number, now: number): Span[] => {
  const bySession = new Map<string, TimyEvent[]>()
  for (const event of events) {
    const list = bySession.get(event.session) ?? []
    list.push(event)
    bySession.set(event.session, list)
  }
  return [...bySession.values()].flatMap(list => sessionSpans(list, idleMs, now))
}

type ProjectRow = {
  project: string
  selected: number
  writing: number
  claude: number
  sessions: { session: string; label: string; selected: number; writing: number; claude: number }[]
}

export type Summary = { rows: ProjectRow[] }

export const sessionLabels = (events: readonly TimyEvent[]): Map<string, string> => {
  const titles = new Map<string, string>()
  const branches = new Map<string, string>()
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    if (event.title) titles.set(event.session, event.title)
    if (event.branch) branches.set(event.session, event.branch)
  }
  const sessions = new Set(events.map(event => event.session))
  return new Map([...sessions].map(session => [session, titles.get(session) ?? branches.get(session) ?? '']))
}

export const summarize = (
  spans: readonly Span[],
  labels: ReadonlyMap<string, string>,
  from: number,
  to: number,
): Summary => {
  const rows = new Map<string, ProjectRow>()

  for (const span of spans) {
    const length = Math.min(span.end, to) - Math.max(span.start, from)
    if (length <= 0) continue
    const row = rows.get(span.project) ?? { project: span.project, selected: 0, writing: 0, claude: 0, sessions: [] }
    row[span.kind] += length
    const entry =
      row.sessions.find(s => s.session === span.session) ??
      row.sessions[row.sessions.push({ session: span.session, label: labels.get(span.session) ?? '', selected: 0, writing: 0, claude: 0 }) - 1]!
    entry[span.kind] += length
    rows.set(span.project, row)
  }

  return { rows: [...rows.values()].sort((a, b) => b.selected - a.selected) }
}

export const planPercent = (actual: number, planned: number): number => (planned > 0 ? Math.round((actual / planned) * 100) : 0)

export const fillColor = (actual: number, planned: number): 'success' | 'warning' | 'error' =>
  actual <= planned ? 'success' : actual <= planned * 1.1 ? 'warning' : 'error'


export const planFilled = (actual: number, planned: number, width: number): number =>
  planned > 0 ? Math.min(width, Math.round((actual / planned) * width)) : 0

export const dayTarget = (hoursPerWeekday: string, t: number): number => {
  const field = hoursPerWeekday.split(',')[mondayIndex(t)]?.trim() ?? ''
  const hours = /^\d+(\.\d+)?$/.test(field) ? Number(field) : 0
  return hours * HOUR
}

const wholeMinutes = (ms: number): number => Math.round(ms / 60_000)

export const displayedTotal = (rows: readonly ProjectRow[], kind: Kind): number =>
  rows.reduce((sum, row) => sum + wholeMinutes(row[kind]), 0) * 60_000

export const hm = (ms: number): string => {
  const minutes = wholeMinutes(ms)
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

export const hms = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

const remotePath = (remote: string): string | null => {
  const url = remote.trim().match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i)
  if (url) {
    if (url[1]?.toLowerCase() === 'file') return null
    const hostAndPath = (url[2] ?? '').replace(/^.*@/, '')
    const slash = hostAndPath.indexOf('/')
    return slash < 0 ? null : hostAndPath.slice(slash + 1)
  }
  const scp = remote.trim().replace(/^.*@/, '').match(/^[^:/]+:(.+)$/)
  return scp?.[1] ?? null
}

export const projectName = (remote: string | null, root: string | null): string => {
  const path = remote ? remotePath(remote.replace(/[?#].*$/s, ''))?.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '') : null
  if (path && !path.includes('://')) return path
  return root?.split('/').filter(Boolean).at(-1) ?? NO_PROJECT
}

export const shortProject = (project: string): string => project.split('/').at(-1) ?? project
