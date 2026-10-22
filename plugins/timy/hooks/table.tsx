import type { EngineInterface } from 'claude-code'

import { displayedTotal, fillColor, hm, planPercent, shortProject } from './model'
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
  bar?: { actual: number; planned: number }
  toggle?: { key: string; onPress: () => void }
}

type Column = { title: string; width: number; minBody: number }

export const COLUMNS: Column[] = [
  { title: 'Aktiv', width: 8, minBody: 0 },
  { title: 'Claude', width: 8, minBody: 28 },
]

export const dayColumns = (isTargetShown: boolean): Column[] => [COLUMNS[0]!, { ...COLUMNS[1]!, title: isTargetShown ? 'Soll' : '' }]

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

export type Overlap = { selected: number; claude: number | null }

export const overlapOf = (summary: Summary, selected: number, claude: number | null = null): Overlap => {
  const total = (kind: 'selected' | 'claude') => summary.rows.reduce((sum, row) => sum + row[kind], 0)
  return { selected: total('selected') - selected, claude: claude === null ? null : total('claude') - claude }
}

const overlapRows = (overlap: Overlap | null): Row[] =>
  overlap !== null && (isShown(overlap.selected) || (overlap.claude !== null && isShown(overlap.claude)))
    ? [{ key: 'overlap', name: 'davon parallel', values: [hm(overlap.selected), overlap.claude === null ? '' : hm(overlap.claude)], style: 'dim', isSum: true }]
    : []

export const summaryRows = (summary: Summary, folding: Folding, dots: ReadonlyMap<string, string> = new Map(), overlap: Overlap | null = null): Row[] => [
  ...summary.rows
    .filter(row => isShown(row.selected) || isShown(row.claude))
    .flatMap((row): Row[] => {
      const isOpen = folding.isOpen(row.project)
      const toggle = folding.toggle
      const dot = dots.get(row.project)
      return [
        {
          key: `row-${row.project}`,
          name: toggle ? `${isOpen ? '▾' : '▸'} ${shortProject(row.project)}` : shortProject(row.project),
          values: [hm(row.selected), hm(row.claude)],
          style: 'plain',
          ...(dot ? { dot } : {}),
          ...(toggle ? { toggle: { key: `toggle-${row.project}`, onPress: () => toggle(row.project) } } : {}),
        },
        ...(isOpen
          ? byLabel(row.sessions)
              .filter(s => s.label && (isShown(s.selected) || isShown(s.claude)))
              .map((s): Row => ({
                key: `session-${s.session}`,
                name: `  ${s.label}`,
                values: [hm(s.selected), hm(s.claude)],
                style: 'dim',
              }))
          : []),
      ]
    }),
  {
    key: 'sum',
    name: 'Summe',
    values: (['selected', 'claude'] as const).map(kind => hm(displayedTotal(summary.rows, kind))),
    style: 'bold',
    isSum: true,
  },
  ...overlapRows(overlap),
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
        {row.bar ? (
          <Box flexGrow={1} paddingRight={1}>
            {fullBar(ui, row.bar.actual, row.bar.planned)}
          </Box>
        ) : null}
      </Box>
      {shown.map(({ column, i }) => (
        <Box key={`${row.key}-${i}`} width={column.width} flexShrink={0} justifyContent="flex-end">
          <Text wrap="truncate" bold={row.style === 'bold'} dimColor={row.style === 'dim'}>
            {row.values[i] ?? ''}
          </Text>
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
