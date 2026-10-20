import { describe, expect, test } from 'claude-code/testing'

import { PALETTE, barsSvg as barsChart, colorsFor, parallelRanges, timelineSvg as timelineChart } from './charts'
import { HOUR } from './model'
import type { Span } from './model'
import { dayLabels } from './period'

const at = (h: number, m: number) => new Date(2026, 9, 16, h, m).getTime()
const span = (kind: Span['kind'], session: string, start: number, end: number, project = 'beispiel/shop'): Span => ({
  kind,
  session,
  project,
  start,
  end,
})

const timelineSvg = (input: Parameters<typeof timelineChart>[0]) => timelineChart(input).source
const barsSvg = (input: Parameters<typeof barsChart>[0]) => barsChart(input).source

const rects = (svg: string) => [...svg.matchAll(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"/g)].map((m): [number, number] => [Number(m[1]), Number(m[2])])

describe('parallelRanges', () => {
  test('marks where two sessions are active at once', () => {
    const spans = [span('selected', 'a', at(9, 0), at(10, 0)), span('claude', 'b', at(9, 30), at(11, 0))]
    expect(parallelRanges(spans, at(4, 0), at(23, 0))).toEqual([[at(9, 30), at(10, 0)]])
  })

  test('one session overlapping itself is not parallel', () => {
    const spans = [span('selected', 'a', at(9, 0), at(10, 0)), span('claude', 'a', at(9, 30), at(11, 0))]
    expect(parallelRanges(spans, at(4, 0), at(23, 0))).toEqual([])
  })

  test('one session ending as the next starts is not parallel', () => {
    const spans = [span('selected', 'a', at(9, 0), at(10, 0)), span('selected', 'b', at(10, 0), at(11, 0))]
    expect(parallelRanges(spans, at(4, 0), at(23, 0))).toEqual([])
  })

  test('writing alone does not count', () => {
    const spans = [span('writing', 'a', at(9, 0), at(10, 0)), span('selected', 'b', at(9, 0), at(10, 0))]
    expect(parallelRanges(spans, at(4, 0), at(23, 0))).toEqual([])
  })

  test('three sessions give one merged range', () => {
    const spans = [
      span('selected', 'a', at(9, 0), at(12, 0)),
      span('claude', 'b', at(9, 30), at(10, 30)),
      span('claude', 'c', at(10, 0), at(11, 0)),
    ]
    expect(parallelRanges(spans, at(4, 0), at(23, 0))).toEqual([[at(9, 30), at(11, 0)]])
  })
})

const withColors = (rows: readonly { project: string; name: string }[]) => {
  const colors = colorsFor(rows.map(row => row.project))
  return rows.map(row => ({ ...row, color: colors.get(row.project)! }))
}

describe('timelineSvg', () => {
  const rows = withColors([
    { project: 'beispiel/shop', name: 'shop' },
    { project: 'beispiel/blog', name: 'blog' },
  ])
  const spans = [
    span('selected', 'a', at(9, 15), at(10, 0)),
    span('claude', 'a', at(9, 20), at(9, 40)),
    span('selected', 'b', at(10, 0), at(11, 30), 'beispiel/blog'),
  ]
  const svg = timelineSvg({ spans, rows, from: at(4, 0), to: at(4, 0) + 24 * HOUR, now: at(11, 45), width: 600 })

  test('spans the worked hours up to now', () => {
    expect(svg).toContain('>09</text>')
    expect(svg).toContain('>12</text>')
    expect(svg).not.toContain('>08</text>')
  })

  test('draws each project in its own colour with a tooltip', () => {
    expect(svg).toContain(`fill="${rows[0]!.color}" fill-opacity="1"><title>shop · aktiv 09:15–10:00 (0:45)</title>`)
    expect(svg).toContain(`fill="${rows[0]!.color}" fill-opacity="0.65"><title>shop · Claude 09:20–09:40 (0:20)</title>`)
    expect(svg).toContain(`fill="${rows[1]!.color}" fill-opacity="1"><title>blog · aktiv 10:00–11:30 (1:30)</title>`)
  })

  test('marks now with a pulsing line', () => {
    expect(svg).toContain('<animate attributeName="stroke-opacity"')
    expect(svg).toContain('<title>jetzt 11:45</title>')
  })

  test('a past day has no now line', () => {
    const past = timelineSvg({ spans, rows, from: at(4, 0) - 24 * HOUR, to: at(4, 0), now: at(11, 45), width: 600 })
    expect(past).not.toContain('jetzt')
  })

  test('stays inside its width', () => {
    for (const [x, w] of rects(svg)) expect(x + w).toBeLessThanOrEqual(600)
  })

  test('adds a parallel row only when sessions overlap', () => {
    expect(svg).not.toContain('>parallel</text>')
    const both = timelineSvg({
      spans: [...spans, span('claude', 'a', at(10, 0), at(10, 20))],
      rows,
      from: at(4, 0),
      to: at(4, 0) + 24 * HOUR,
      now: at(11, 45),
      width: 600,
    })
    expect(both).toContain('<title>parallel 10:00–10:20 (0:20)</title>')
  })

  const labelX = (svg: string, name: string) => Number(svg.match(new RegExp(`<text x="(\\d+)"[^>]*>${name}</text>`))?.[1])

  test('the label column fits the longest name in a narrow pane', () => {
    const narrow = timelineSvg({
      spans: [span('selected', 'a', at(9, 0), at(10, 0), '')],
      rows: withColors([{ project: '', name: 'ohne Projekt' }]),
      from: at(4, 0),
      to: at(4, 0) + 24 * HOUR,
      now: at(11, 0),
      width: 320,
    })
    expect(labelX(narrow, 'ohne Projekt')).toBeGreaterThanOrEqual('ohne Projekt'.length * 8)
  })

  test('a name too long for the column is cut with an ellipsis', () => {
    const tight = timelineSvg({
      spans: [span('selected', 'a', at(9, 0), at(10, 0), 'x/y')],
      rows: withColors([{ project: 'x/y', name: 'ein sehr langer Projektname' }]),
      from: at(4, 0),
      to: at(4, 0) + 24 * HOUR,
      now: at(11, 0),
      width: 240,
    })
    const [, x, label] = tight.match(/<text x="(\d+)"[^>]*>([^<]*…)<\/text>/) ?? []
    expect(label?.length).toBeLessThanOrEqual(Number(x) / 8)
    expect(tight).toContain('<title>ein sehr langer Projektname · aktiv')
  })

  test('escapes project names', () => {
    const odd = timelineSvg({
      spans: [span('selected', 'a', at(9, 0), at(10, 0), 'x/<b>&')],
      rows: withColors([{ project: 'x/<b>&', name: '<b>&' }]),
      from: at(4, 0),
      to: at(4, 0) + 24 * HOUR,
      now: at(11, 0),
      width: 400,
    })
    expect(odd).toContain('&lt;b&gt;&amp;')
    expect(odd).not.toContain('<b>')
  })
})

describe('barsSvg', () => {
  const rows = withColors([
    { project: 'beispiel/shop', name: 'shop' },
    { project: 'beispiel/blog', name: 'blog' },
  ])
  const days = [
    { labels: ['Mo 12.10.', 'Mo 12.', '12'], target: 6 * HOUR, byProject: [['beispiel/shop', 2 * HOUR], ['beispiel/blog', 3 * HOUR]] as const },
    { labels: ['Di 13.10.', 'Di 13.', '13'], target: 6 * HOUR, byProject: [] },
  ]

  test('stacks projects per day in the timeline colours', () => {
    const svg = barsSvg({ days, rows, width: 600 })
    expect(svg).toContain(`fill="${rows[0]!.color}"><title>Mo 12.10. · shop 2:00</title>`)
    expect(svg).toContain(`fill="${rows[1]!.color}"><title>Mo 12.10. · blog 3:00</title>`)
  })

  test('shows the day target as a dashed line', () => {
    expect(barsSvg({ days, rows, width: 600 }).match(/<title>Soll 6:00<\/title>/g)).toHaveLength(2)
  })

  test('writes the day total above a wide bar', () => {
    expect(barsSvg({ days, rows, width: 600 })).toContain('>5:00</text>')
  })

  test('a narrower week slot drops the month, then the weekday', () => {
    const week = [19, 20, 21, 22, 23].map(d => ({ labels: dayLabels(new Date(2026, 9, d).getTime()), target: 0, byProject: [] }))
    expect(barsSvg({ days: week, rows, width: 36 + 5 * 90 })).toContain('>Mo 19.10.</text>')
    expect(barsSvg({ days: week, rows, width: 36 + 5 * 60 })).toContain('>Mo 19.</text>')
    const narrow = barsSvg({ days: week, rows, width: 36 + 5 * 40 })
    expect(narrow).toContain('>19</text>')
    expect(narrow).not.toContain('Mo 19.</text>')
  })
})

describe('colorsFor', () => {
  test('a project keeps its colour in any order', () => {
    const today = colorsFor(['firma/shop', 'firma/blog', 'firma/app'])
    const week = colorsFor(['firma/app', 'firma/shop', 'firma/blog'])
    for (const project of ['firma/shop', 'firma/blog', 'firma/app']) expect(week.get(project)).toBe(today.get(project))
  })

  test('projects shown together get different colours', () => {
    const projects = Array.from({ length: PALETTE.length }, (_, i) => `firma/projekt-${i}`)
    expect(new Set(colorsFor(projects).values()).size).toBe(PALETTE.length)
  })
})
