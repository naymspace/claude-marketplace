import { describe, expect, test } from 'claude-code/testing'

import { NO_PROJECT, allSpans, fillColor, unionLength, dayTarget, hm, hms, planFilled, planPercent, projectName, sessionLabels, sessionSpans, sessionState, shortProject, summarize } from './model'
import type { EventType, Span, TimyEvent } from './model'

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 15, h, m, s).getTime()
const MIN = 60_000
const IDLE = 5 * MIN

const ev = (type: EventType, t: number, session = 's1', project = 'beispiel/shop'): TimyEvent => ({ type, t, session, project })

const total = (spans: Span[], kind: Span['kind']) =>
  spans.filter(s => s.kind === kind).reduce((sum, s) => sum + s.end - s.start, 0)

const example: TimyEvent[] = [
  ev('attach', at(10, 0)),
  ...Array.from({ length: 18 }, (_, i) => ev('edit', at(10, 0) + i * 10_000)),
  ev('submit', at(10, 3)),
  ev('turn-start', at(10, 3)),
  ev('turn-end', at(10, 7)),
]

describe('sessionSpans', () => {
  test('spec example: selected 8 min, claude 4 min, writing 3 min plus one slice', () => {
    const spans = sessionSpans(example, IDLE, at(10, 47))
    expect(total(spans, 'selected')).toBe(8 * MIN)
    expect(total(spans, 'claude')).toBe(4 * MIN)
    expect(total(spans, 'writing')).toBe(3 * MIN + 10_000)
  })

  test('a gap exactly at the idle limit counts fully', () => {
    const spans = sessionSpans([ev('attach', at(9, 0)), ev('submit', at(9, 5))], IDLE, at(9, 5))
    expect(total(spans, 'selected')).toBe(5 * MIN)
  })

  test('a longer gap counts only the idle limit', () => {
    const spans = sessionSpans([ev('attach', at(9, 0)), ev('submit', at(9, 30))], IDLE, at(9, 30))
    expect(total(spans, 'selected')).toBe(5 * MIN)
  })

  test('detach ends selected at once', () => {
    const spans = sessionSpans([ev('attach', at(9, 0)), ev('detach', at(9, 2))], IDLE, at(9, 30))
    expect(total(spans, 'selected')).toBe(2 * MIN)
  })

  test('turn-end while detached is not selected time', () => {
    const spans = sessionSpans(
      [ev('attach', at(9, 0)), ev('turn-start', at(9, 0)), ev('detach', at(9, 1)), ev('turn-end', at(9, 20))],
      IDLE,
      at(9, 30),
    )
    expect(total(spans, 'selected')).toBe(1 * MIN)
    expect(total(spans, 'claude')).toBe(20 * MIN)
  })

  test('a running turn does not keep selected alive past the idle limit', () => {
    const spans = sessionSpans(
      [
        ev('attach', at(10, 0)),
        ev('submit', at(10, 1)),
        ev('turn-start', at(10, 1)),
        ev('turn-end', at(10, 41)),
        ev('detach', at(10, 43)),
      ],
      IDLE,
      at(11, 0),
    )
    expect(total(spans, 'selected')).toBe(6 * MIN)
    expect(total(spans, 'claude')).toBe(40 * MIN)
  })

  test('detach during a turn ends selected at once', () => {
    const spans = sessionSpans(
      [
        ev('attach', at(10, 0)),
        ev('submit', at(10, 1)),
        ev('turn-start', at(10, 1)),
        ev('detach', at(10, 3)),
        ev('turn-end', at(10, 41)),
      ],
      IDLE,
      at(11, 0),
    )
    expect(total(spans, 'selected')).toBe(3 * MIN)
  })

  test('a turn that started while detached adds no selected time', () => {
    const spans = sessionSpans(
      [ev('attach', at(9, 0)), ev('detach', at(9, 1)), ev('turn-start', at(9, 2)), ev('turn-end', at(9, 40))],
      IDLE,
      at(10, 0),
    )
    expect(total(spans, 'selected')).toBe(1 * MIN)
  })

  test('turn start and end are not activity', () => {
    const spans = sessionSpans(
      [ev('attach', at(9, 0)), ev('turn-start', at(9, 30)), ev('turn-end', at(9, 50))],
      IDLE,
      at(10, 0),
    )
    expect(total(spans, 'selected')).toBe(5 * MIN)
  })

  test('typing without attach counts as selected', () => {
    const spans = sessionSpans([ev('edit', at(9, 0)), ev('submit', at(9, 2))], IDLE, at(9, 2))
    expect(total(spans, 'selected')).toBe(2 * MIN)
  })

  test('writing phases split after 30 s without typing', () => {
    const spans = sessionSpans([ev('edit', at(9, 0, 0)), ev('edit', at(9, 0, 20)), ev('edit', at(9, 1, 30))], IDLE, at(9, 5))
    expect(spans.filter(s => s.kind === 'writing')).toHaveLength(2)
    expect(total(spans, 'writing')).toBe(30_000 + 10_000)
  })

  test('open turn runs until now', () => {
    const spans = sessionSpans([ev('turn-start', at(9, 0))], IDLE, at(9, 40))
    expect(total(spans, 'claude')).toBe(40 * MIN)
  })

  test('open turn is capped 2 h after the last event', () => {
    const spans = sessionSpans([ev('turn-start', at(9, 0))], IDLE, at(15, 0))
    expect(total(spans, 'claude')).toBe(120 * MIN)
  })

  test('no events, no spans', () => {
    expect(sessionSpans([], IDLE, at(9, 0))).toEqual([])
  })
})

describe('sessionState', () => {
  test('counts selected time since the given start and is counting inside the idle limit', () => {
    const state = sessionState(example, IDLE, at(10, 6), at(10, 2))
    expect(state).toEqual({ selected: 4 * MIN, isCounting: true })
  })

  test('stops counting once the idle limit is reached', () => {
    expect(sessionState(example, IDLE, at(10, 47), at(0, 0))).toEqual({ selected: 8 * MIN, isCounting: false })
  })

  test('stops counting at the idle limit while a turn still runs', () => {
    const long = [ev('attach', at(10, 0)), ev('submit', at(10, 0)), ev('turn-start', at(10, 0))]
    expect(sessionState(long, IDLE, at(10, 20), at(0, 0))).toEqual({ selected: 5 * MIN, isCounting: false })
  })

  test('is not counting after detach', () => {
    const left = [ev('attach', at(10, 0)), ev('detach', at(10, 1))]
    expect(sessionState(left, IDLE, at(10, 2), at(0, 0))).toEqual({ selected: MIN, isCounting: false })
  })
})

describe('plan', () => {
  test('planPercent and planFilled show progress and cap the bar at full', () => {
    expect(planPercent(130 * MIN, 10 * 60 * MIN)).toBe(22)
    expect(planPercent(MIN, 0)).toBe(0)
    expect(planFilled(130 * MIN, 10 * 60 * MIN, 10)).toBe(2)
    expect(planFilled(13 * 60 * MIN, 10 * 60 * MIN, 10)).toBe(10)
    expect(planFilled(MIN, 2 * MIN, 6)).toBe(3)
    expect(planFilled(MIN, 0, 10)).toBe(0)
  })
})

describe('dayTarget', () => {
  const day = (d: number) => new Date(2026, 9, d, 12, 0).getTime()

  test('reads the hours of the weekday from a Monday-first list', () => {
    expect(dayTarget('6,6,6,6,5', day(12))).toBe(6 * 60 * MIN)
    expect(dayTarget('6,6,6,6,5', day(16))).toBe(5 * 60 * MIN)
    expect(dayTarget('6, 6, 6, 6, 5.5', day(16))).toBe(5.5 * 60 * MIN)
  })

  test('missing or unreadable days have no target', () => {
    expect(dayTarget('6,6,6,6,5', day(17))).toBe(0)
    expect(dayTarget('6,x', day(13))).toBe(0)
    expect(dayTarget('', day(12))).toBe(0)
  })
})

describe('unionLength', () => {
  test('overlapping selected time counts once and is clipped to the range', () => {
    const spans: Span[] = [
      { kind: 'selected', project: 'a', session: 's1', start: at(9, 0), end: at(9, 20) },
      { kind: 'selected', project: 'b', session: 's2', start: at(9, 10), end: at(9, 30) },
      { kind: 'claude', project: 'a', session: 's1', start: at(8, 0), end: at(12, 0) },
      { kind: 'selected', project: 'a', session: 's3', start: at(10, 50), end: at(11, 30) },
    ]
    expect(unionLength(spans, 'selected', at(0, 0), at(11, 0))).toBe(40 * MIN)
  })
})

describe('allSpans', () => {
  test('two sessions overlap and both keep their time', () => {
    const events = [
      ev('turn-start', at(9, 0), 'a', 'beispiel/shop'),
      ev('turn-end', at(9, 10), 'a', 'beispiel/shop'),
      ev('turn-start', at(9, 0), 'b', 'beispiel/blog'),
      ev('turn-end', at(9, 10), 'b', 'beispiel/blog'),
    ]
    const spans = allSpans(events, IDLE, at(9, 30))
    expect(total(spans.filter(s => s.session === 'a'), 'claude')).toBe(10 * MIN)
    expect(total(spans.filter(s => s.session === 'b'), 'claude')).toBe(10 * MIN)
  })
})

describe('summarize', () => {
  const spans: Span[] = [
    { kind: 'selected', project: 'beispiel/shop', session: 'a', start: at(10, 0), end: at(11, 40) },
    { kind: 'selected', project: 'beispiel/shop', session: 'b', start: at(12, 0), end: at(12, 35) },
    { kind: 'claude', project: 'beispiel/shop', session: 'a', start: at(10, 0), end: at(10, 30) },
    { kind: 'selected', project: 'beispiel/blog', session: 'c', start: at(23, 50), end: at(24, 20) },
  ]
  const labels = new Map([['a', '#12 Login-Seite'], ['b', '↳ #852 Tests aufräumen'], ['c', '']])

  test('sums per project and session, clipped to the range', () => {
    const summary = summarize(spans, labels, at(0, 0), at(24, 0))
    expect(summary.rows[0]).toEqual({
      project: 'beispiel/shop',
      selected: 135 * MIN,
      writing: 0,
      claude: 30 * MIN,
      sessions: [
        { session: 'a', label: '#12 Login-Seite', selected: 100 * MIN, writing: 0, claude: 30 * MIN },
        { session: 'b', label: '↳ #852 Tests aufräumen', selected: 35 * MIN, writing: 0, claude: 0 },
      ],
    })
    expect(summary.rows[1]?.selected).toBe(10 * MIN)
  })

  test('span over midnight is split by the range', () => {
    const nextDay = summarize(spans, labels, at(24, 0), at(48, 0))
    expect(nextDay.rows).toHaveLength(1)
    expect(nextDay.rows[0]?.selected).toBe(20 * MIN)
  })
})

describe('labels and formatting', () => {
  test('sessionLabels prefers the last title, then the branch', () => {
    const labels = sessionLabels([
      { ...ev('submit', at(9, 0), 'a'), title: 'alt' },
      { ...ev('submit', at(9, 5), 'a'), title: '#12 Login-Seite' },
      { ...ev('submit', at(9, 0), 'b'), branch: 'feature/900-x' },
      ev('attach', at(9, 0), 'c'),
    ])
    expect(labels.get('a')).toBe('#12 Login-Seite')
    expect(labels.get('b')).toBe('feature/900-x')
    expect(labels.get('c')).toBe('')
  })

  test('hm rounds to minutes', () => {
    expect(hm(0)).toBe('0:00')
    expect(hm(135 * MIN + 29_000)).toBe('2:15')
    expect(hm(135 * MIN + 31_000)).toBe('2:16')
    expect(hms(0)).toBe('0:00:00')
    expect(hms(135 * MIN + 31_999)).toBe('2:15:31')
  })

})

describe('projectName', () => {
  test('ssh remote', () => expect(projectName('git@gitlab.com:beispiel/shop.git', '/x/shop')).toBe('beispiel/shop'))
  test('https remote', () => expect(projectName('https://gitlab.com/beispiel/shop.git', '/x/shop')).toBe('beispiel/shop'))
  test('scheme is matched case-insensitively and credentials dropped', () =>
    expect(projectName('HTTPS://oauth2:tok@gitlab.com/beispiel/shop.git', '/x/shop')).toBe('beispiel/shop'))
  test('credentials without a path fall back to the root folder', () =>
    expect(projectName('https://u:pw@host', '/Users/x/shop')).toBe('shop'))
  test('scp form without user', () =>
    expect(projectName('gitlab.com:beispiel/shop.git', '/x/other')).toBe('beispiel/shop'))
  test('scp form with trailing slash after .git', () =>
    expect(projectName('git@gitlab.com:beispiel/shop.git/', '/x/other')).toBe('beispiel/shop'))
  test('file remote falls back to the root folder', () =>
    expect(projectName('file:///srv/x.git', '/Users/x/shop')).toBe('shop'))
  test('a password containing a slash never leaks', () => {
    const name = projectName('https://u:p/w@host/a/b.git', '/Users/x/shop')
    expect(name).not.toContain('@')
    expect(name).not.toContain('p/w')
  })
  test('a query string or fragment never leaks into the name', () => {
    for (const remote of ['https://gitlab.com/beispiel/shop.git?private_token=secret', 'https://gitlab.com/beispiel/shop.git#secret', 'git@gitlab.com:beispiel/shop.git?x=secret'])
      expect(projectName(remote, '/x/shop')).toBe('beispiel/shop')
  })
  test('ssh url with port', () => expect(projectName('ssh://git@host:2222/a/b.git', null)).toBe('a/b'))
  test('no remote uses the root folder', () => expect(projectName(null, '/Users/x/projects/shop')).toBe('shop'))
  test('no repo', () => expect(projectName(null, null)).toBe(NO_PROJECT))
  test('shortProject', () => expect(shortProject('beispiel/shop')).toBe('shop'))
})

describe('fillColor', () => {
  const H = 60 * MIN
  test('green up to the target, yellow up to ten percent over, red beyond', () => {
    expect(fillColor(6 * H, 6 * H)).toBe('success')
    expect(fillColor(6.6 * H, 6 * H)).toBe('warning')
    expect(fillColor(6.61 * H, 6 * H)).toBe('error')
  })
})

describe('long turns', () => {
  test('a turn that ends a day later counts at most two hours', () => {
    const spans = sessionSpans(
      [ev('attach', at(9, 0)), ev('turn-start', at(9, 0)), ev('turn-end', at(9, 0) + 24 * 60 * MIN)],
      IDLE,
      at(9, 0) + 25 * 60 * MIN,
    )
    expect(total(spans, 'claude')).toBe(120 * MIN)
  })

  test('a turn left open counts at most two hours', () => {
    const spans = sessionSpans([ev('attach', at(9, 0)), ev('turn-start', at(9, 0)), ev('edit', at(13, 0))], IDLE, at(13, 1))
    expect(total(spans, 'claude')).toBe(120 * MIN)
  })
})
