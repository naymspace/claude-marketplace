import type { RenderNode } from 'claude-code'

import { barsSvg, colorOf, parallelRanges, timelineSvg } from './charts'
import type { ChartDay, ChartRow, Colors } from './charts'
import { hm, planPercent, shortProject, unionLength } from './model'
import type { Span, Summary } from './model'
import type { Tab } from './period'
import { COLUMNS, allOpen, dayColumns, fullBar, isShown, overlapOf, summaryRows, table } from './table'
import type { Folding, Row, Ui } from './table'

export type View = 'grafik' | 'tabelle'

export type Report = {
  from: number
  to: number
  title: string
  now: number
  summary: Summary
  colors: Colors
  spans: Span[]
  days: ChartDay[]
}

type SvgElement = Extract<Ui, { Svg: unknown }>['Svg']

type PaneInput = {
  ui: Ui
  svg: SvgElement | null
  width: number
  tab: Tab
  isHelp: boolean
  idleMinutes: number
  view: View
  offset: number
  isLoading: boolean
  report: Report | null
  unfolded: ReadonlySet<string>
  theirs: RenderNode
  onTab: (tab: Tab) => Promise<void>
  onHelp: () => void
  onView: (view: View) => void
  onPage: (step: number) => Promise<void>
  onToggle: (project: string) => void
}

const PX_PER_COLUMN = 8
const SPLIT_MIN_WIDTH = 110
const SPLIT_GAP = 3
const PAGE_KEY = { heute: 'day', woche: 'week', monat: 'month' } as const
const TERM_WIDTH = 12
const HELP_MAX_WIDTH = 100
const JOINERS = new Set(['+', 'dann'])

type HelpEntry = readonly [string, string]

const helpSections = (idleMinutes: number, hasChart: boolean): (readonly [string, readonly HelpEntry[]])[] => [
  [
    'Zeiten',
    [
      ['Aktiv', `Zeit, in der du in einer Session arbeitest, also tippst, liest oder kurz wartest. Nach ${idleMinutes} Minuten ohne Eingabe zählt Aktiv nicht weiter.`],
      ['Claude', 'Zeit, in der Claude rechnet oder Tools ausführt, auch in Subagents. Wartet ein Tool auf deine Freigabe, zählt das mit, eine Frage an dich nicht.'],
      ['Summe', 'Laufen zwei Sessions gleichzeitig, zählt die Zeit in beiden Projekten. „parallel“ zeigt, wie viel davon doppelt ist, die große Zahl oben zählt sie nur einmal.'],
      ['Soll', 'Dein Ziel für den Tag aus den Einstellungen. Ohne Eintrag zeigt timy keins.'],
    ],
  ],
  ...(hasChart
    ? [
        [
          'Grafik',
          [
            ['Heute', 'Pro Projekt ein dicker Balken für Aktiv und darunter ein dünner für Claude. Die graue Zeile zeigt, wann Sessions parallel liefen, der helle Strich steht auf jetzt.'],
            ['Woche', 'Ein Balken pro Tag, nach Projekten gestapelt, darüber die Summe. Der Monat sieht genauso aus. Die gestrichelte Linie ist das Soll.'],
          ],
        ] as const,
      ]
    : []),
]

const sumOf = (values: Iterable<number>) => [...values].reduce((sum, ms) => sum + ms, 0)

type Layout = { isSplit: boolean; columnWidth: number }

const layoutOf = (width: number): Layout => {
  const isSplit = width >= SPLIT_MIN_WIDTH
  return { isSplit, columnWidth: isSplit ? Math.floor((width - SPLIT_GAP) / 2) : width }
}

const pair = ({ Box }: Ui, { isSplit }: Layout, left: RenderNode, right: RenderNode | null) =>
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

const tabs = (p: PaneInput) => {
  const { Box, Button } = p.ui
  const tabButton = (key: string, label: string, hotkey: string, isCurrent: boolean, onPress: () => unknown) => (
    <Button
      key={`tab-${key}`}
      label={label}
      hotkey={hotkey}
      plain={isCurrent ? undefined : true}
      variant={isCurrent ? 'primary' : undefined}
      dimColor={!isCurrent}
      onPress={onPress}
    />
  )
  const periodButton = (tab: Tab, label: string, hotkey: string) => tabButton(tab, label, hotkey, !p.isHelp && p.tab === tab, () => p.onTab(tab))
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {periodButton('heute', 'Heute', '1')}
      {periodButton('woche', 'Woche', '2')}
      {periodButton('monat', 'Monat', '3')}
      {tabButton('hilfe', 'Hilfe', '4', p.isHelp, p.onHelp)}
    </Box>
  )
}

const viewSwitch = (p: PaneInput) => {
  if (p.svg === null) return null
  const { Button } = p.ui
  return p.view === 'grafik' ? (
    <Button key="view-tabelle" label="Tabelle" hotkey="t" plain dimColor onPress={() => p.onView('tabelle')} />
  ) : (
    <Button key="view-grafik" label="Grafik" hotkey="g" plain dimColor onPress={() => p.onView('grafik')} />
  )
}

const heading = (p: PaneInput, report: Report) => {
  const { Box, Text, Button } = p.ui
  const key = PAGE_KEY[p.tab]
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Button key={`${key}-prev`} plain label="←" onPress={() => p.onPage(-1)} />
      <Text bold>{report.title}</Text>
      {p.offset < 0 ? <Button key={`${key}-next`} plain label="→" onPress={() => p.onPage(1)} /> : null}
      {p.isLoading ? <Text dimColor>lädt …</Text> : null}
      <Box flexGrow={1} />
      {viewSwitch(p)}
    </Box>
  )
}

const todayLine = (report: Report) => {
  const claude = unionLength(report.spans, 'claude', report.from, report.to)
  const parallel = sumOf(parallelRanges(report.spans, report.from, report.to).map(([a, b]) => b - a))
  return parallel > 0 ? `Claude ${hm(claude)} · parallel ${hm(parallel)}` : `Claude ${hm(claude)}`
}

const card = ({ ui, tab }: PaneInput, report: Report) => {
  const { Box, Text } = ui
  const target = sumOf(report.days.map(day => day.target))
  const active = sumOf(report.days.map(day => day.active))
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text bold>{hm(active)}</Text>
        <Text dimColor>{target > 0 ? `von ${hm(target)} aktiv` : 'aktiv'}</Text>
        <Box flexGrow={1} />
        {target > 0 ? <Text dimColor>{`${planPercent(active, target)} %`}</Text> : null}
      </Box>
      {target > 0 ? fullBar(ui, active, target) : null}
      {tab === 'heute' ? <Text dimColor>{todayLine(report)}</Text> : null}
    </Box>
  )
}

type SelectedRow = ChartRow & { selected: number }

const chartRowsOf = (report: Report): SelectedRow[] =>
  report.summary.rows
    .filter(row => isShown(row.selected) || isShown(row.claude))
    .map(row => ({ project: row.project, name: shortProject(row.project), color: colorOf(report.colors, row.project), selected: row.selected }))

const chart = ({ ui, tab, width }: PaneInput, Svg: SvgElement, report: Report, rows: SelectedRow[]) => {
  const { Box, Text } = ui
  const px = width * PX_PER_COLUMN
  const alt = rows.map(row => `${row.name} ${hm(row.selected)}`).join(', ')
  if (tab !== 'heute') {
    const bars = barsSvg({ days: report.days, rows, width: px })
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor>Stunden aktiv pro Tag</Text>
        <Svg source={bars.source} width={bars.width} height={bars.height} alt={`Stunden pro Tag: ${alt}`} isInteractive />
      </Box>
    )
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      {rows.length === 0 ? (
        <Text dimColor>Heute noch nichts gezählt.</Text>
      ) : (
        <Svg
          {...timelineSvg({ spans: report.spans, rows, from: report.from, to: report.to, now: report.now, width: px })}
          alt={`Zeitleiste heute: ${alt}`}
          isInteractive
        />
      )}
    </Box>
  )
}

const LIMITS: readonly [string, readonly HelpEntry[]] = [
  'Grenzen',
  [
    ['Grob', 'timy misst nur, was in Claude passiert. Meetings, Calls und andere Apps fehlen, deshalb ersetzt timy nicht das Buchen deiner Zeiten.'],
    ['Tag', 'Ein Tag beginnt um 4 Uhr, Arbeit nach Mitternacht zählt also noch zum Vortag.'],
    ['Daten', 'Alles bleibt auf deinem Rechner im Datenordner von timy, nichts wird verschickt.'],
  ],
]

type KeyRow = readonly [readonly string[], string]

const FOCUS_CHORD = ['ctrl', '+', 'x', 'dann', 'tab']

const keyRows = (hasChart: boolean): KeyRow[] => [
  [['1', '2', '3'], 'Heute, Woche, Monat'],
  [['4'], 'Hilfe'],
  ...(hasChart ? ([[['G', 'T'], 'Grafik, Tabelle']] as const) : []),
  [['esc'], 'Pane schließen'],
]

const chord = ({ Box, Text }: Ui, tokens: readonly string[]) => (
  <Box flexDirection="row" columnGap={1}>
    {tokens.map((token, i) =>
      JOINERS.has(token) ? (
        <Text key={`${token}-${i}`} dimColor>
          {token}
        </Text>
      ) : (
        <Text key={`${token}-${i}`} backgroundColor="subtle" color="text">
          {` ${token} `}
        </Text>
      ),
    )}
  </Box>
)

const keys = (ui: Ui, hasChart: boolean) => {
  const { Box, Text } = ui
  return (
    <Box key="help-Tasten" flexDirection="column">
      <Text bold>Tasten</Text>
      <Text dimColor>Die Tasten wirken, wenn das Pane den Fokus hat. Dafür klickst du hinein oder drückst</Text>
      <Box marginY={1}>{chord(ui, FOCUS_CHORD)}</Box>
      <Box flexDirection="column" rowGap={1}>
        {keyRows(hasChart).map(([tokens, label]) => (
          <Box key={`help-keys-${tokens.join('')}`} flexDirection="row">
            <Box width={TERM_WIDTH} flexShrink={0}>
              {chord(ui, tokens)}
            </Box>
            <Text>{label}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Mit ← und → neben dem Titel blätterst du per Klick. In Woche und Monat klappt ein Klick auf ein Projekt in der Tabelle seine Sessions auf.</Text>
      </Box>
    </Box>
  )
}

const note = ({ Box, Text }: Ui, [term, text]: HelpEntry) => (
  <Box key={`help-${term}`} flexDirection="row" alignItems="flex-start">
    <Box width={TERM_WIDTH} flexShrink={0}>
      <Text dimColor>{term}</Text>
    </Box>
    <Box flexShrink={1}>
      <Text>{text}</Text>
    </Box>
  </Box>
)

const helpSection = (ui: Ui, [title, entries]: readonly [string, readonly HelpEntry[]]) => {
  const { Box, Text } = ui
  return (
    <Box key={`help-${title}`} flexDirection="column">
      <Text bold>{title}</Text>
      {entries.map(entry => note(ui, entry))}
    </Box>
  )
}

const help = (p: PaneInput) => {
  const { Box } = p.ui
  return (
    <Box flexDirection="column" marginTop={1} rowGap={1} width={Math.min(p.width, HELP_MAX_WIDTH)}>
      {helpSections(p.idleMinutes, p.svg !== null).map(section => helpSection(p.ui, section))}
      {keys(p.ui, p.svg !== null)}
      {helpSection(p.ui, LIMITS)}
    </Box>
  )
}

const folding = (p: PaneInput, isGrafik: boolean): Folding => {
  if (isGrafik) return allOpen(false)
  if (p.tab === 'heute') return allOpen(true)
  return { isOpen: project => p.unfolded.has(project), toggle: p.onToggle }
}

const perDay = ({ ui }: PaneInput, layout: Layout, report: Report) => {
  const { Box, Text } = ui
  const hasTarget = report.days.some(day => day.target > 0)
  const targets = new Set(report.days.filter(day => day.active > 0).map(day => day.target))
  const sameTarget = targets.size === 1 && hasTarget ? [...targets][0]! : null
  const isTargetShown = sameTarget === null && hasTarget
  const rows = report.days
    .filter(day => day.active > 0)
    .map(
      (day): Row => ({
        key: `day-${day.labels[0]}`,
        name: day.labels[0]!,
        values: isTargetShown ? [hm(day.active), hm(day.target)] : [hm(day.active)],
        style: 'plain',
        ...(day.target > 0 ? { bar: { actual: day.active, planned: day.target } } : {}),
      }),
    )
  return (
    <Box flexDirection="column" marginTop={layout.isSplit ? 0 : 1}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold>Pro Tag</Text>
        {sameTarget === null ? null : <Text dimColor>{`Soll ${hm(sameTarget)}`}</Text>}
      </Box>
      {table(ui, dayColumns(isTargetShown), rows, layout.columnWidth, 1)}
    </Box>
  )
}

export const renderPane = (p: PaneInput) => {
  const { Box, Text } = p.ui
  const Svg = p.view === 'grafik' ? p.svg : null
  const report = p.report
  if (p.isHelp) {
    return (
      <Box flexDirection="column">
        {tabs(p)}
        {help(p)}
        {p.theirs}
      </Box>
    )
  }
  if (report === null) {
    return (
      <Box flexDirection="column">
        {tabs(p)}
        <Box marginTop={1}>
          <Text dimColor>lädt …</Text>
        </Box>
        {p.theirs}
      </Box>
    )
  }
  const layout = layoutOf(p.width)
  const rows = chartRowsOf(report)
  const dots = Svg === null ? new Map<string, string>() : new Map(rows.map(row => [row.project, row.color]))
  const active = sumOf(report.days.map(day => day.active))
  const claude = p.tab === 'heute' ? unionLength(report.spans, 'claude', report.from, report.to) : null
  const overlap = overlapOf(report.summary, active, claude)
  const summary = table(p.ui, COLUMNS, summaryRows(report.summary, folding(p, Svg !== null), dots, overlap), layout.columnWidth)
  const hasPerDay = Svg === null && p.tab !== 'heute' && report.days.some(day => day.active > 0)
  return (
    <Box flexDirection="column">
      {tabs(p)}
      <Box flexDirection="column">
        <Box flexDirection="column" marginTop={1}>
          {heading(p, report)}
          {card(p, report)}
          {Svg !== null ? <Box marginBottom={1}>{chart(p, Svg, report, rows)}</Box> : null}
        </Box>
        {pair(p.ui, layout, summary, hasPerDay ? perDay(p, layout, report) : null)}
      </Box>
      {p.theirs}
    </Box>
  )
}
