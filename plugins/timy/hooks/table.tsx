import type { EngineInterface } from 'claude-code'

import { displayedTotal, fillColor, hm, planFilled, planPercent, shortProject } from './model'
import type { Summary } from './model'

export type Ui = ReturnType<EngineInterface['ui']['resolve']>

type BarColor = ReturnType<typeof fillColor>

export type Row = {
  key: string
  name: string
  values: string[]
  style: 'plain' | 'dim' | 'bold'
  isSum?: true
  dot?: string
  bar?: { actual: number; planned: number; color: BarColor }
  toggle?: { key: string; onPress: () => void }
}

type Column = { title: string; width: number; minBody: number; isBar?: true }

export const COLUMNS: Column[] = [
  { title: 'Aktiv', width: 8, minBody: 0 },
  { title: 'Tippen', width: 8, minBody: 52 },
  { title: 'Claude', width: 8, minBody: 44 },
]

const BAR_GAP = 2

export const dayColumns = (width: number, hasTarget: boolean, isTargetShown: boolean): Column[] => [
  COLUMNS[0]!,
  ...(isTargetShown ? [{ title: 'Soll', width: 7, minBody: 36 }] : []),
  ...(hasTarget ? [{ title: '', width: BAR_GAP + (width >= 80 ? 12 : 8), minBody: 52, isBar: true as const }] : []),
]

export const isShown = (ms: number) => hm(ms) !== '0:00'

export type Folding = { isOpen: (project: string) => boolean; toggle?: (project: string) => void }

export const allOpen = (isOpen: boolean): Folding => ({ isOpen: () => isOpen })

type SessionTimes = Summary['rows'][number]['sessions'][number]

const byLabel = (sessions: readonly SessionTimes[]): SessionTimes[] => {
  const merged = new Map<string, SessionTimes>()
  for (const s of sessions) {
    const known = merged.get(s.label)
    if (known) merged.set(s.label, { ...known, selected: known.selected + s.selected, writing: known.writing + s.writing, claude: known.claude + s.claude })
    else merged.set(s.label, s)
  }
  return [...merged.values()]
}

export const summaryRows = (summary: Summary, folding: Folding, dots: ReadonlyMap<string, string> = new Map()): Row[] => [
  ...summary.rows
    .filter(row => isShown(row.selected) || isShown(row.writing) || isShown(row.claude))
    .flatMap((row): Row[] => {
      const isOpen = folding.isOpen(row.project)
      const toggle = folding.toggle
      const dot = dots.get(row.project)
      return [
        {
          key: `row-${row.project}`,
          name: toggle ? `${isOpen ? '▾' : '▸'} ${shortProject(row.project)}` : shortProject(row.project),
          values: [hm(row.selected), hm(row.writing), hm(row.claude)],
          style: 'plain',
          ...(dot ? { dot } : {}),
          ...(toggle ? { toggle: { key: `toggle-${row.project}`, onPress: () => toggle(row.project) } } : {}),
        },
        ...(isOpen
          ? byLabel(row.sessions)
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
    isSum: true,
  },
]

export const bar = ({ Box }: Ui, filled: number, width: number, color: BarColor) => (
  <Box flexDirection="row" flexShrink={0}>
    {filled > 0 ? <Box width={filled} height={1} backgroundColor={color} /> : null}
    {filled < width ? <Box width={width - filled} height={1} backgroundColor="subtle" /> : null}
  </Box>
)

export const fullBar = ({ Box }: Ui, actual: number, planned: number) => {
  const percent = Math.min(100, planPercent(actual, planned))
  return (
    <Box flexDirection="row" flexGrow={1}>
      {percent > 0 ? <Box width={`${percent}%`} height={1} backgroundColor={fillColor(actual, planned)} /> : null}
      {percent < 100 ? <Box width={`${100 - percent}%`} height={1} backgroundColor="subtle" /> : null}
    </Box>
  )
}

export const table = (ui: Ui, columns: Column[], rows: Row[], width: number, rowGap = 0) => {
  const { Box, Text, Button } = ui
  const shown = columns.flatMap((column, i) => (width >= column.minBody ? [{ column, i }] : []))
  const line = (row: Row) => (
    <Box key={row.key} flexDirection="row">
      <Box flexGrow={1} minWidth={8} flexDirection="row" columnGap={1}>
        {row.dot ? <Text color={row.dot}>●</Text> : null}
        {row.toggle ? (
          <Button key={row.toggle.key} plain label={row.name} onPress={row.toggle.onPress} />
        ) : (
          <Text wrap="truncate-end" bold={row.style === 'bold'} dimColor={row.style === 'dim'}>
            {row.name}
          </Text>
        )}
      </Box>
      {shown.map(({ column, i }) => (
        <Box key={`${row.key}-${i}`} width={column.width} flexShrink={0} justifyContent="flex-end">
          {column.isBar ? (
            row.bar ? bar(ui, planFilled(row.bar.actual, row.bar.planned, column.width - BAR_GAP), column.width - BAR_GAP, row.bar.color) : null
          ) : (
            <Text wrap="truncate" bold={row.style === 'bold'} dimColor={row.style === 'dim'}>
              {row.values[i] ?? ''}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
  const sums = rows.filter(row => row.isSum)
  return (
    <Box flexDirection="column">
      {line({ key: 'head', name: '', values: columns.map(c => c.title), style: 'dim' })}
      <Box flexDirection="column" rowGap={rowGap}>
        {rows.filter(row => !row.isSum).map(line)}
      </Box>
      {sums.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {sums.map(line)}
        </Box>
      ) : null}
    </Box>
  )
}
