export type TimyView = {
  tab: 'heute' | 'woche' | 'monat'
  from: number
  to: number
  days: string[]
  actual: [project: string, ms: number][]
}

export type TimyPlanEntry = { project: string; name: string; hours: number }

declare module 'claude-code' {
  interface PluginState {
    timy: { band: number; pane: number; view: TimyView }
    'timy-moco': { targets: Record<string, number>; plans: Record<string, TimyPlanEntry[]> }
  }
}
