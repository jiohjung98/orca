import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { coordinatorMocks, moduleMocks, handleMock } = await vi.hoisted(async () => {
  const moduleMocks =
    await import('../../github/pull-requests/refresh/pr-refresh-coordinator-test-mocks')
  return {
    coordinatorMocks: moduleMocks.createPRRefreshCoordinatorMocks(),
    moduleMocks,
    handleMock: vi.fn()
  }
})

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('../../github/pull-requests/refresh/pr-refresh-renderer-port', () =>
  moduleMocks.rendererPortModuleMock(coordinatorMocks)
)
vi.mock('../../github/client/lookup/pr-for-branch-outcome', () =>
  moduleMocks.clientModuleMock(coordinatorMocks)
)
vi.mock('../../github/repositories/github-api-repository-remote-probe', () =>
  moduleMocks.githubApiRepositoryModuleMock(coordinatorMocks)
)
vi.mock('../../github/api/rate-limit', () => moduleMocks.rateLimitModuleMock(coordinatorMocks))

import { makePR } from '../../github/pull-requests/refresh/pr-refresh-coordinator-test-harness'

const { getPRForBranchOutcomeMock } = coordinatorMocks
const START_AT = 1_000
const repo = { id: 'repo-1', path: '/repo', displayName: 'repo', badgeColor: '#000', addedAt: 0 }
const store = {
  getRepo: (id: string) => (id === repo.id ? repo : null),
  getRepos: () => [repo],
  getProjects: () => [],
  getSettings: () => ({ localWindowsRuntimeDefault: { kind: 'windows-host' } })
}
const sender = { id: 7, on: vi.fn(), once: vi.fn(), off: vi.fn(), removeListener: vi.fn() }

function startArgs(repoId: string, repoPath: string) {
  return {
    clientEpoch: { scope: 'panel', counter: 1 },
    cacheKey: '/repo::feature/test',
    identity: {
      sourceEpoch: 'renderer:a',
      repoId,
      repoPath,
      worktreeId: 'wt-1',
      branch: 'feature/test',
      currentHeadOid: 'h2',
      executionHostId: null,
      provider: 'github' as const,
      linkedPRNumber: null,
      fallbackPRNumber: 7,
      fallbackPRSource: 'hosted-review' as const,
      selectionRevision: '|||||'
    }
  }
}

function field(value: unknown, key: string): string & Record<string, unknown> {
  const found: unknown =
    typeof value === 'object' && value !== null && key in value
      ? Reflect.get(value, key)
      : undefined
  if (found === undefined) {
    throw new Error(`missing ${key}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reads either a string id/token or a nested snapshot object by key.
  return found as string & Record<string, unknown>
}

async function register(): Promise<(channel: string, args: unknown) => Promise<unknown>> {
  const { registerGitHubPRDetailRecoveryHandlers } =
    await import('./github-pr-detail-recovery-handlers')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: repo validation and routing read only getRepo(s), getProjects and getSettings.
  registerGitHubPRDetailRecoveryHandlers(store as never)
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>(
    handleMock.mock.calls.map(([channel, handler]) => [channel, handler])
  )
  return async (channel, args) => handlers.get(channel)?.({ sender }, args)
}

describe('native PR detail recovery handlers', () => {
  beforeEach(() => {
    moduleMocks.resetPRRefreshCoordinatorMocks(coordinatorMocks)
    handleMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refuses an unregistered repo and reads a registered one once, through the drainer', async () => {
    getPRForBranchOutcomeMock.mockResolvedValue({
      kind: 'found',
      pr: makePR({ number: 8 }),
      fetchedAt: START_AT
    })
    const invoke = await register()
    expect(
      await invoke('gh:startPRDetailRecovery', startArgs('other', '/elsewhere'))
    ).toMatchObject({
      terminal: { kind: 'not-admitted', reason: 'validation' }
    })

    const started = await invoke('gh:startPRDetailRecovery', startArgs('repo-1', '/repo'))
    const ticketId = field(started, 'ticketId')
    await vi.advanceTimersByTimeAsync(0)
    const prepared = await invoke('gh:waitPRDetailRecovery', { ticketId, afterRevision: 0 })
    await invoke('gh:commitPRDetailRecovery', {
      ticketId,
      prepareToken: field(field(prepared, 'preparation'), 'token'),
      publicationGrantId: 'grant-1'
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(await invoke('gh:waitPRDetailRecovery', { ticketId, afterRevision: 0 })).toMatchObject({
      admitted: true,
      terminal: { kind: 'settled', outcome: { pr: { number: 8 } } }
    })
    expect(getPRForBranchOutcomeMock).toHaveBeenCalledTimes(1)
    expect(getPRForBranchOutcomeMock.mock.calls[0][0]).toBe('/repo')
  })
})
