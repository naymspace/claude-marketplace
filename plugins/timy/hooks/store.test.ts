import { describe, expect, test } from 'claude-code/testing'

import type { ZeitEvent } from './model'
import { addDays, dayKey, dayStart, daysBetween, loadDays, monthStart, SessionLog, weekStart } from './store'
import type { Fs } from './store'

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()

const memoryFs = (files: Record<string, string> = {}) => {
  const fs: Fs = {
    read: async path => files[path] ?? '',
    write: async (path, text) => {
      files[path] = text
    },
    exists: async path => path in files || Object.keys(files).some(f => f.startsWith(path + '/')),
    list: async path =>
      Object.keys(files)
        .filter(f => f.startsWith(path + '/') && !f.slice(path.length + 1).includes('/'))
        .map(f => ({ name: f.slice(path.length + 1), kind: 'file' as const })),
  }
  return { fs, files }
}

const event = (t: number, session = 's1'): ZeitEvent => ({ t, type: 'submit', project: 'beispiel/shop', session })

const tick = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve()
}

const slow = (fs: Fs): Fs => ({
  ...fs,
  exists: async path => {
    await tick()
    return fs.exists(path)
  },
  read: async path => {
    await tick()
    return fs.read(path)
  },
})

describe('dates', () => {
  test('a day runs from 4:00 to 4:00 local time', () => {
    expect(dayKey(at(15, 4, 0))).toBe('2026-10-15')
    expect(dayKey(at(16, 0, 30))).toBe('2026-10-15')
    expect(dayKey(at(16, 3, 59))).toBe('2026-10-15')
    expect(dayKey(at(16, 4, 0))).toBe('2026-10-16')
    expect(dayStart(at(16, 2, 0))).toBe(at(15, 4, 0))
  })

  test('the early hours of a Monday still belong to the week before', () => {
    expect(dayKey(weekStart(at(12, 2)))).toBe('2026-10-05')
    expect(weekStart(at(12, 5))).toBe(at(12, 4))
  })

  test('weekStart is Monday, monthStart the first', () => {
    expect(dayKey(weekStart(at(15, 12)))).toBe('2026-10-12')
    expect(dayKey(monthStart(at(15, 12)))).toBe('2026-10-01')
  })

  test('daysBetween lists each day once', () => {
    expect(daysBetween(at(12, 4), addDays(at(12, 4), 3))).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])
  })
})

describe('SessionLog', () => {
  test('writes one line per event into the day file', async () => {
    const { fs, files } = memoryFs()
    const log = new SessionLog(fs, '/data', 's1')
    await log.append(event(at(15, 10)))
    await log.append(event(at(15, 11)))
    const lines = files['/data/2026-10-15/s1.jsonl']?.trim().split('\n') ?? []
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ type: 'submit', project: 'beispiel/shop', session: 's1' })
  })

  test('starts a new file at 4:00', async () => {
    const { fs, files } = memoryFs()
    const log = new SessionLog(fs, '/data', 's1')
    await log.append(event(at(16, 3, 59)))
    await log.append(event(at(16, 4, 1)))
    expect(files['/data/2026-10-15/s1.jsonl']?.trim().split('\n')).toHaveLength(1)
    expect(files['/data/2026-10-16/s1.jsonl']?.trim().split('\n')).toHaveLength(1)
  })

  test('continues an existing day file', async () => {
    const { fs, files } = memoryFs({
      '/data/2026-10-15/s1.jsonl': JSON.stringify({ ...event(at(15, 9)), t: new Date(at(15, 9)).toISOString() }) + '\n',
    })
    const log = new SessionLog(fs, '/data', 's1')
    await log.append(event(at(15, 10)))
    expect(files['/data/2026-10-15/s1.jsonl']?.trim().split('\n')).toHaveLength(2)
  })

  test('concurrent appends keep every line in order', async () => {
    const { fs, files } = memoryFs()
    const log = new SessionLog(slow(fs), '/data', 's1')
    const a = log.append(event(at(15, 10)))
    const b = log.append(event(at(15, 11)))
    await Promise.all([a, b])
    const times = (files['/data/2026-10-15/s1.jsonl']?.trim().split('\n') ?? []).map(line => JSON.parse(line).t)
    expect(times).toEqual([new Date(at(15, 10)).toISOString(), new Date(at(15, 11)).toISOString()])
  })

  test('a failed first load does not overwrite the day file', async () => {
    const existing = JSON.stringify({ ...event(at(15, 9)), t: new Date(at(15, 9)).toISOString() }) + '\n'
    const { fs, files } = memoryFs({ '/data/2026-10-15/s1.jsonl': existing })
    let failNext = true
    const flaky: Fs = {
      ...fs,
      read: async path => {
        if (failNext) {
          failNext = false
          throw new Error('read failed')
        }
        return fs.read(path)
      },
    }
    const log = new SessionLog(flaky, '/data', 's1')
    let rejected = false
    await log.append(event(at(15, 10))).catch(() => {
      rejected = true
    })
    expect(rejected).toBe(true)
    await log.append(event(at(15, 11)))
    expect(files['/data/2026-10-15/s1.jsonl']?.trim().split('\n')).toHaveLength(2)
  })
})

describe('loadDays', () => {
  test('reads every session file of the days and skips broken lines', async () => {
    const line = (t: number, session: string) => JSON.stringify({ ...event(t, session), t: new Date(t).toISOString() })
    const { fs } = memoryFs({
      '/data/2026-10-15/a.jsonl': line(at(15, 9), 'a') + '\nnot json\n',
      '/data/2026-10-15/b.jsonl': line(at(15, 10), 'b') + '\n',
      '/data/2026-10-16/a.jsonl': line(at(16, 9), 'a') + '\n',
    })
    const events = await loadDays(fs, '/data', ['2026-10-15', '2026-10-14'])
    expect(events.map(e => e.session).sort()).toEqual(['a', 'b'])
    expect(typeof events[0]?.t).toBe('number')
  })

  test('drops lines with an unknown type or no session', async () => {
    const t = new Date(at(15, 9)).toISOString()
    const valid = JSON.stringify({ ...event(at(15, 9)), t })
    const bogus = JSON.stringify({ ...event(at(15, 9)), t, type: 'bogus' })
    const noSession = JSON.stringify({ t, type: 'submit', project: 'beispiel/shop' })
    const { fs } = memoryFs({ '/data/2026-10-15/s1.jsonl': [valid, bogus, noSession].join('\n') + '\n' })
    const events = await loadDays(fs, '/data', ['2026-10-15'])
    expect(events).toHaveLength(1)
  })
})
