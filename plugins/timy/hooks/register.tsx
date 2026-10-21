import { update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { renderBand, renderBandNote } from './band'
import type { Live } from './band'
import { allSpans, merge, unionLength, dayTarget, projectName, sessionLabels, sessionState, shortProject, summarize } from './model'
import type { EventType, Range } from './model'
import { renderPane } from './pane'
import type { Report, View } from './pane'
import { dayLabels, periodTitle, rangeOf } from './period'
import type { Tab } from './period'
import { SessionLog, addDays, dayKey, dayStart, daysBetween, loadDays, readColors, writeColors } from './store'
import { assignColors } from './charts'
import type { Fs } from './store'

const EDIT_THROTTLE_MS = 10_000
const WORK_CAP_MS = 15 * 60_000
const WAITING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const PANE = 'timy'
const PANE_WINDOW = { id: PANE, title: 'timy', closeOnEscape: true } as const
const BAND_DRAWN = { plugin: 'timy', key: 'band' } as const
const PANE_DRAWN = { plugin: 'timy', key: 'pane' } as const

// a redraw asked for after the module was unloaded has nothing left to draw
const redrawBand = ($: EngineInterface) => void update($, BAND_DRAWN, n => (n ?? 0) + 1).catch(() => undefined)
const redrawPane = ($: EngineInterface) => void update($, PANE_DRAWN, n => (n ?? 0) + 1).catch(() => undefined)

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
  work: SessionLog
}

type Settings = { idleMinutes: number; dataDir: string; hoursPerWeekday: string }

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const recording: { ctx: Ctx | null; lastEdit: number; isTurnOpen: boolean } = { ctx: null, lastEdit: 0, isTurnOpen: false }

const work: { open: Map<string, Promise<number>>; done: Range[]; countedTo: number } = { open: new Map(), done: [], countedTo: 0 }

const band: {
  live: Live | null
  isUnfolded: boolean
  isUnreadable: boolean
  spinner: ReturnType<EngineInterface['clock']['every']> | null
  spinnerFrame: number
} = { live: null, isUnfolded: false, isUnreadable: false, spinner: null, spinnerFrame: 0 }

const pane: {
  tab: Tab
  view: View
  offset: number
  report: Report | null
  isLoading: boolean
  seen: Map<string, Report>
  unfolded: Set<string>
} = { tab: 'heute', view: 'grafik', offset: 0, report: null, isLoading: false, seen: new Map(), unfolded: new Set() }

const fsOf = ($: EngineInterface): Fs => ({
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
  exists: path => $.fs.exists(path),
})

const stopSpinner = ($: EngineInterface) => {
  band.spinner?.cancel()
  band.spinner = null
  redrawBand($)
}

const refreshLive = async ($: EngineInterface) => {
  const ctx = recording.ctx
  if (ctx === null) return
  try {
    const now = await $.clock.now()
    const from = dayStart(now)
    const events = await loadDays(ctx.fs, ctx.dir, [dayKey(addDays(from, -1)), dayKey(now)])
    const spans = allSpans(events, ctx.idleMs, now)
    const summary = summarize(spans, sessionLabels(events), from, addDays(from, 1))
    const row = summary.rows.find(r => r.project === ctx.project)
    const mine = events.filter(event => event.session === ctx.session)
    const state = sessionState(mine, ctx.idleMs, now, from)
    band.live = {
      project: shortProject(ctx.project),
      projectOthers: (row?.selected ?? 0) - state.selected,
      dayAtRefresh: unionLength(spans, 'selected', from, addDays(from, 1)),
      sessionAtRefresh: state.selected,
      target: dayTarget(ctx.hoursPerWeekday, from),
      mine,
      sessionToday: state.selected,
      isCounting: state.isCounting,
      today: summary,
    }
    band.isUnreadable = false
    stopSpinner($)
  } catch {
    if (band.live !== null) return
    band.isUnreadable = true
    stopSpinner($)
  }
}

const tick = async ($: EngineInterface) => {
  const ctx = recording.ctx
  const live = band.live
  if (ctx === null || live === null) return
  const now = await $.clock.now()
  const state = sessionState(live.mine, ctx.idleMs, now, dayStart(now))
  if (Math.floor(state.selected / 1000) === Math.floor(live.sessionToday / 1000) && state.isCounting === live.isCounting) return
  band.live = { ...live, sessionToday: state.selected, isCounting: state.isCounting }
  redrawBand($)
}

const record = async ($: EngineInterface, type: EventType) => {
  const ctx = recording.ctx
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

const startWork = ($: EngineInterface, key: string) => {
  work.open.set(key, $.clock.now())
}

const endWork = async ($: EngineInterface, key: string) => {
  const started = work.open.get(key)
  if (started === undefined) return
  const end = await $.clock.now()
  const start = await started
  work.open.delete(key)
  work.done.push([Math.max(start, work.countedTo), Math.min(end, start + WORK_CAP_MS)])
}

const flushWork = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const open = await Promise.all([...work.open].map(async ([key, started]) => [key, await started] as const))
  const ranges = merge([...work.done, ...open.map(([, start]): Range => [Math.max(start, work.countedTo), Math.min(now, start + WORK_CAP_MS)])])
  for (const [key, start] of open) if (start + WORK_CAP_MS <= now) work.open.delete(key)
  work.done = []
  work.countedTo = now
  const counted = ranges.filter(([start, end]) => end > start)
  const ctx = recording.ctx
  if (ctx === null || counted.length === 0) return
  const { session, project, branch, title } = ctx
  try {
    await ctx.work.append({ t: counted[0]![0], type: 'claude', project, session, branch, title, ranges: counted })
  } catch {
    // a lost minute of Claude time must never block the clock or a turn
  }
}

const buildReport = async ($: EngineInterface, c: Ctx, tab: Tab, offset: number): Promise<Report> => {
  const now = await $.clock.now()
  const [from, to] = rangeOf(tab, now, offset)
  const events = await loadDays(c.fs, c.dir, daysBetween(addDays(from, -1), to))
  const spans = allSpans(events, c.idleMs, now)
  const labels = sessionLabels(events)
  const days: Report['days'] = []
  for (let day = from; day < to; day = addDays(day, 1)) {
    days.push({
      labels: dayLabels(day),
      isMonday: new Date(day).getDay() === 1,
      target: dayTarget(c.hoursPerWeekday, day),
      byProject: summarize(spans, labels, day, addDays(day, 1)).rows.map(row => [row.project, row.selected] as const),
      active: unionLength(spans, 'selected', day, addDays(day, 1)),
    })
  }
  const summary = summarize(spans, labels, from, to)
  const known = await readColors(c.fs, c.dir)
  const colors = assignColors(known, summary.rows.map(row => row.project))
  if (Object.keys(colors).length > Object.keys(known).length) await writeColors(c.fs, c.dir, colors).catch(() => undefined)
  return {
    from,
    to,
    title: periodTitle(tab, offset, from),
    now,
    summary,
    colors,
    spans: tab === 'heute' ? spans : [],
    days: days.filter(day => day.target > 0 || day.active > 0),
  }
}

const isShowing = (tab: Tab, offset: number) => pane.tab === tab && pane.offset === offset

const showReport = ($: EngineInterface, tab: Tab, offset: number, built: Report) => {
  pane.seen.set(`${tab}:${offset}`, built)
  if (!isShowing(tab, offset)) return
  pane.report = built
  pane.isLoading = false
  redrawPane($)
}

type Shown = { tab: Tab; offset: number; report: Report | null }

const loadReport = async ($: EngineInterface, previous: Shown | null = null) => {
  const ctx = recording.ctx
  if (ctx === null) return
  const { tab, offset } = pane
  pane.report = pane.seen.get(`${tab}:${offset}`) ?? null
  pane.isLoading = true
  redrawPane($)
  let built: Report
  try {
    built = await buildReport($, ctx, tab, offset)
  } catch {
    $.ui.toast('timy: Daten nicht lesbar')
    if (!isShowing(tab, offset)) return
    if (previous) {
      pane.tab = previous.tab
      pane.offset = previous.offset
      pane.report = previous.report
    }
    pane.isLoading = false
    redrawPane($)
    return
  }
  showReport($, tab, offset, built)
}

const refreshPane = async ($: EngineInterface) => {
  const ctx = recording.ctx
  if (ctx === null || pane.report === null || pane.isLoading) return
  const { tab, offset } = pane
  try {
    if (!(await $.ui.panes()).some(shown => shown.id === PANE && shown.isShown)) return
    showReport($, tab, offset, await buildReport($, ctx, tab, offset))
  } catch {
    // a closed pane or an unreadable day log keeps the shown report
  }
}

const switchTo = async ($: EngineInterface, tab: Tab, offset: number) => {
  const previous = { tab: pane.tab, offset: pane.offset, report: pane.report }
  pane.tab = tab
  pane.offset = offset
  await loadReport($, previous)
}

const openPane = async ($: EngineInterface) => {
  pane.tab = 'heute'
  pane.offset = 0
  await loadReport($)
  const opened = await $.ui.open({ ...PANE_WINDOW, focus: true })
  if (!opened.isPlaced) {
    $.ui.toast(`timy: Panel wird hier nicht angezeigt (${opened.reason}), Übersicht steht über dem Eingabefeld`)
    band.isUnfolded = true
    redrawBand($)
  }
}

const reopenPane = async ($: EngineInterface) => {
  try {
    if (!(await $.ui.panes()).some(shown => shown.id === PANE)) return
    await loadReport($)
    await $.ui.open(PANE_WINDOW)
  } catch {}
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
  const ctx = recording.ctx
  if (ctx === null) return
  try {
    const result = await $.process.run(['sh', '-c', TITLE_SCRIPT, 'sh', ctx.home, ctx.session])
    const raw = JSON.parse(result.stdout)
    if (raw.type === 'custom-title' && typeof raw.customTitle === 'string') ctx.title = raw.customTitle
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
  recording.ctx = {
    fs,
    dir,
    home,
    idleMs: idleMinutes * 60_000,
    hoursPerWeekday,
    session,
    project: projectName(repo?.remote ?? null, repo?.root ?? null),
    branch: repo ? await readBranch($) : undefined,
    log: new SessionLog(fs, dir, session),
    work: new SessionLog(fs, dir, `${session}.claude`),
  }
  void readTitle($)
  if ((await $.session.surfaces()).length > 0) await record($, 'attach')
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    idleMinutes: typeof options.idle_minutes === 'number' && options.idle_minutes >= 1 ? options.idle_minutes : 3,
    dataDir: typeof options.data_dir === 'string' ? options.data_dir : '',
    hoursPerWeekday: typeof options.hours_per_weekday === 'string' ? options.hours_per_weekday : '',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (band.live === null && band.spinner === null) {
      band.spinner = $.clock.every(100, () => {
        band.spinnerFrame += 1
        redrawBand($)
      })
    }
    await $.command.register({ name: 'timy', description: 'Zeiten pro Projekt: heute, Woche, Monat' })
    await start($, settings)
    await refreshLive($)
    void reopenPane($)
    $.clock.every(60_000, async () => {
      await flushWork($)
      await refreshLive($)
      await refreshPane($)
    })
    $.clock.every(1_000, () => tick($))
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (recording.ctx !== null && (await $.session.id()) !== recording.ctx.session) {
      await flushWork($)
      recording.isTurnOpen = false
      recording.lastEdit = 0
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
    if (now - recording.lastEdit >= EDIT_THROTTLE_MS) {
      recording.lastEdit = now
      void record($, 'edit')
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      void readTitle($)
      await record($, 'submit')
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    recording.isTurnOpen = true
    await record($, 'turn-start')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const done = await next(e)
    recording.isTurnOpen = false
    await readTitle($)
    await record($, 'turn-end')
    await flushWork($)
    return done
  })

  on('turn.step', async function* ($, e, next) {
    const key = `step:${e.agentId ?? 'main'}:${e.turnId}:${e.index}`
    startWork($, key)
    try {
      return yield* next(e)
    } finally {
      void endWork($, key).catch(() => undefined)
    }
  })

  on('tool.call', async ($, e, next) => {
    if (WAITING_TOOLS.has(e.tool)) return next(e)
    const key = `tool:${e.tool_use_id}`
    startWork($, key)
    try {
      return await next(e)
    } finally {
      void endWork($, key).catch(() => undefined)
    }
  })

  on('session.end', async ($, e, next) => {
    if (recording.isTurnOpen) await record($, 'turn-end')
    await flushWork($)
    await record($, 'detach')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(BAND_DRAWN)
    const theirs = await next(e)
    if (e.props.hasSurvey) return theirs
    const ui = $.ui.resolve(e)
    const live = band.live
    if (live === null) {
      if (band.spinner === null && !band.isUnreadable) return theirs
      return renderBandNote(ui, band.isUnreadable ? 'timy: Zeiten nicht lesbar' : `${SPINNER[band.spinnerFrame % SPINNER.length]} timy lädt …`, theirs)
    }
    return renderBand({
      ui,
      live,
      width: e.props.bodyColumns,
      maxRows: e.props.maxRows,
      isUnfolded: band.isUnfolded,
      theirs,
      onToggle: () => {
        band.isUnfolded = !band.isUnfolded
        redrawBand($)
      },
      onOpen: () => openPane($),
    })
  })

  on('command.run', { command: 'timy' }, async $ => {
    await openPane($)
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    await $.state.get(PANE_DRAWN)
    const theirs = await next(e)
    const ui = $.ui.resolve(e)
    return renderPane({
      ui,
      svg: e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null,
      width: e.props.bodyColumns,
      tab: pane.tab,
      view: pane.view,
      offset: pane.offset,
      isLoading: pane.isLoading,
      report: pane.report,
      unfolded: pane.unfolded,
      theirs,
      onTab: tab => switchTo($, tab, 0),
      onView: view => {
        pane.view = view
        redrawPane($)
      },
      onPage: step => switchTo($, pane.tab, Math.min(0, pane.offset + step)),
      onToggle: project => {
        if (!pane.unfolded.delete(project)) pane.unfolded.add(project)
        redrawPane($)
      },
    })
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
