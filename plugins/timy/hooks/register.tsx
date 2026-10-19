import { update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import { barsSvg, colorOf, parallelRanges, timelineSvg } from './charts'
import type { ChartDay } from './charts'

import { allSpans, fillColor, unionLength, dayTarget, displayedTotal, hm, hms, planFilled, planPercent, projectName, sessionLabels, sessionState, shortProject, summarize } from './model'
import type { EventType, Span, Summary, ZeitEvent } from './model'
import { SessionLog, addDays, dayKey, dayStart, daysBetween, loadDays, monthStart, weekStart } from './store'
import type { Fs } from './store'

const EDIT_THROTTLE_MS = 10_000
const PANE = 'timy'
const BAND_DRAWN = { plugin: 'timy', key: 'band' } as const
const PANE_DRAWN = { plugin: 'timy', key: 'pane' } as const
const VIEW = { plugin: 'timy', key: 'view' } as const
const ADDON_TARGETS = { plugin: 'timy-moco', key: 'targets' } as const
const HOUR = 3_600_000

// a redraw asked for after the module was unloaded has nothing left to draw
const redrawBand = ($: EngineInterface) => void update($, BAND_DRAWN, n => (n ?? 0) + 1).catch(() => undefined)
const redrawPane = ($: EngineInterface) => void update($, PANE_DRAWN, n => (n ?? 0) + 1).catch(() => undefined)
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

type Tab = 'heute' | 'woche' | 'monat'
type View = 'grafik' | 'tabelle'

const PX_PER_COLUMN = 8

type Ctx = {
  fs: Fs
  dir: string
  home: string
  idleMs: number
  hoursPerWeekday: string
  session: string
  project: string
  branch?: string
  title?: string
  log: SessionLog
}

type Settings = { idleMinutes: number; dataDir: string; hoursPerWeekday: string }

let ctx: Ctx | null = null
let lastEdit = 0
let turnOpen = false
let live: {
  project: string
  projectOthers: number
  dayAtRefresh: number
  sessionAtRefresh: number
  day: string
  target: number
  mine: ZeitEvent[]
  sessionToday: number
  isCounting: boolean
  today: Summary
} | null = null
let isUnfolded = false
let tab: Tab = 'heute'
let view: View = 'grafik'
let pageOffset = 0
type Report = {
  from: number
  to: number
  title: string
  now: number
  summary: Summary
  spans: Span[]
  days: (ChartDay & { key: string; active: number })[]
}

let report: Report | null = null
let isLoading = false
const seen = new Map<string, Report>()
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinner: ReturnType<EngineInterface['clock']['every']> | null = null
let spinnerFrame = 0
let isLiveUnreadable = false
const unfolded = new Set<string>()

const rangeOf = (t: Tab, now: number, offset: number): [number, number] => {
  if (t === 'heute') {
    const from = addDays(dayStart(now), offset)
    return [from, addDays(from, 1)]
  }
  if (t === 'woche') {
    const from = addDays(weekStart(now), 7 * offset)
    return [from, addDays(from, 7)]
  }
  const from = monthStart(now)
  const next = new Date(from)
  next.setMonth(next.getMonth() + 1)
  return [from, next.getTime()]
}

const dayLabel = (t: number) => {
  const d = new Date(t)
  return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

type BarColor = 'success' | 'warning' | 'error'

type Row = {
  key: string
  name: string
  values: string[]
  style: 'plain' | 'dim' | 'bold'
  dot?: string
  bar?: { actual: number; planned: number; color: BarColor }
  onPress?: () => void
}

type Column = { title: string; width: number; minBody: number; isBar?: true }

const COLUMNS: Column[] = [
  { title: 'Aktiv', width: 8, minBody: 0 },
  { title: 'Tippen', width: 8, minBody: 52 },
  { title: 'Claude', width: 8, minBody: 44 },
]

const BAR_GAP = 2

const dayColumns = (width: number, hasTarget: boolean): Column[] => [
  COLUMNS[0]!,
  ...(hasTarget
    ? [
        { title: 'Soll', width: 7, minBody: 36 },
        { title: '', width: BAR_GAP + (width >= 80 ? 12 : 8), minBody: 52, isBar: true as const },
      ]
    : []),
]

const BAND_SHORT_BELOW = 48
const BAND_BAR_FROM = 60
const BAND_BAR_WIDTH = 6
const SPLIT_MIN_WIDTH = 110
const SPLIT_GAP = 3

const isShown = (ms: number) => hm(ms) !== '0:00'

type Folding = { isOpen: (project: string) => boolean; toggle?: (project: string) => void }

const allOpen = (isOpen: boolean): Folding => ({ isOpen: () => isOpen })

const summaryRows = (summary: Summary, folding: Folding): Row[] => [
  ...summary.rows
    .filter(row => isShown(row.selected) || isShown(row.writing) || isShown(row.claude))
    .flatMap((row): Row[] => {
      const isOpen = folding.isOpen(row.project)
      const toggle = folding.toggle
      return [
        {
          key: `row-${row.project}`,
          name: toggle ? `${isOpen ? '▾' : '▸'} ${shortProject(row.project)}` : shortProject(row.project),
          values: [hm(row.selected), hm(row.writing), hm(row.claude)],
          style: 'plain',
          ...(toggle ? { onPress: () => toggle(row.project) } : {}),
        },
        ...(isOpen
          ? row.sessions
              .filter(s => s.label && (isShown(s.selected) || isShown(s.writing) || isShown(s.claude)))
              .map((s): Row => ({
                key: `session-${s.session}`,
                name: `  ${s.label}`,
                values: [hm(s.selected), hm(s.writing), hm(s.claude)],
                style: 'dim',
              }))
          : []),
      ]
    }),
  {
    key: 'sum',
    name: 'Summe',
    values: (['selected', 'writing', 'claude'] as const).map(kind => hm(displayedTotal(summary.rows, kind))),
    style: 'bold',
  },
]

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const bar = ({ Box }: Ui, filled: number, width: number, color: BarColor) => (
  <Box flexDirection="row" flexShrink={0}>
    {filled > 0 ? <Box width={filled} height={1} backgroundColor={color} /> : null}
    {filled < width ? <Box width={width - filled} height={1} backgroundColor="subtle" /> : null}
  </Box>
)

const fullBar = ({ Box }: Ui, actual: number, planned: number) => {
  const percent = Math.min(100, planPercent(actual, planned))
  return (
    <Box flexDirection="row" flexGrow={1}>
      {percent > 0 ? <Box width={`${percent}%`} height={1} backgroundColor={fillColor(actual, planned)} /> : null}
      {percent < 100 ? <Box width={`${100 - percent}%`} height={1} backgroundColor="subtle" /> : null}
    </Box>
  )
}

const barCell = (ui: Ui, { actual, planned, color }: NonNullable<Row['bar']>, width: number) =>
  bar(ui, planFilled(actual, planned, width), width, color)

const table = (ui: Ui, columns: Column[], rows: Row[], width: number) => {
  const { Box, Text, Button } = ui
  const shown = columns.flatMap((column, i) => (width >= column.minBody ? [i] : []))
  const line = (row: Row) => (
    <Box key={row.key} flexDirection="row">
      <Box flexGrow={1} minWidth={8} flexDirection="row" columnGap={1}>
        {row.dot ? <Text color={row.dot}>●</Text> : null}
        {row.onPress ? (
          <Button key={`toggle-${row.key.slice('row-'.length)}`} plain label={row.name} onPress={row.onPress} />
        ) : (
          <Text wrap="truncate-end" bold={row.style === 'bold'} dimColor={row.style === 'dim'}>
            {row.name}
          </Text>
        )}
      </Box>
      {shown.map(i => (
        <Box
          key={`${row.key}-${i}`}
          width={columns[i]?.width}
          flexShrink={0}
          justifyContent="flex-end"
        >
          {columns[i]?.isBar ? (
            row.bar ? barCell(ui, row.bar, (columns[i]?.width ?? BAR_GAP) - BAR_GAP) : null
          ) : (
            <Text wrap="truncate" bold={row.style === 'bold'} dimColor={row.style === 'dim'}>
              {row.values[i] ?? ''}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {line({ key: 'head', name: '', values: columns.map(c => c.title), style: 'dim' })}
      {rows.filter(row => row.key !== 'sum').map(line)}
      {rows.some(row => row.key === 'sum') ? <Box flexDirection="column" marginTop={1}>{rows.filter(row => row.key === 'sum').map(line)}</Box> : null}
    </Box>
  )
}

const fsOf = ($: EngineInterface): Fs => ({
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
})

const refreshLive = async ($: EngineInterface) => {
  if (ctx === null) return
  try {
    const now = await $.clock.now()
    const from = dayStart(now)
    const events = await loadDays(ctx.fs, ctx.dir, [dayKey(addDays(from, -1)), dayKey(now)])
    const spans = allSpans(events, ctx.idleMs, now)
    const summary = summarize(spans, sessionLabels(events), from, addDays(from, 1))
    const row = summary.rows.find(r => r.project === ctx?.project)
    const mine = events.filter(event => event.session === ctx?.session)
    const state = sessionState(mine, ctx.idleMs, now, from)
    live = {
      project: shortProject(ctx.project),
      projectOthers: (row?.selected ?? 0) - state.selected,
      dayAtRefresh: unionLength(spans, 'selected', from, addDays(from, 1)),
      sessionAtRefresh: state.selected,
      day: dayKey(from),
      target: dayTarget(ctx.hoursPerWeekday, from),
      mine,
      sessionToday: state.selected,
      isCounting: state.isCounting,
      today: summary,
    }
    isLiveUnreadable = false
    spinner?.cancel()
    spinner = null
    redrawBand($)
  } catch {
    if (live !== null) return
    isLiveUnreadable = true
    spinner?.cancel()
    spinner = null
    redrawBand($)
  }
}

const tick = async ($: EngineInterface) => {
  if (ctx === null || live === null) return
  const now = await $.clock.now()
  const state = sessionState(live.mine, ctx.idleMs, now, dayStart(now))
  if (Math.floor(state.selected / 1000) === Math.floor(live.sessionToday / 1000) && state.isCounting === live.isCounting) return
  live = { ...live, sessionToday: state.selected, isCounting: state.isCounting }
  redrawBand($)
}

const record = async ($: EngineInterface, type: EventType) => {
  if (ctx === null) return
  const { session, project, branch, title } = ctx
  try {
    await ctx.log.append({ t: await $.clock.now(), type, project, session, branch, title })
  } catch {
    // a disk problem must never block a prompt, turn or attach hook
    return
  }
  void refreshLive($)
}

const buildReport = async ($: EngineInterface, c: Ctx, t: Tab, offset: number): Promise<Report> => {
  const now = await $.clock.now()
  const [from, to] = rangeOf(t, now, offset)
  const events = await loadDays(c.fs, c.dir, daysBetween(addDays(from, -1), to))
  const spans = allSpans(events, c.idleMs, now)
  const labels = sessionLabels(events)
  const summary = summarize(spans, labels, from, to)
  const days: Report['days'] = []
  for (let day = from; day < to; day = addDays(day, 1)) {
    const target = dayTarget(c.hoursPerWeekday, day)
    const byProject = summarize(spans, labels, day, addDays(day, 1)).rows.map(row => [row.project, row.selected] as const)
    const active = unionLength(spans, 'selected', day, addDays(day, 1))
    days.push({ key: dayKey(day), label: dayLabel(day), target, byProject, active })
  }
  return {
    from,
    to,
    title:
      t === 'heute' ? (offset === 0 ? `Heute, ${dayLabel(now)}` : dayLabel(from)) : t === 'monat' ? 'Dieser Monat' : offset === 0 ? 'Diese Woche' : `Woche ab ${dayLabel(from)}`,
    now,
    summary,
    spans: t === 'heute' ? spans : [],
    days,
  }
}

const loadReport = async ($: EngineInterface, previous: { tab: Tab; offset: number; report: Report | null } | null = null) => {
  if (ctx === null) return
  const c = ctx
  const t = tab
  const offset = pageOffset
  const key = `${t}:${offset}`
  const isStillShown = () => tab === t && pageOffset === offset
  report = seen.get(key) ?? null
  isLoading = true
  redrawPane($)
  let built: Report
  try {
    built = await buildReport($, c, t, offset)
  } catch {
    $.ui.toast('timy: Daten nicht lesbar')
    if (!isStillShown()) return
    if (previous) {
      tab = previous.tab
      pageOffset = previous.offset
      report = previous.report
    }
    isLoading = false
    redrawPane($)
    return
  }
  seen.set(key, built)
  if (!isStillShown()) return
  report = built
  isLoading = false
  redrawPane($)
  await publishView($, t, built)
}

const refreshPane = async ($: EngineInterface) => {
  if (ctx === null || report === null || isLoading) return
  const c = ctx
  const t = tab
  const offset = pageOffset
  try {
    if (!(await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)) return
    const built = await buildReport($, c, t, offset)
    if (tab !== t || pageOffset !== offset) return
    seen.set(`${t}:${offset}`, built)
    report = built
    redrawPane($)
    await publishView($, t, built)
  } catch {
    // a closed pane or an unreadable day log keeps the shown report
  }
}

const sumOf = (values: Iterable<number>) => [...values].reduce((sum, ms) => sum + ms, 0)

const publishView = ($: EngineInterface, t: Tab, built: Report) =>
  $.state
    .set(VIEW, {
      tab: t,
      from: built.from,
      to: built.to,
      days: built.days.map(day => day.key),
      actual: built.summary.rows.map((row): [string, number] => [row.project, row.selected]),
    })
    .catch(() => undefined)

const withTargets = (days: Report['days'], targets: Record<string, number> | undefined): Report['days'] =>
  days.map(day => (targets?.[day.key] === undefined ? day : { ...day, target: targets[day.key]! * HOUR }))

const page = async ($: EngineInterface, step: number) => {
  const previous = { tab, offset: pageOffset, report }
  pageOffset = Math.min(0, pageOffset + step)
  await loadReport($, previous)
}

const openPane = async ($: EngineInterface) => {
  tab = 'heute'
  pageOffset = 0
  await loadReport($)
  const opened = await $.ui.open({ id: PANE, title: 'timy', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) {
    $.ui.toast(`timy: Panel wird hier nicht angezeigt (${opened.reason}), Übersicht steht über dem Eingabefeld`)
    isUnfolded = true
    redrawBand($)
  }
}

const reopenPane = async ($: EngineInterface) => {
  try {
    if (!(await $.ui.panes()).some(pane => pane.id === PANE)) return
    await loadReport($)
    await $.ui.open({ id: PANE, title: 'timy', closeOnEscape: true })
  } catch {
    // the pane stays as the app left it
  }
}

const readBranch = async ($: EngineInterface) => {
  try {
    const result = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    return result.exitCode === 0 ? result.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

const TITLE_SCRIPT = `f=$(ls "$1"/.claude/projects/*/"$2".jsonl 2>/dev/null | head -n 1) && [ -n "$f" ] && grep -F '"type":"custom-title"' "$f" | tail -n 1`

const readTitle = async ($: EngineInterface) => {
  if (ctx === null) return
  const c = ctx
  try {
    const result = await $.process.run(['sh', '-c', TITLE_SCRIPT, 'sh', c.home, c.session])
    const raw = JSON.parse(result.stdout)
    if (raw.type === 'custom-title' && typeof raw.customTitle === 'string') c.title = raw.customTitle
  } catch {
    // no transcript or an unreadable line keeps the last title
  }
}

const resolveDir = (configured: string, home: string): string => {
  const expanded = configured === '~' || configured.startsWith('~/') ? home + configured.slice(1) : configured
  return expanded.startsWith('/') ? expanded : `${home}/.claude/timy`
}

const start = async ($: EngineInterface, { idleMinutes, dataDir, hoursPerWeekday }: Settings) => {
  const fs = fsOf($)
  const home = (await $.env.get('HOME')) ?? ''
  const dir = resolveDir(dataDir, home)
  const session = await $.session.id()
  const repo = await $.session.repo()
  ctx = {
    fs,
    dir,
    home,
    idleMs: idleMinutes * 60_000,
    hoursPerWeekday,
    session,
    project: projectName(repo?.remote ?? null, repo?.root ?? null),
    branch: repo ? await readBranch($) : undefined,
    log: new SessionLog(fs, dir, session),
  }
  void readTitle($)
  if ((await $.session.surfaces()).length > 0) await record($, 'attach')
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    idleMinutes: typeof options.idle_minutes === 'number' && options.idle_minutes >= 1 ? options.idle_minutes : 5,
    dataDir: typeof options.data_dir === 'string' ? options.data_dir : '',
    hoursPerWeekday: typeof options.hours_per_weekday === 'string' ? options.hours_per_weekday : '',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (live === null && spinner === null) {
      spinner = $.clock.every(100, () => {
        spinnerFrame += 1
        redrawBand($)
      })
    }
    await $.command.register({ name: 'timy', description: 'Zeiten pro Projekt: heute, Woche, Monat' })
    await start($, settings)
    await refreshLive($)
    void reopenPane($)
    $.clock.every(60_000, async () => {
      await refreshLive($)
      await refreshPane($)
    })
    $.clock.every(1_000, () => tick($))
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (ctx !== null && (await $.session.id()) !== ctx.session) {
      turnOpen = false
      lastEdit = 0
      await start($, settings)
      await refreshLive($)
    }
    return started
  })

  on('session.attach', async ($, e, next) => {
    await record($, 'attach')
    return next(e)
  })

  on('session.detach', async ($, e, next) => {
    await record($, 'detach')
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const now = await $.clock.now()
    if (now - lastEdit >= EDIT_THROTTLE_MS) {
      lastEdit = now
      void record($, 'edit')
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      await readTitle($)
      await record($, 'submit')
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    turnOpen = true
    await record($, 'turn-start')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const done = await next(e)
    turnOpen = false
    await readTitle($)
    await record($, 'turn-end')
    return done
  })

  on('session.end', async ($, e, next) => {
    if (turnOpen) await record($, 'turn-end')
    await record($, 'detach')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(BAND_DRAWN)
    const theirs = await next(e)
    if (e.props.hasSurvey) return theirs
    if (live === null) {
      if (spinner === null && !isLiveUnreadable) return theirs
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>{isLiveUnreadable ? 'timy: Zeiten nicht lesbar' : `${SPINNER[spinnerFrame % SPINNER.length]} timy lädt …`}</Text>
          {theirs}
        </Box>
      )
    }
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const { value: targets } = await $.state.get(ADDON_TARGETS)
    const target = targets?.[live.day] === undefined ? live.target : targets[live.day]! * HOUR
    const width = e.props.bodyColumns
    const isShort = width < BAND_SHORT_BELOW
    const projectToday = hm(live.projectOthers + live.sessionToday)
    const arrow = isUnfolded ? '▴' : '▾'
    const dayTotal = live.dayAtRefresh + live.sessionToday - live.sessionAtRefresh
    const ours = (
      <Box flexDirection="row" columnGap={2} flexShrink={0}>
        <Box flexDirection="row" columnGap={1}>
          <Text color={live.isCounting ? 'success' : 'warning'}>●</Text>
          <Button
            key="zeit-toggle"
            plain
            dimColor
            label={
              isShort
                ? `${live.project} ${projectToday} · ${hms(live.sessionToday)} ${arrow}`
                : `${live.project} · heute ${projectToday} · Session ${hms(live.sessionToday)} ${arrow}`
            }
            onPress={() => {
              isUnfolded = !isUnfolded
              redrawBand($)
            }}
          />
        </Box>
        {isShort ? null : (
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            <Text dimColor wrap="truncate">
              {`Tag ${hm(dayTotal)}${target > 0 ? `/${hm(target)}` : ''}`}
            </Text>
            {target > 0 && width >= BAND_BAR_FROM
              ? bar(ui, planFilled(dayTotal, target, BAND_BAR_WIDTH), BAND_BAR_WIDTH, fillColor(dayTotal, target))
              : null}
          </Box>
        )}
        <Button key="zeit-open" plain dimColor label="⤢" onPress={() => openPane($)} />
      </Box>
    )
    const band = (
      <Box flexDirection="column">
        {ours}
        {theirs}
      </Box>
    )
    if (!isUnfolded) return band
    const room = e.props.maxRows - 3
    const full = summaryRows(live.today, allOpen(true))
    const rows = full.length <= room ? full : summaryRows(live.today, allOpen(false))
    return (
      <Box flexDirection="column">
        {band}
        <Box marginTop={1}>{table(ui, COLUMNS, rows, width)}</Box>
      </Box>
    )
  })

  on('command.run', { command: 'timy' }, async $ => {
    await openPane($)
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    await $.state.get(PANE_DRAWN)
    const addons = await next(e)
    const { value: targets } = await $.state.get(ADDON_TARGETS)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const isGrafik = Svg !== null && view === 'grafik'
    const width = e.props.bodyColumns
    const isSplit = width >= SPLIT_MIN_WIDTH
    const half = Math.floor((width - SPLIT_GAP) / 2)
    const pair = (left: RenderNode, right: RenderNode | null) =>
      isSplit && right !== null ? (
        <Box flexDirection="row" alignItems="flex-start">
          <Box width="50%" paddingRight={SPLIT_GAP} flexDirection="column">
            {left}
          </Box>
          <Box width="50%" flexDirection="column">
            {right}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {left}
          {right}
        </Box>
      )
    const shown = report === null ? null : { ...report, days: withTargets(report.days, targets).filter(day => day.target > 0 || day.active > 0) }
    const tabButton = (t: Tab, label: string, hotkey: string) => (
      <Button
        key={`tab-${t}`}
        label={label}
        hotkey={hotkey}
        plain={tab !== t ? true : undefined}
        variant={tab === t ? 'primary' : undefined}
        dimColor={tab !== t}
        onPress={async () => {
          const previous = { tab, offset: pageOffset, report }
          tab = t
          pageOffset = 0
          await loadReport($, previous)
        }}
      />
    )
    const viewButton = (v: View, label: string, hotkey: string) => (
      <Button
        key={`view-${v}`}
        label={label}
        hotkey={hotkey}
        plain
        dimColor={view !== v}
        onPress={() => {
          view = v
          redrawPane($)
        }}
      />
    )
    const chartRows = (shown?.summary.rows ?? [])
      .filter(row => isShown(row.selected) || isShown(row.claude))
      .map(row => ({ project: row.project, name: shortProject(row.project) }))
    const chart = (current: Report) => {
      if (Svg === null) return null
      const px = width * PX_PER_COLUMN
      const alt = chartRows.map(row => `${row.name} ${hm(current.summary.rows.find(r => r.project === row.project)?.selected ?? 0)}`).join(', ')
      if (tab !== 'heute') {
        const bars = barsSvg({ days: current.days, rows: chartRows, width: px })
        return (
          <Box flexDirection="column" rowGap={1}>
            <Text dimColor>Aktiv pro Tag</Text>
            <Svg source={bars.source} width={bars.width} height={bars.height} alt={`Stunden pro Tag: ${alt}`} isInteractive />
          </Box>
        )
      }
      return (
        <Box flexDirection="column" rowGap={1}>
          {chartRows.length === 0 ? (
            <Text dimColor>Heute noch nichts gezählt.</Text>
          ) : (
            <Svg
              {...timelineSvg({ spans: current.spans, rows: chartRows, from: current.from, to: current.to, now: current.now, width: px })}
              alt={`Zeitleiste heute: ${alt}`}
              isInteractive
            />
          )}
        </Box>
      )
    }
    const dots = new Map(chartRows.map((row, i) => [`row-${row.project}`, colorOf(i)]))
    const card = (current: Report) => {
      const target = sumOf(current.days.map(day => day.target))
      const active = sumOf(current.days.map(day => day.active))
      const extras = [
        tab === 'heute' ? `Claude ${hm(unionLength(current.spans, 'claude', current.from, current.to))}` : null,
        tab === 'heute' ? `parallel ${hm(sumOf(parallelRanges(current.spans, current.from, current.to).map(([a, b]) => b - a)))}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return (
        <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
          <Box flexDirection="row" columnGap={1}>
            <Text bold>{hm(active)}</Text>
            <Text dimColor>{target > 0 ? `von ${hm(target)} aktiv` : 'aktiv'}</Text>
            <Box flexGrow={1} />
            {target > 0 ? <Text dimColor>{`${planPercent(active, target)} %`}</Text> : null}
          </Box>
          {target > 0 ? fullBar(ui, active, target) : null}
          {extras === '' ? null : <Text dimColor>{extras}</Text>}
        </Box>
      )
    }
    const summaryBlock = (current: Report) =>
      table(
        ui,
        COLUMNS,
        summaryRows(
          current.summary,
          isGrafik
            ? allOpen(false)
            : tab === 'heute'
              ? allOpen(true)
              : {
                  isOpen: project => unfolded.has(project),
                  toggle: project => {
                    if (!unfolded.delete(project)) unfolded.add(project)
                    redrawPane($)
                  },
                },
        ).map(row => (isGrafik && dots.has(row.key) ? { ...row, dot: dots.get(row.key) } : row)),
        isSplit ? half : width,
      )
    const perDayBlock = (current: Report) => {
      if (isGrafik || tab === 'heute' || !current.days.some(day => day.active > 0)) return null
      const hasTarget = current.days.some(day => day.target > 0)
      return (
        <Box flexDirection="column" marginTop={isSplit ? 0 : 1}>
          <Text bold>Pro Tag</Text>
          {table(
            ui,
            dayColumns(isSplit ? half : width, hasTarget),
            current.days
              .filter(day => day.active > 0)
              .map((day): Row => ({
                key: `day-${day.label}`,
                name: day.label,
                values: [hm(day.active), hm(day.target)],
                style: 'plain',
                ...(day.target > 0 ? { bar: { actual: day.active, planned: day.target, color: fillColor(day.active, day.target) } } : {}),
              })),
            isSplit ? half : width,
          )}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {tabButton('heute', 'Heute', '1')}
          {tabButton('woche', 'Woche', '2')}
          {tabButton('monat', 'Monat', '3')}
          {Svg === null ? null : <Box flexGrow={1} />}
          {Svg === null ? null : viewButton('grafik', 'Grafik', 'g')}
          {Svg === null ? null : viewButton('tabelle', 'Tabelle', 't')}
        </Box>
        {shown === null ? (
          <Box marginTop={1}>
            <Text dimColor>lädt …</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" columnGap={2}>
                {tab !== 'monat' ? <Button key={tab === 'woche' ? 'week-prev' : 'day-prev'} plain label="‹" onPress={() => page($, -1)} /> : null}
                <Text bold>{shown.title}</Text>
                {tab !== 'monat' && pageOffset < 0 ? (
                  <Button key={tab === 'woche' ? 'week-next' : 'day-next'} plain label="›" onPress={() => page($, 1)} />
                ) : null}
                {isLoading ? <Text dimColor>lädt …</Text> : null}
              </Box>
              {card(shown)}
              {isGrafik ? <Box marginBottom={1}>{chart(shown)}</Box> : null}
            </Box>
            {pair(summaryBlock(shown), perDayBlock(shown))}
          </Box>
        )}
        {addons}
      </Box>
    )
  }).catch(($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="error">timy konnte das Panel nicht zeichnen</Text>
        <Text dimColor>{`${next.error.kind}: ${next.error.message ?? 'ohne Meldung'}`}</Text>
      </Box>
    )
  })
}
