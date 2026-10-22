import { describe, expect, test } from 'claude-code/testing'

import { allOpen, summaryRows } from './table'

const MIN = 60_000

describe('summaryRows', () => {
  test('sessions with the same title share one row', () => {
    const rows = summaryRows(
      {
        rows: [
          {
            project: 'firma/blog',
            selected: 65 * MIN,
            writing: 4 * MIN,
            claude: 40 * MIN,
            sessions: [
              { session: 'a', label: 'Kommentare', selected: 50 * MIN, writing: 3 * MIN, claude: 32 * MIN },
              { session: 'b', label: 'Kommentare', selected: 15 * MIN, writing: MIN, claude: 8 * MIN },
            ],
          },
        ],
      },
      allOpen(true),
    )
    expect(rows.filter(row => row.name.trim() === 'Kommentare').map(row => row.values)).toEqual([['1:05', '0:40']])
  })
})
