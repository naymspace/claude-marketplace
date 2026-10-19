export type TimyView = {
  tab: 'heute' | 'woche' | 'monat'
  days: string[]
  actual: [project: string, ms: number][]
}

declare module 'claude-code' {
  interface PluginState {
    timy: { band: number; pane: number; view: TimyView }
  }
}
