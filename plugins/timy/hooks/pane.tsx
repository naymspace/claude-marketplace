import type { RenderNode } from 'claude-code'

import { barsSvg, colorOf, parallelRanges, timelineSvg } from './charts'
import type { ChartDay, ChartRow } from './charts'
import { fillColor, hm, planPercent, shortProject, unionLength } from './model'
import type { Span, Summary } from './model'
import type { Tab } from './period'
import { COLUMNS, allOpen, dayColumns, fullBar, isShown, summaryRows, table } from './table'
import type { Folding, Row, Ui } from './table'

export type View = 'grafik' | 'tabelle'

export type Report = {
  from: number
  to: number
  title: string
  now: number
  summary: Summary
  spans: Span[]
  days: (ChartDay & { key: string; active: number })[]
}

type SvgElement = Extract<Ui, { Svg: unknown }>['Svg']

export type PaneInput = {
  ui: Ui
  svg: SvgElement | null
  width: number
  tab: Tab
  view: View
  offset: number
  isLoading: boolean
  report: Report | null
  unfolded: ReadonlySet<string>
  addons: RenderNode
  onTab: (tab: Tab) => Promise<void>
  onView: (view: View) => void
  onPage: (step: number) => Promise<void>
  onToggle: (project: string) => void
}

const PX_PER_COLUMN = 8
const SPLIT_MIN_WIDTH = 110
const SPLIT_GAP = 3
const PAGE_KEY = { heute: 'day', woche: 'week', monat: 'month' } as const

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
  const viewButton = (view: View, label: string, hotkey: string) => (
    <Button key={`view-${view}`} label={label} hotkey={hotkey} plain dimColor={p.view !== view} onPress={() => p.onView(view)} />
  )
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {tabButton('heute', 'Heute', '1')}
      {tabButton('woche', 'Woche', '2')}
      {tabButton('monat', 'Monat', '3')}
      {p.svg === null ? null : <Box flexGrow={1} />}
      {p.svg === null ? null : viewButton('grafik', 'Grafik', 'g')}
      {p.svg === null ? null : viewButton('tabelle', 'Tabelle', 't')}
    </Box>
  )
}

const heading = (p: PaneInput, report: Report) => {
  const { Box, Text, Button } = p.ui
  const key = PAGE_KEY[p.tab]
  return (
    <Box flexDirection="row" columnGap={2}>
      <Button key={`${key}-prev`} plain label="‹" onPress={() => p.onPage(-1)} />
      <Text bold>{report.title}</Text>
      {p.offset < 0 ? <Button key={`${key}-next`} plain label="›" onPress={() => p.onPage(1)} /> : null}
      {p.isLoading ? <Text dimColor>lädt …</Text> : null}
    </Box>
  )
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
      {tab === 'heute' ? (
        <Text dimColor>
          {`Claude ${hm(unionLength(report.spans, 'claude', report.from, report.to))} · parallel ${hm(sumOf(parallelRanges(report.spans, report.from, report.to).map(([a, b]) => b - a)))}`}
        </Text>
      ) : null}
    </Box>
  )
}

type SelectedRow = ChartRow & { selected: number }

const chartRowsOf = (report: Report): SelectedRow[] =>
  report.summary.rows
    .filter(row => isShown(row.selected) || isShown(row.claude))
    .map(row => ({ project: row.project, name: shortProject(row.project), selected: row.selected }))

const chart = ({ ui, tab, width }: PaneInput, Svg: SvgElement, report: Report, rows: SelectedRow[]) => {
  const { Box, Text } = ui
  const px = width * PX_PER_COLUMN
  const alt = rows.map(row => `${row.name} ${hm(row.selected)}`).join(', ')
  if (tab !== 'heute') {
    const bars = barsSvg({ days: report.days, rows, width: px })
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor>Aktiv pro Tag</Text>
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

const folding = (p: PaneInput, isGrafik: boolean): Folding => {
  if (isGrafik) return allOpen(false)
  if (p.tab === 'heute') return allOpen(true)
  return { isOpen: project => p.unfolded.has(project), toggle: p.onToggle }
}

const perDay = ({ ui }: PaneInput, layout: Layout, report: Report) => {
  const { Box, Text } = ui
  const hasTarget = report.days.some(day => day.target > 0)
  const rows = report.days
    .filter(day => day.active > 0)
    .map(
      (day): Row => ({
        key: `day-${day.label}`,
        name: day.label,
        values: [hm(day.active), hm(day.target)],
        style: 'plain',
        ...(day.target > 0 ? { bar: { actual: day.active, planned: day.target, color: fillColor(day.active, day.target) } } : {}),
      }),
    )
  return (
    <Box flexDirection="column" marginTop={layout.isSplit ? 0 : 1}>
      <Text bold>Pro Tag</Text>
      {table(ui, dayColumns(layout.columnWidth, hasTarget), rows, layout.columnWidth)}
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
        {p.addons}
      </Box>
    )
  }
  const layout = layoutOf(p.width)
  const rows = chartRowsOf(report)
  const dots = Svg === null ? new Map<string, string>() : new Map(rows.map((row, i) => [row.project, colorOf(i)]))
  const summary = table(p.ui, COLUMNS, summaryRows(report.summary, folding(p, Svg !== null), dots), layout.columnWidth)
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
      {p.addons}
    </Box>
  )
}
