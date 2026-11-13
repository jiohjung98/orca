// @vitest-environment happy-dom

// The "New" line's spacing is set by classes alone (happy-dom has no layout): a full row gap above
// it and a trimmed one below, whichever row comes before it and whichever place it draws in.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NativeChatTranscriptRow,
  type NativeChatTranscriptRowContext
} from './NativeChatTranscriptRow'
import type { NativeChatMessageSlot } from '../../conversation/slots/native-chat-transcript-slots'
import type { NativeChatNewRowsMarkerState } from '../../viewport/new-rows/native-chat-new-rows-marker'

vi.mock('./NativeChatMessageRow', () => ({
  MessageRow: () => <div data-testid="message" />
}))
vi.mock('../../conversation/turns/NativeChatWorkingStatus', () => ({
  NativeChatWorkingStatus: () => <div data-testid="turn-bar" />
}))

afterEach(cleanup)

const context: NativeChatTranscriptRowContext = {
  expandSignal: false,
  revealedDiff: null,
  taskListPredecessors: new Map(),
  expandedTurnIds: new Set(),
  onToggleExpandedTurn: vi.fn(),
  subagentDisclosure: { setSectionOpen: vi.fn(), setRosterOpen: vi.fn() },
  onScrollMessageToTop: vi.fn(),
  onRevealDiff: vi.fn()
}

function slot(overrides: Partial<NativeChatMessageSlot> = {}): NativeChatMessageSlot {
  return {
    kind: 'message',
    message: {
      id: 'reply',
      role: 'assistant',
      source: 'transcript',
      timestamp: 1,
      blocks: [{ type: 'text', text: 'reply' }]
    },
    turnKey: 'turn',
    activeTurnIsWorking: true,
    trailingRun: false,
    receipt: undefined,
    status: undefined,
    folded: false,
    drawsMessage: true,
    turnFolds: false,
    turnDiff: undefined,
    subagentRoster: undefined,
    depth: 0,
    estimatedHeight: 40,
    ...overrides
  }
}

function marker(
  place: NativeChatNewRowsMarkerState['place'],
  look: NativeChatNewRowsMarkerState['look'] = 'line'
): NativeChatNewRowsMarkerState {
  return {
    key: 'reply',
    place,
    look,
    arriving: false,
    watching: false,
    onArrived: vi.fn(),
    onDismiss: vi.fn(),
    onMeasured: vi.fn(),
    onFaded: vi.fn()
  }
}

/** The row's own flex column, which carries its gap and any pull-up margin. */
function rowBox(view: ReturnType<typeof render>): HTMLElement {
  const box = view.container.firstElementChild
  if (!(box instanceof HTMLElement)) {
    throw new Error('The row drew nothing')
  }
  return box
}

describe('NativeChatTranscriptRow New line spacing', () => {
  it('keeps the full row gap above the line when it follows a row that pulls up', () => {
    const continuing = slot({ continuesTurn: true })
    const alone = rowBox(render(<NativeChatTranscriptRow slot={continuing} context={context} />))
    // Without the line it still pulls the next step up, as before.
    expect(alone.className).toContain('-mb-3')
    cleanup()
    const above = rowBox(
      render(<NativeChatTranscriptRow slot={continuing} context={context} newRowsMarkerBelow />)
    )
    expect(above.className).not.toContain('-mb-3')
  })

  it.each(['above-row', 'above-turn-bar'] as const)(
    'trims the gap under the line the same way when it draws %s',
    (place) => {
      const view = render(
        <NativeChatTranscriptRow
          slot={slot({ status: { startedAt: 1, thinking: false, workedSeconds: null } })}
          context={context}
          newRowsMarker={marker(place)}
        />
      )
      const row = rowBox(view)
      const line = view.getByRole('separator')
      // Above the line: the window's row gap (above-row) or this row's gap-5 (above-turn-bar), 20px
      // at the default text size. Below it, -mb-1.5 trims the row's gap-5 to 14px. All of them
      // scale with the chat's spacing.
      expect(row.className).toContain('gap-5')
      expect(line.className.split(' ')).toContain('-mb-1.5')
      const order = [...row.children].map((child) =>
        child === line ? 'line' : child.getAttribute('data-testid')
      )
      expect(order).toEqual(
        place === 'above-row' ? ['line', 'message', 'turn-bar'] : ['message', 'line', 'turn-bar']
      )
    }
  )

  it('keeps the faded line in place at the same size', () => {
    const view = render(
      <NativeChatTranscriptRow
        slot={slot()}
        context={context}
        newRowsMarker={marker('above-row', 'faded')}
      />
    )
    // Faded, it is no longer a separator, but it still opens the row with the same trim.
    expect(view.queryByRole('separator')).toBeNull()
    const line = rowBox(view).firstElementChild
    expect(line?.getAttribute('aria-hidden')).toBe('true')
    expect(line?.className.split(' ')).toEqual(expect.arrayContaining(['-mb-1.5', 'opacity-0']))
  })
})
