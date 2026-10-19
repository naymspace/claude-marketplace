import { EVENT_TYPES, mondayIndex, pad } from './model'
import type { ZeitEvent } from './model'

export type Fs = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other' }[]>
  exists: (path: string) => Promise<boolean>
}

const DAY_START_HOUR = 4

const workDate = (t: number): Date => {
  const d = new Date(t)
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1)
  return d
}

export const dayKey = (t: number): string => {
  const d = workDate(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const dayStart = (t: number): number => {
  const d = workDate(t)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  return d.getTime()
}

export const addDays = (t: number, days: number): number => {
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export const weekStart = (t: number): number => {
  const start = dayStart(t)
  return addDays(start, -mondayIndex(start))
}

export const monthStart = (t: number): number => {
  const d = new Date(dayStart(t))
  d.setDate(1)
  return d.getTime()
}

export const daysBetween = (from: number, to: number): string[] => {
  const days: string[] = []
  for (let t = dayStart(from); t < to; t = addDays(t, 1)) days.push(dayKey(t))
  return days
}

const toLine = (event: ZeitEvent): string => JSON.stringify({ ...event, t: new Date(event.t).toISOString() })

const fromLine = (line: string): ZeitEvent | null => {
  try {
    const raw = JSON.parse(line)
    const t = Date.parse(raw.t)
    if (Number.isNaN(t) || !EVENT_TYPES.includes(raw.type) || typeof raw.project !== 'string' || typeof raw.session !== 'string') {
      return null
    }
    return { ...raw, t }
  } catch {
    return null
  }
}

export class SessionLog {
  private day = ''
  private lines: string[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly fs: Fs,
    private readonly dir: string,
    private readonly session: string,
  ) {}

  append(event: ZeitEvent): Promise<void> {
    const run = this.queue.then(() => this.write(event))
    this.queue = run.catch(() => {})
    return run
  }

  private async write(event: ZeitEvent): Promise<void> {
    const day = dayKey(event.t)
    const path = `${this.dir}/${day}/${this.session}.jsonl`
    if (day !== this.day) {
      const lines = (await this.fs.exists(path)) ? (await this.fs.read(path)).split('\n').filter(Boolean) : []
      this.lines = lines
      this.day = day
    }
    this.lines.push(toLine(event))
    await this.fs.write(path, this.lines.join('\n') + '\n')
  }
}

export const loadDays = async (fs: Fs, dir: string, days: readonly string[]): Promise<ZeitEvent[]> => {
  const events: ZeitEvent[] = []
  for (const day of days) {
    const folder = `${dir}/${day}`
    if (!(await fs.exists(folder))) continue
    for (const entry of await fs.list(folder)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.jsonl')) continue
      for (const line of (await fs.read(`${folder}/${entry.name}`)).split('\n')) {
        const event = line.trim() ? fromLine(line) : null
        if (event) events.push(event)
      }
    }
  }
  return events
}
