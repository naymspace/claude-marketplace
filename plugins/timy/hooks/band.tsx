import type { RenderNode } from 'claude-code'

import { fillColor, hm, hms, planFilled } from './model'
import type { Summary, ZeitEvent } from './model'
import { COLUMNS, allOpen, bar, summaryRows, table } from './table'
import type { Ui } from './table'

export type Live = {
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
}

type BandInput = {
  ui: Ui
  live: Live
  target: number
  width: number
  maxRows: number
  isUnfolded: boolean
  theirs: RenderNode
  onToggle: () => void
  onOpen: () => Promise<void>
}

const BAND_SHORT_BELOW = 48
const BAND_BAR_FROM = 60
const BAND_BAR_WIDTH = 6

export const renderBandNote = ({ Box, Text }: Ui, note: string, theirs: RenderNode) => (
  <Box flexDirection="column">
    <Text dimColor>{note}</Text>
    {theirs}
  </Box>
)

export const renderBand = ({ ui, live, target, width, maxRows, isUnfolded, theirs, onToggle, onOpen }: BandInput) => {
  const { Box, Text, Button } = ui
  const isShort = width < BAND_SHORT_BELOW
  const projectToday = hm(live.projectOthers + live.sessionToday)
  const arrow = isUnfolded ? '▴' : '▾'
  const dayTotal = live.dayAtRefresh + live.sessionToday - live.sessionAtRefresh
  const band = (
    <Box flexDirection="column">
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
            onPress={onToggle}
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
        <Button key="zeit-open" plain dimColor label="⤢" onPress={onOpen} />
      </Box>
      {theirs}
    </Box>
  )
  if (!isUnfolded) return band
  const room = maxRows - 3
  const full = summaryRows(live.today, allOpen(true))
  const rows = full.length <= room ? full : summaryRows(live.today, allOpen(false))
  return (
    <Box flexDirection="column">
      {band}
      <Box marginTop={1}>{table(ui, COLUMNS, rows, width)}</Box>
    </Box>
  )
}
