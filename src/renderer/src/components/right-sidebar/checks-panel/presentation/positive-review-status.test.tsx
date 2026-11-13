// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { store } = await vi.hoisted(async () => {
  const harness = await import('@/store/github/github-slice-test-harness')
  return { store: harness.createTestStore() }
})

vi.mock('@/store', () => ({ useAppStore: store }))

import { ChecksPanelPositiveReview } from './positive-review-status'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function Panel({ onRetry }: { onRetry: () => Promise<unknown> }): React.JSX.Element {
  return (
    <ChecksPanelPositiveReview
      detachedHeadDisplay={null}
      reviewShortLabel="PR"
      providerName="GitHub"
      reviewNumber={7}
      openReviewUrl="https://github.com/acme/widgets/pull/7"
      refresh={undefined}
      manualRefreshFailed={false}
      manualRetryInFlight={false}
      actionsDisabled={false}
      worktreeId="wt-1"
      recoveryKeys={{ prCacheKey: 'pr-key', contextKey: 'ctx' }}
      onRetry={onRetry}
      setRetrying={() => {}}
    />
  )
}

function spoken(): Element | null {
  return container.querySelector('[role="status"] .sr-only')
}

describe('ChecksPanelPositiveReview Retry', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps an unusable outcome after an unusable Retry and announces it again', async () => {
    store.setState({
      prDetailRecovery: { contextKey: 'ctx', status: { kind: 'unusable' }, terminalCount: 1 }
    })
    act(() => root.render(<Panel onRetry={() => Promise.resolve()} />))
    const before = spoken()
    expect(before?.textContent).toBe("Details can't be shown here")

    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry'
    )
    await act(async () => {
      retry?.click()
      await Promise.resolve()
    })

    expect(store.getState().prDetailRecovery?.status).toEqual({ kind: 'unusable' })
    expect(spoken()?.textContent).toBe("Details can't be shown here")
    expect(spoken()).not.toBe(before)
  })

  it('ignores recovery state recorded for another context', () => {
    store.setState({
      prDetailRecovery: { contextKey: 'other', status: { kind: 'timeout' }, terminalCount: 1 }
    })
    act(() => root.render(<Panel onRetry={() => Promise.resolve()} />))
    expect(spoken()?.textContent).toBe('Details not loaded')
  })
})
