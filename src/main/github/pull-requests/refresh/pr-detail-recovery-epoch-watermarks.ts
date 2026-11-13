import { PR_DETAIL_RECOVERY_RETENTION_MS } from '../../../../shared/github/pull-requests/refresh/pr-detail-recovery-contract'

/** One renderer instance uses one scope; more than this per caller means old, dead instances. */
const MAX_LIVE_SCOPES_PER_CALLER = 8
const MAX_WATERMARKS = 2_000
export const MAX_EPOCH_SCOPE_LENGTH = 128

export function isAdmissibleEpochScope(scope: string): boolean {
  return scope.length > 0 && scope.length <= MAX_EPOCH_SCOPE_LENGTH
}

type Watermark = { callerKey: string; counter: number; releasedAt: number | null }

/**
 * Accepted-epoch high-watermarks refuse replays of an older or retired epoch. Entries exist only
 * for accepted tickets and are reclaimed one retention window after their last ticket is forgotten:
 * IPC and runtime sockets are ordered and lossless, and the only same-epoch resend is the
 * renderer's bounded start resume, which ends inside the ticket lease. A start replayed after
 * reclaim could only recreate an uncommitted ticket; no client holds its token, so it expires
 * without provider work.
 */
export class PRDetailRecoveryEpochWatermarks {
  private readonly entries = new Map<string, Watermark>()

  get size(): number {
    return this.entries.size
  }

  isStale(epochKey: string, counter: number): boolean {
    const entry = this.entries.get(epochKey)
    return entry !== undefined && counter <= entry.counter
  }

  canAccept(callerKey: string, epochKey: string): boolean {
    if (this.entries.has(epochKey)) {
      return true
    }
    if (this.entries.size >= MAX_WATERMARKS) {
      return false
    }
    let live = 0
    for (const entry of this.entries.values()) {
      if (entry.callerKey === callerKey && entry.releasedAt === null) {
        live += 1
      }
    }
    return live < MAX_LIVE_SCOPES_PER_CALLER
  }

  accept(callerKey: string, epochKey: string, counter: number): void {
    this.entries.set(epochKey, { callerKey, counter, releasedAt: null })
  }

  /** The epoch's last ticket was forgotten; keep refusing replays for one more window. */
  release(epochKey: string, now = Date.now()): void {
    const entry = this.entries.get(epochKey)
    if (entry) {
      entry.releasedAt = now
    }
  }

  forgetCaller(callerKey: string): void {
    for (const [epochKey, entry] of this.entries) {
      if (entry.callerKey === callerKey) {
        this.entries.delete(epochKey)
      }
    }
  }

  /** Drops released entries past their replay window; returns the next reclaim deadline. */
  reclaim(now: number): number | null {
    let next = Number.POSITIVE_INFINITY
    for (const [epochKey, entry] of this.entries) {
      if (entry.releasedAt === null) {
        continue
      }
      const reclaimAt = entry.releasedAt + PR_DETAIL_RECOVERY_RETENTION_MS
      if (reclaimAt <= now) {
        this.entries.delete(epochKey)
      } else {
        next = Math.min(next, reclaimAt)
      }
    }
    return Number.isFinite(next) ? next : null
  }
}
