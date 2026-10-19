import type { On, ProcessRunResult, PromptEditInput, RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime()
const DIR = '/home/x/.claude/timy'
const FILE = `${DIR}/2026-10-15/s1.jsonl`

const ok = (stdout = ''): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

type Env = { files: Map<string, string>; toasts: string[]; writeGate: Promise<void> | null; readGates: Map<string, Promise<void>>; readFails: boolean; sessionId: string; unplaced: string | null; titleLine: string; runs: string[][]; opened: string[]; panes: { id: string; isShown: boolean }[] }

const engine = (on: On, files: Record<string, string> = {}): Env => {
  const env: Env = { files: new Map(Object.entries(files)), toasts: [], writeGate: null, readGates: new Map(), readFails: false, sessionId: 's1', unplaced: null, titleLine: '', runs: [], opened: [], panes: [] }
  const under = (path: string) =>
    [...env.files.keys()].filter(f => f.startsWith(path + '/') && !f.slice(path.length + 1).includes('/'))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.render', async () => ({ type: 'Box', children: [] }))
  on('session.id', async () => ({ value: env.sessionId }))
  on('session.repo', async () => ({
    value: { root: '/Users/x/shop', remote: 'git@gitlab.com:beispiel/shop.git', internal: false, name: null },
  }))
  on('session.surfaces', async () => ({ value: ['desktop'] }))
  on('process.run', async (_$, e) => {
    env.runs.push([...e.argv])
    return { value: e.argv[0] === 'git' ? ok('feature/12-login-seite\n') : ok(env.titleLine) }
  })
  on('fs.write', async (_$, e) => {
    await env.writeGate
    env.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    await env.readGates.get(e.path)
    if (env.readFails) throw new Error('disk gone')
    return { value: env.files.get(e.path) ?? '' }
  })
  on('fs.exists', async (_$, e) => ({ value: env.files.has(e.path) || under(e.path).length > 0 }))
  on('fs.list', async (_$, e) => ({
    value: under(e.path).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.toast', async (_$, e) => {
    env.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', async (_$, e) => ({
    value: (env.opened.push(e.id), env.unplaced === null ? { isPlaced: true as const } : { isPlaced: false as const, reason: env.unplaced }),
  }))
  on('ui.panes', async () => ({ value: env.panes.map(p => ({ ...p, title: p.id, isFocused: p.isShown, isPlaced: true })) }))
  on('prompt.edit', async (_$, e) => ({ text: e.text, cursor: e.cursor }))
  on('prompt.submit', async (_$, e) => e)
  on('turn.start', async (_$, e) => e)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('session.attach', async (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', async (_$, e) => ({ clientId: e.clientId }))
  on('classic.UserPromptSubmit', async () => ({}))
  on('classic.SessionStart', async () => ({}))
  mock.env(on, { HOME: '/home/x' })
  return env
}

const startOf = (surface: (typeof SURFACES)[number]) => ({ cwd: '/Users/x/shop', surface, isInteractive: true })

const linesOf = (env: Env, path = FILE) =>
  (env.files.get(path) ?? '')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))

const EDIT: PromptEditInput = {
  origin: { kind: 'composer' },
  text: 'a',
  cursor: 1,
  start: 0,
  end: 0,
  inputText: 'a',
}
const SUBMIT = { text: 'geheimer Prompt', wait: false, origin: { kind: 'composer' } } as const
const TURN_START = { turnId: 't1', text: 'geheimer Prompt' }
const TURN_DONE = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

const edit = ($: object) => ($ as { prompt: { edit: (e: PromptEditInput) => Promise<unknown> } }).prompt.edit(EDIT)

const line = (type: string, t: number, session: string, project = 'beispiel/shop', extra: object = {}) =>
  JSON.stringify({ t: new Date(t).toISOString(), type, project, session, ...extra })

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

const other = {
  name: 'other',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const theirs = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return Box({ children: theirs ? [Text({ children: ['other'] }), theirs] : [Text({ children: ['other'] })] })
    })
  },
}

const flat = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  if (node === null || typeof node !== 'object') return []
  const { children, props } = node as { children?: unknown; props?: { children?: unknown; label?: unknown } }
  if (typeof props?.label === 'string') return [props.label]
  const list = children ?? props?.children
  return Array.isArray(list) ? list.flatMap(flat) : flat(list)
}

type Found = { text: string; props: Record<string, unknown>; children: unknown[] }

const isTableRow = (box: Found) => {
  const first = box.children[0] as { type?: string; props?: { flexGrow?: number } } | undefined
  return box.props.flexDirection === 'row' && first?.type === 'Box' && first.props?.flexGrow === 1
}

const textsOf = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) => {
  const rows = (await ui.findAll({ type: 'Box' }))
    .filter(isTableRow)
    .map(box => box.children.flatMap(flat).join(' ').replace(/\s+/g, ' ').trim())
  return [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(t => t.text).concat(rows)
}

const barsOf = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) =>
  (await ui.findAll({ type: 'Box' }))
    .filter(box => typeof box.props.backgroundColor === 'string')
    .map(box => ({ color: box.props.backgroundColor, width: box.props.width }))

const titleLine = (title: string, sessionId = 's1') => JSON.stringify({ type: 'custom-title', customTitle: title, sessionId })

const todayFiles = {
  [FILE]:
    [
      line('attach', at(15, 9, 0), 's1'),
      line('edit', at(15, 9, 4), 's1'),
      line('edit', at(15, 9, 8), 's1'),
      line('edit', at(15, 9, 12), 's1'),
      line('edit', at(15, 9, 16), 's1'),
      line('submit', at(15, 9, 20), 's1'),
    ].join('\n') + '\n',
  [`${DIR}/2026-10-15/s2.jsonl`]:
    [line('submit', at(15, 9, 0), 's2'), line('submit', at(15, 9, 4), 's2'), line('submit', at(15, 9, 8), 's2')].join('\n') +
    '\n',
}

for (const surface of SURFACES) {
  describe(`recording on ${surface}`, () => {
    test('records attach at start when a surface is attached', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      expect(linesOf(env)[0]).toMatchObject({
        type: 'attach',
        project: 'beispiel/shop',
        session: 's1',
        branch: 'feature/12-login-seite',
      })
    })

    test('edit is written at most every 10 s', async ($, on) => {
      const env = engine(on)
      const clock = mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await edit($)
      await clock.advance(3_000)
      await edit($)
      await clock.advance(9_000)
      await edit($)
      expect(linesOf(env).filter(l => l.type === 'edit')).toHaveLength(2)
    })

    test('an edit does not wait for the day file write', async ($, on) => {
      const env = engine(on)
      const clock = mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      let release = () => {}
      env.writeGate = new Promise<void>(resolve => {
        release = resolve
      })
      await edit($)
      expect(linesOf(env).filter(l => l.type === 'edit')).toHaveLength(0)
      release()
      await clock.settle()
      expect(linesOf(env).filter(l => l.type === 'edit')).toHaveLength(1)
    })

    test('submit carries the title from the session transcript and never the prompt text', async ($, on) => {
      const env = engine(on)
      env.titleLine = titleLine('#12 Login-Seite') + '\n'
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.prompt.submit(SUBMIT)
      expect(linesOf(env).find(l => l.type === 'submit')).toMatchObject({ title: '#12 Login-Seite' })
      expect(env.runs.some(argv => argv[0] === 'sh' && argv.includes('s1') && argv.includes('/home/x'))).toBe(true)
      expect(env.files.get(FILE)).not.toContain('geheimer Prompt')
    })

    test('a title set during the turn reaches the turn end', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.prompt.submit(SUBMIT)
      await $.turn.start(TURN_START)
      env.titleLine = titleLine('Aktueller Stand')
      await $.turn.complete(TURN_DONE)
      expect(linesOf(env).find(l => l.type === 'submit')?.title).toBeUndefined()
      expect(linesOf(env).find(l => l.type === 'turn-end')).toMatchObject({ title: 'Aktueller Stand' })
    })

    test('an unreadable title line keeps the last title', async ($, on) => {
      const env = engine(on)
      env.titleLine = titleLine('Aktueller Stand')
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      env.titleLine = '{"type":"custom-title"'
      await $.prompt.submit(SUBMIT)
      expect(linesOf(env).find(l => l.type === 'submit')).toMatchObject({ title: 'Aktueller Stand' })
    })

    test('only prompts typed by the person are recorded as submit', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.prompt.submit({ ...SUBMIT, origin: { kind: 'task-notification' } })
      await $.prompt.submit({ ...SUBMIT, origin: { kind: 'scheduled-trigger' } })
      await $.prompt.submit({ ...SUBMIT, origin: { kind: 'peer' } })
      expect(linesOf(env).filter(l => l.type === 'submit')).toHaveLength(0)
      await $.prompt.submit(SUBMIT)
      await $.prompt.submit({ ...SUBMIT, origin: { kind: 'bridge' } })
      expect(linesOf(env).filter(l => l.type === 'submit')).toHaveLength(2)
    })

    test('a new conversation in the same process writes to its own session file', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
      env.sessionId = 's2'
      await $.classic.SessionStart({ source: 'clear' })
      await $.prompt.submit(SUBMIT)
      expect(linesOf(env).map(l => l.type)).toEqual(['attach', 'detach'])
      expect(linesOf(env, `${DIR}/2026-10-15/s2.jsonl`).map(l => l.type)).toEqual(['attach', 'submit'])
    })

    test('a resume at process start does not attach twice', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.classic.SessionStart({ source: 'resume' })
      expect(linesOf(env).map(l => l.type)).toEqual(['attach'])
    })

    test('turn start and end, detach and attach are written in order', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.turn.start(TURN_START)
      await $.turn.complete(TURN_DONE)
      await $.session.detach({ surface: 'desktop', clientId: 'desktop-2', reason: 'detach' })
      await $.session.attach({ surface: 'desktop', clientId: 'desktop-2' })
      expect(linesOf(env).map(l => l.type)).toEqual(['attach', 'turn-start', 'turn-end', 'detach', 'attach'])
    })

    test('a subagent turn start is ignored, the main one is written', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.turn.start({ ...TURN_START, agentId: 'sub-1' })
      expect(linesOf(env).filter(l => l.type === 'turn-start')).toHaveLength(0)
      await $.turn.start(TURN_START)
      expect(linesOf(env).filter(l => l.type === 'turn-start')).toHaveLength(1)
    })

    test('a subagent turn end is ignored, the main one is written', async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      await $.turn.start(TURN_START)
      await $.turn.complete({ ...TURN_DONE, agentId: 'sub-1' })
      expect(linesOf(env).filter(l => l.type === 'turn-end')).toHaveLength(0)
      await $.turn.complete(TURN_DONE)
      expect(linesOf(env).filter(l => l.type === 'turn-end')).toHaveLength(1)
    })

    test('data_dir option overrides the default folder', { options: { data_dir: '/tmp/z' } }, async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      expect(linesOf(env, '/tmp/z/2026-10-15/s1.jsonl')).toHaveLength(1)
    })

    test('data_dir expands a leading tilde', { options: { data_dir: '~/zeit' } }, async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      expect(linesOf(env, '/home/x/zeit/2026-10-15/s1.jsonl')).toHaveLength(1)
    })

    test('a relative data_dir is ignored', { options: { data_dir: 'zeit' } }, async ($, on) => {
      const env = engine(on)
      mock.clock(on, { now: at(15, 10, 0) })
      await $.session.start(startOf(surface))
      expect(linesOf(env)).toHaveLength(1)
    })

    test('idle_minutes below 1 falls back to 5', { options: { idle_minutes: 0 } }, async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 0:33 · Session 0:20:00 ▾')
    })
  })
}

for (const surface of SURFACES) {
  describe(`band on ${surface}`, () => {
    test('band shows project and session time of today', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 0:33 · Session 0:20:00 ▾')
    })

    test('band counts the part of a session that began before 4:00', async ($, on) => {
      engine(on, overFour)
      const clock = mock.clock(on, { now: at(15, 4, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 0:20 · Session 0:20:00 ▾')
    })

    test('band keeps what the next mod draws', { plugins: [other] }, async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      const texts = await textsOf(ui)
      expect(texts).toContain('other')
      expect(texts.some(t => t.startsWith('shop ·'))).toBe(true)
    })

    test('band keeps its own line above what the next mod draws', { plugins: [other] }, async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      const [root] = (await ui.findAll({ type: 'Box' })) as unknown as Found[]
      expect(root?.props.flexDirection).toBe('column')
      expect(root?.children.flatMap(flat).join(' ')).toMatch(/^●.*other$/)
    })

    test('band yields to a survey', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({
        plugin: 'timy',
        surface,
        component: 'AbovePrompt',
        props: { ...props, hasSurvey: true },
      })
      expect(await textsOf(ui)).not.toContain('●')
    })

    test('band updates every minute', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      await clock.advance(60_000)
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 0:34 · Session 0:21:00 ▾')
    })

    test('a green dot shows that the session is counting', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('success')
    })

    test('session time ticks every second without a new event', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      await clock.advance(7_000)
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 0:33 · Session 0:20:07 ▾')
    })

    test('the dot turns to warning and the time stops at the idle limit', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      await clock.advance(6 * 60_000)
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 0:38 · Session 0:25:00 ▾')
      expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('warning')
    })

    test('pressing the band unfolds today per project and folds it again', async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect((await textsOf(ui)).some(t => t.startsWith('Summe'))).toBe(false)
      await ui.press({ key: 'zeit-toggle' })
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('shop 1:40 '))).toBe(true)
      expect(texts.some(t => t.includes('#12 Login-Seite 1:40'))).toBe(true)
      expect(texts.some(t => t.startsWith('blog 0:50 '))).toBe(true)
      expect(texts.some(t => t.startsWith('Summe 2:30 '))).toBe(true)
      await ui.press({ key: 'zeit-toggle' })
      expect((await textsOf(ui)).some(t => t.startsWith('Summe'))).toBe(false)
    })

    test('an unfolded band drops session lines when they do not fit', async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props: { ...props, maxRows: 6 } })
      await ui.press({ key: 'zeit-toggle' })
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('shop 1:40 '))).toBe(true)
      expect(texts.some(t => t.includes('#12 Login-Seite'))).toBe(false)
    })

    test('band shows today against the day target', { options: { hours_per_weekday: '6,6,6,6,6' } }, async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      const texts = await textsOf(ui)
      expect(texts).toContain('Tag 0:20/6:00')
      expect(await barsOf(ui)).toEqual([{ color: 'subtle', width: 6 }])
    })

    test('work after midnight still counts to the day before', async ($, on) => {
      engine(on, lateNight)
      const clock = mock.clock(on, { now: at(15, 0, 55) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('shop · heute 1:25 · Session 1:25:00 ▾')
    })

    test('a medium band keeps the day time and drops its bar', { options: { hours_per_weekday: '6,6,6,6,6' } }, async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props: { ...props, bodyColumns: 50 } })
      const texts = await textsOf(ui)
      expect(texts).toContain('Tag 0:20/6:00')
      expect(await barsOf(ui)).toEqual([])
    })

    test('a narrow band shows only the two times', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props: { ...props, bodyColumns: 40 } })
      const texts = await textsOf(ui)
      expect(texts).toContain('shop 0:33 · 0:20:00 ▾')
      expect(texts.some(t => t.startsWith('Tag '))).toBe(false)
    })

    test('without a configured target the band shows the day total alone', async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('Tag 0:20')
      expect(await barsOf(ui)).toEqual([])
    })

    test('the band shows a loading line until the day is read', async ($, on) => {
      const env = engine(on, todayFiles)
      let release = () => {}
      env.readGates.set(`${DIR}/2026-10-15/s2.jsonl`, new Promise<void>(resolve => (release = resolve)))
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      const starting = $.session.start(startOf(surface))
      for (let i = 0; i < 50; i++) await Promise.resolve()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect((await textsOf(ui)).some(t => t.endsWith('timy lädt …'))).toBe(true)
      release()
      await starting
      await clock.settle()
      expect(await textsOf(ui)).toContain('shop · heute 0:33 · Session 0:20:00 ▾')
    })

    test('a weekday without target shows the day total alone', { options: { hours_per_weekday: '6,6,6' } }, async ($, on) => {
      engine(on, todayFiles)
      const clock = mock.clock(on, { now: at(15, 9, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('Tag 0:20')
    })

    test('the band button opens the pane on today', async ($, on) => {
      const env = engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const band = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      await band.press({ key: 'zeit-open' })
      expect(env.opened).toEqual(['timy'])
      const pane = await $.ui.mount({ plugin: 'timy', surface, component: 'Pane', requestId: 'timy', props: paneProps })
      expect((await textsOf(pane)).some(t => /^(● )?shop 1:40 /.test(t))).toBe(true)
    })

    test('/timy says so and unfolds the band when no surface places the pane', async ($, on) => {
      const env = engine(on, reportFiles)
      env.unplaced = 'older desktop'
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      await $.command.run({
        command: 'timy',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 80 },
      })
      expect(env.toasts.some(t => t.includes('older desktop'))).toBe(true)
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect((await textsOf(ui)).some(t => t.startsWith('Summe 2:30 '))).toBe(true)
    })
  })
}

const overFour = {
  [`${DIR}/2026-10-14/s1.jsonl`]: [line('attach', at(15, 3, 55), 's1'), line('edit', at(15, 3, 59), 's1')].join('\n') + '\n',
  [FILE]:
    [4, 8, 12, 16].map(m => line('edit', at(15, 4, m - 1), 's1')).join('\n') + '\n',
}

const lateNight = {
  [`${DIR}/2026-10-14/s1.jsonl`]:
    [line('attach', at(14, 23, 30), 's1'), ...Array.from({ length: 20 }, (_, i) => line('edit', at(14, 23, 30) + (i + 1) * 4 * 60_000, 's1'))].join('\n') + '\n',
}

const busy = (day: number, session: string, project: string, h: number, m: number, minutes: number, title?: string) => {
  const start = at(day, h, m)
  const lines = [line('attach', start, session, project)]
  for (let k = 4; k < minutes; k += 4) lines.push(line('edit', start + k * 60_000, session, project))
  lines.push(line('submit', start + minutes * 60_000, session, project, title ? { title } : {}))
  lines.push(line('detach', start + minutes * 60_000, session, project))
  return lines.join('\n') + '\n'
}

const reportFiles = {
  [`${DIR}/2026-10-12/a.jsonl`]: busy(12, 'a', 'beispiel/shop', 9, 0, 30, '#11 Leere Liste'),
  [`${DIR}/2026-10-15/a.jsonl`]: busy(15, 'a', 'beispiel/shop', 9, 0, 100, '#12 Login-Seite'),
  [`${DIR}/2026-10-15/c.jsonl`]: busy(15, 'c', 'beispiel/blog', 11, 0, 50),
}

const paneProps = {
  title: 'timy',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const openZeit = async (
  $: Engine,
  surface: (typeof SURFACES)[number],
  bodyColumns: number = paneProps.bodyColumns,
  view: 'grafik' | 'tabelle' = 'tabelle',
) => {
  await $.command.run({
    command: 'timy',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'Pane', requestId: 'timy', props: { ...paneProps, bodyColumns } })
  if (surface !== 'terminal') await ui.press({ key: `view-${view}` })
  return ui
}

for (const surface of SURFACES) {
  describe(`/timy on ${surface}`, () => {
    test('/timy opens the pane on today', async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('shop 1:40 '))).toBe(true)
      expect(texts.some(t => t.includes('#12 Login-Seite 1:40'))).toBe(true)
      expect(texts.some(t => t.startsWith('blog 0:50 '))).toBe(true)
      expect(texts.some(t => t.startsWith('Summe 2:30 '))).toBe(true)
    })

    test('the pane is a table with column titles and hides rows that round to 0:00', async ($, on) => {
      engine(on, {
        ...reportFiles,
        [`${DIR}/2026-10-15/z.jsonl`]: [line('attach', at(15, 12, 0), 'z', 'beispiel/leer'), line('detach', at(15, 12, 0) + 20_000, 'z', 'beispiel/leer')].join('\n') + '\n',
      })
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const texts = await textsOf(await openZeit($, surface))
      expect(texts).toContain('Aktiv Tippen Claude')
      expect(texts.some(t => t.startsWith('leer'))).toBe(false)
      expect(texts.some(t => t.startsWith('feature/12-login-seite'))).toBe(false)
      expect(texts.some(t => t.includes('beispiel/'))).toBe(false)
    })

    test('a session row keeps its time under the selected column', async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      const rows = ((await ui.findAll({ type: 'Box' })) as unknown as Found[]).filter(isTableRow)
      const cells = (needle: string) => rows.find(r => r.children.flatMap(flat).join('').includes(needle))?.children.length
      expect(cells('#12 Login-Seite')).toBe(cells('Summe'))
    })

    test('a narrow pane keeps only the selected time column', async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const texts = await textsOf(await openZeit($, surface, 36))
      expect(texts).toContain('Aktiv')
      expect(texts).toContain('shop 1:40')
      expect(texts).toContain('Summe 2:30')
    })

    test('today tab counts the part of a session that began before 4:00', async ($, on) => {
      engine(on, overFour)
      const clock = mock.clock(on, { now: at(15, 4, 20) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      expect((await textsOf(ui)).some(t => t.startsWith('shop 0:20 '))).toBe(true)
    })

    test('week tab sums the days of the week', { options: { hours_per_weekday: '8,8,8,8,8' } }, async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      await ui.press({ key: 'tab-woche' })
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('▸ shop 2:10 '))).toBe(true)
      expect(texts).toContain('Mo 12.10. 0:30 8:00')
      expect(texts).toContain('Do 15.10. 2:30 8:00')
    })

    test('today shows writing and Claude time per session', async ($, on) => {
      const file = `${DIR}/2026-10-15/s9.jsonl`
      engine(on, {
        ...reportFiles,
        [file]:
          [
            line('attach', at(15, 12, 0), 's9', 'beispiel/shop', { title: 'Claude Test' }),
            line('submit', at(15, 12, 0), 's9', 'beispiel/shop', { title: 'Claude Test' }),
            line('turn-start', at(15, 12, 0), 's9', 'beispiel/shop', { title: 'Claude Test' }),
            line('turn-end', at(15, 12, 10), 's9', 'beispiel/shop', { title: 'Claude Test' }),
            line('detach', at(15, 12, 12), 's9', 'beispiel/shop', { title: 'Claude Test' }),
          ].join('\n') + '\n',
      })
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      expect(await textsOf(await openZeit($, surface))).toContain('Claude Test 0:12 0:00 0:10')
    })

    test('week tab shows projects folded and unfolds one on press', async ($, on) => {
      engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      await ui.press({ key: 'tab-woche' })
      expect((await textsOf(ui)).some(t => t.includes('#12 Login-Seite'))).toBe(false)
      await ui.press({ key: 'toggle-beispiel/shop' })
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('▾ shop 2:10 '))).toBe(true)
      expect(texts.some(t => t.startsWith('#12 Login-Seite 2:10 '))).toBe(true)
      expect(texts.some(t => t.startsWith('▸ blog 0:50 '))).toBe(true)
    })

    test('week tab pages back to earlier weeks and forward again', async ($, on) => {
      engine(on, { ...reportFiles, [`${DIR}/2026-10-07/b.jsonl`]: busy(7, 'b', 'beispiel/shop', 9, 0, 45) })
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      await ui.press({ key: 'tab-woche' })
      expect((await textsOf(ui)).some(t => t.includes('›'))).toBe(false)
      await ui.press({ key: 'week-prev' })
      let texts = await textsOf(ui)
      expect(texts).toContain('Woche ab Mo 05.10.')
      expect(texts.some(t => t.startsWith('▸ shop 0:45 '))).toBe(true)
      await ui.press({ key: 'week-next' })
      texts = await textsOf(ui)
      expect(texts).toContain('Diese Woche')
      expect(texts.some(t => t.startsWith('▸ shop 2:10 '))).toBe(true)
    })

    test('a tab seen before shows at once while it reloads', async ($, on) => {
      const env = engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      await ui.press({ key: 'tab-woche' })
      await ui.press({ key: 'tab-heute' })
      let release = () => {}
      env.readGates.set(`${DIR}/2026-10-12/a.jsonl`, new Promise<void>(resolve => (release = resolve)))
      const pressing = ui.press({ key: 'tab-woche' })
      for (let i = 0; i < 50; i++) await Promise.resolve()
      const texts = await textsOf(ui)
      expect(texts).toContain('Diese Woche')
      expect(texts.some(t => t.startsWith('▸ shop 2:10 '))).toBe(true)
      expect(texts).toContain('lädt …')
      release()
      await pressing
      expect(await textsOf(ui)).not.toContain('lädt …')
    })

    test('a slow month load does not overwrite the week the person switched to', async ($, on) => {
      const slow = `${DIR}/2026-10-02/z.jsonl`
      const env = engine(on, { ...reportFiles, [slow]: busy(2, 'z', 'beispiel/shop', 9, 0, 30) })
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      let release = () => {}
      env.readGates.set(slow, new Promise<void>(resolve => (release = resolve)))
      const month = ui.press({ key: 'tab-monat' })
      for (let i = 0; i < 50; i++) await Promise.resolve()
      await ui.press({ key: 'tab-woche' })
      release()
      await month
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('Diese Woche'))).toBe(true)
      expect(texts.some(t => t.startsWith('▸ shop 2:10 '))).toBe(true)
    })

    test('an unreadable period keeps the last report and toasts', async ($, on) => {
      const env = engine(on, reportFiles)
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      env.readFails = true
      await ui.press({ key: 'tab-woche' })
      expect(env.toasts).toContain('timy: Daten nicht lesbar')
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('Heute, Do 15.10.'))).toBe(true)
      expect(texts.some(t => t.startsWith('shop 1:40 '))).toBe(true)
    })

    test('an unreadable earlier day keeps the shown day and its arrows', async ($, on) => {
      const env = engine(on, { ...reportFiles, [`${DIR}/2026-10-14/b.jsonl`]: busy(14, 'b', 'beispiel/shop', 9, 0, 30) })
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      env.readFails = true
      await ui.press({ key: 'day-prev' })
      expect(env.toasts).toContain('timy: Daten nicht lesbar')
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('Heute, Do 15.10.'))).toBe(true)
      expect(texts).not.toContain('lädt …')
    })

    test('a band whose day log cannot be read says so instead of spinning', async ($, on) => {
      const env = engine(on, reportFiles)
      env.readFails = true
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'timy', surface, component: 'AbovePrompt', props })
      expect(await textsOf(ui)).toContain('timy: Zeiten nicht lesbar')
      env.readFails = false
      await clock.advance(60_000)
      await clock.settle()
      expect((await textsOf(ui)).some(t => t.includes('timy: Zeiten nicht lesbar'))).toBe(false)
    })

    test('Summe is the sum of the displayed row minutes', async ($, on) => {
      const short = (session: string, project: string) =>
        [
          line('attach', at(15, 9, 0), session, project),
          line('detach', at(15, 9, 1) + 20_000, session, project),
        ].join('\n') + '\n'
      engine(on, {
        [`${DIR}/2026-10-15/a.jsonl`]: short('a', 'beispiel/shop'),
        [`${DIR}/2026-10-15/b.jsonl`]: short('b', 'beispiel/blog'),
      })
      const clock = mock.clock(on, { now: at(15, 18, 0) })
      await $.session.start(startOf(surface))
      await clock.settle()
      const ui = await openZeit($, surface)
      const texts = await textsOf(ui)
      expect(texts.some(t => t.startsWith('shop 0:01 '))).toBe(true)
      expect(texts.some(t => t.startsWith('blog 0:01 '))).toBe(true)
      expect(texts.some(t => t.startsWith('Summe 0:02 '))).toBe(true)
    })
  })
}

const svgsOf = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) =>
  (await ui.findAll({ type: 'Svg' })).map(svg => svg.props as { source: string; alt: string; width: number; isInteractive?: boolean })

describe('/timy charts', () => {
  test('today on desktop opens as a timeline with tiles and a colour legend', { options: { hours_per_weekday: '8,8,8,8,8' } }, async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const ui = await openZeit($, 'desktop', 80, 'grafik')
    const [svg] = await svgsOf(ui)
    expect(svg?.isInteractive).toBe(true)
    expect(svg?.source).toContain('<title>shop · aktiv 09:00–10:40 (1:40)</title>')
    expect(svg?.source).toContain('<title>jetzt 18:00</title>')
    expect(svg?.alt).toBe('Zeitleiste heute: shop 1:40, blog 0:50')
    const texts = await textsOf(ui)
    expect(texts).toEqual(expect.arrayContaining(['2:30', 'von 8:00 aktiv', '31 %', 'Claude 0:00 · parallel 0:00']))
    expect(texts).not.toContain('aktiv')
    expect(texts.some(t => t.startsWith('● shop 1:40 '))).toBe(true)
    expect(texts.some(t => t.includes('#12 Login-Seite'))).toBe(false)
  })

  test('week on desktop shows one stacked bar per day with its target', { options: { hours_per_weekday: '8,8,8,8,8' } }, async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const ui = await openZeit($, 'desktop', 80, 'grafik')
    await ui.press({ key: 'tab-woche' })
    const [svg] = await svgsOf(ui)
    expect(svg?.source).toContain('<title>Do 15.10. · shop 1:40</title>')
    expect(svg?.source).toContain('<title>Do 15.10. · blog 0:50</title>')
    expect(svg?.source).toContain('<title>Mo 12.10. · shop 0:30</title>')
    expect(svg?.source.match(/<title>Soll 8:00<\/title>/g)).toHaveLength(5)
    expect((await textsOf(ui)).includes('Pro Tag')).toBe(false)
  })

  test('the view buttons switch between chart and table', async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const ui = await openZeit($, 'desktop', 80, 'grafik')
    await ui.press({ key: 'view-tabelle' })
    expect(await svgsOf(ui)).toEqual([])
    expect((await textsOf(ui)).some(t => t.includes('#12 Login-Seite 1:40'))).toBe(true)
    await ui.press({ key: 'view-grafik' })
    expect(await svgsOf(ui)).toHaveLength(1)
  })

  test('the terminal keeps the table and offers no chart', async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('terminal'))
    await clock.settle()
    const ui = await openZeit($, 'terminal')
    expect(await svgsOf(ui)).toEqual([])
    const texts = await textsOf(ui)
    expect(texts.includes('Grafik')).toBe(false)
    expect(texts.some(t => t.includes('#12 Login-Seite 1:40'))).toBe(true)
  })
})

describe('/timy live', () => {
  const later = busy(15, 'd', 'beispiel/shop', 18, 0, 20)

  test('a shown pane picks up new time every minute without a loading hint', async ($, on) => {
    const env = engine(on, reportFiles)
    env.panes = [{ id: 'timy', isShown: true }]
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('terminal'))
    await clock.settle()
    const ui = await openZeit($, 'terminal')
    env.files.set(`${DIR}/2026-10-15/d.jsonl`, later)
    await clock.advance(30 * 60_000)
    await clock.settle()
    const texts = await textsOf(ui)
    expect(texts.some(t => t.startsWith('shop 2:05 '))).toBe(true)
    expect(texts).not.toContain('lädt …')
  })

  test('a hidden pane is not rebuilt', async ($, on) => {
    const env = engine(on, reportFiles)
    env.panes = [{ id: 'timy', isShown: false }]
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('terminal'))
    await clock.settle()
    const ui = await openZeit($, 'terminal')
    env.files.set(`${DIR}/2026-10-15/d.jsonl`, later)
    await clock.advance(30 * 60_000)
    await clock.settle()
    expect((await textsOf(ui)).some(t => t.startsWith('shop 1:40 '))).toBe(true)
  })
})

describe('/timy day paging', () => {
  test('the day tab pages back to yesterday and forward again', async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('terminal'))
    await clock.settle()
    const ui = await openZeit($, 'terminal')
    await ui.press({ key: 'day-prev' })
    await ui.press({ key: 'day-prev' })
    await ui.press({ key: 'day-prev' })
    let texts = await textsOf(ui)
    expect(texts).toContain('Mo 12.10.')
    expect(texts.some(t => t.startsWith('shop 0:30 '))).toBe(true)
    await ui.press({ key: 'day-next' })
    await ui.press({ key: 'day-next' })
    await ui.press({ key: 'day-next' })
    texts = await textsOf(ui)
    expect(texts).toContain('Heute, Do 15.10.')
    expect(texts.some(t => t.startsWith('shop 1:40 '))).toBe(true)
  })
})

describe('/timy layout and failure', () => {
  test('a wide pane sets summary and days side by side', async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const ui = await openZeit($, 'desktop', 120, 'tabelle')
    await ui.press({ key: 'tab-woche' })
    const halves = (await ui.findAll({ type: 'Box' })).filter(box => box.props.width === '50%')
    expect(halves).toHaveLength(2)
    expect(await textsOf(ui)).toEqual(expect.arrayContaining(['Summe', 'Do 15.10.']))
  })

  test('a narrow pane stacks summary and days', async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const ui = await openZeit($, 'desktop', 80, 'tabelle')
    await ui.press({ key: 'tab-woche' })
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.width === '50%')).toHaveLength(0)
  })

  test('a pane that fails to draw says so instead of going blank', async ($, on) => {
    on('ui.render', { component: 'Pane', requestId: 'timy' }, async () => {
      throw new Error('kaputt')
    })
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    await $.command.run({ command: 'timy', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    const ui = await $.ui.mount({ plugin: 'timy', surface: 'desktop', component: 'Pane', requestId: 'timy', props: paneProps })
    expect(await textsOf(ui)).toContain('timy konnte das Panel nicht zeichnen')
  })
})

describe('add-ons', () => {
  const targetsAddon = {
    name: 'timy-moco',
    register(on: On) {
      on('session.start', async ($, e, next) => {
        const started = await next(e)
        await $.state.set({ plugin: 'timy-moco', key: 'targets' }, { '2026-10-15': 6 })
        return started
      })
    },
  }

  const slotAddon = {
    name: 'timy-moco',
    register(on: On) {
      on('ui.render', { component: 'Pane', requestId: 'timy' }, async ($, e, next) => {
        const theirs = await next(e)
        const { value: view } = await $.state.get({ plugin: 'timy', key: 'view' })
        const { Box, Text } = $.ui.resolve(e)
        return h(Box, { flexDirection: 'column' }, theirs, h(Text, {}, `add-on sieht ${view?.tab} mit ${view?.actual.length} Projekten`)) as RenderElement
      })
    },
  }

  test('the band takes the day target from an add-on', { plugins: [targetsAddon] }, async ($, on) => {
    engine(on, todayFiles)
    const clock = mock.clock(on, { now: at(15, 9, 20) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'timy', surface: 'desktop', component: 'AbovePrompt', props })
    expect(await textsOf(ui)).toContain('Tag 0:20/6:00')
  })

  test('the pane counts the add-on target in its card', { plugins: [targetsAddon] }, async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    expect(await textsOf(await openZeit($, 'desktop', 80, 'tabelle'))).toContain('von 6:00 aktiv')
  })

  test('an add-on draws below the pane and reads the shown view', { plugins: [slotAddon] }, async ($, on) => {
    engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const texts = (await (await openZeit($, 'desktop', 80, 'tabelle')).findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.at(-1)).toBe('add-on sieht heute mit 2 Projekten')
    expect(texts.indexOf('Summe')).toBeLessThan(texts.length - 1)
  })

  test('an add-on gets only the projects the pane shows', { plugins: [slotAddon] }, async ($, on) => {
    const blink = [line('attach', at(15, 13, 0), 'd', 'beispiel/sandbox'), line('detach', at(15, 13, 0) + 10_000, 'd', 'beispiel/sandbox')]
    engine(on, { ...reportFiles, [`${DIR}/2026-10-15/d.jsonl`]: blink.join('\n') + '\n' })
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('desktop'))
    await clock.settle()
    const texts = (await (await openZeit($, 'desktop', 80, 'tabelle')).findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.at(-1)).toBe('add-on sieht heute mit 2 Projekten')
  })
})

describe('/timy after a reload', () => {
  test('a pane left open is drawn again at start', async ($, on) => {
    const env = engine(on, reportFiles)
    env.panes = [{ id: 'timy', isShown: true }]
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('terminal'))
    await clock.settle()
    expect(env.opened).toEqual(['timy'])
    const pane = await $.ui.mount({ plugin: 'timy', surface: 'terminal', component: 'Pane', requestId: 'timy', props: paneProps })
    expect((await textsOf(pane)).some(t => t.startsWith('shop 1:40 '))).toBe(true)
  })

  test('no pane is opened when none was open', async ($, on) => {
    const env = engine(on, reportFiles)
    const clock = mock.clock(on, { now: at(15, 18, 0) })
    await $.session.start(startOf('terminal'))
    await clock.settle()
    expect(env.opened).toEqual([])
  })
})

