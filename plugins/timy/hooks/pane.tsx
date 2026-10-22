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
  view: View
  offset: number
  isLoading: boolean
  report: Report | null
  unfolded: ReadonlySet<string>
  theirs: RenderNode
  onTab: (tab: Tab) => Promise<void>
  onView: (view: View) => void
  onPage: (step: number) => Promise<void>
  onToggle: (project: string) => void
}

const PX_PER_COLUMN = 8
const SPLIT_MIN_WIDTH = 110
const SPLIT_GAP = 3
const PAGE_KEY = { heute: 'day', woche: 'week', monat: 'month' } as const
const TERM_WIDTH = 8
const NOTES = [
  ['Aktiv', 'Zeit, in der du in einer Session arbeitest. Lesen und kurze Pausen zählen mit.'],
  ['Claude', 'Zeit, in der Claude rechnet oder Tools ausführt, auch in Subagents.'],
  [
    'Hinweis',
    'timy misst nur, was in Claude passiert. Meetings, Calls und andere Apps fehlen. Parallele Sessions zählen in der Summe mehrfach. Ersetzt nicht das Buchen deiner Zeiten.',
  ],
] as const

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
  const tabButton = (tab: Tab, label: string, hotkey: string) => (
    <Button
      key={`tab-${tab}`}
      label={label}
      hotkey={hotkey}
      plain={p.tab !== tab ? true : undefined}
      variant={p.tab === tab ? 'primary' : undefined}
      dimColor={p.tab !== tab}
      onPress={() => p.onTab(tab)}
    />
  )
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {tabButton('heute', 'Heute', '1')}
      {tabButton('woche', 'Woche', '2')}
      {tabButton('monat', 'Monat', '3')}
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
      {rows.length === 0 ? null : <Text dimColor>Dicker Balken aktiv, dünner Balken Claude, grau parallel, Strich jetzt</Text>}
    </Box>
  )
}

const note = ({ Box, Text }: Ui, [term, text]: readonly [string, string]) => (
  <Box key={`note-${term}`} flexDirection="row" alignItems="flex-start">
    <Box width={TERM_WIDTH} flexShrink={0}>
      <Text dimColor>{term}</Text>
    </Box>
    <Box flexShrink={1}>
      <Text dimColor>{text}</Text>
    </Box>
  </Box>
)

const glossary = (ui: Ui) => {
  const { Box } = ui
  return (
    <Box flexDirection="column" marginTop={2} rowGap={1}>
      {NOTES.map(n => note(ui, n))}
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
  const rows = report.days
    .filter(day => day.active > 0)
    .map(
      (day): Row => ({
        key: `day-${day.labels[0]}`,
        name: day.labels[0]!,
        values: sameTarget === null ? [hm(day.active), hm(day.target)] : [hm(day.active)],
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
      {table(ui, dayColumns(sameTarget === null && hasTarget), rows, layout.columnWidth, 1)}
    </Box>
  )
}

export const renderPane = (p: PaneInput) => {
  const { Box, Text } = p.ui
  const Svg = p.view === 'grafik' ? p.svg : null
  const report = p.report
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
        {glossary(p.ui)}
      </Box>
      {p.theirs}
    </Box>
  )
}
