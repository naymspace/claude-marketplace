import { pad } from './model'
import { addDays, dayStart, monthStart, weekStart } from './store'
import type { TimyView } from '../types'

export type Tab = TimyView['tab']

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const addMonths = (t: number, months: number) => {
  const d = new Date(t)
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

export const rangeOf = (tab: Tab, now: number, offset: number): [number, number] => {
  if (tab === 'heute') {
    const from = addDays(dayStart(now), offset)
    return [from, addDays(from, 1)]
  }
  if (tab === 'woche') {
    const from = addDays(weekStart(now), 7 * offset)
    return [from, addDays(from, 7)]
  }
  const from = addMonths(monthStart(now), offset)
  return [from, addMonths(from, 1)]
}

export const dayLabel = (t: number) => {
  const d = new Date(t)
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`
}

export const periodTitle = (tab: Tab, offset: number, from: number, now: number): string => {
  if (tab === 'heute') return offset === 0 ? `Heute, ${dayLabel(now)}` : dayLabel(from)
  if (tab === 'woche') return offset === 0 ? 'Diese Woche' : `Woche ab ${dayLabel(from)}`
  const d = new Date(from)
  return offset === 0 ? 'Dieser Monat' : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
