import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'

const laneTails = new Map<string, Promise<void>>()
const unsentPastes = new Map<string, UnsentTerminalPaste>()

/** A paste this window left in a terminal without its Enter. */
export type UnsentTerminalPaste = {
  /** `Date.now()` after which an Enter would submit it rather than land inside it. */
  settlesAt: number
  /** The terminal's last input right after the paste; a different one since means it took other input. */
  inputGeneration?: number
  /** The user was told to press Enter there, so no later send may submit it for them. */
  awaitsUserEnter: boolean
}

export type TerminalSendLane = {
  unsentPaste: () => UnsentTerminalPaste | undefined
  /** Remembers, or with `undefined` forgets, the paste left unsent in this terminal. */
  setUnsentPaste: (paste: UnsentTerminalPaste | undefined) => void
}

/** Runs one terminal's sends one at a time, in arrival order, so a send's Enter cannot land inside
 *  another send's paste. Orders this window's calls only: a send that rejects frees the lane while
 *  the host may still be working on it. The lane is free as soon as a send has its result.
 *  A send that cannot start within `maxWaitMs` never runs: it answers `{ laneBusy: true }`. */
export async function runInTerminalSendLane<T>(
  runtimeTarget: RuntimeClientTarget,
  terminalHandle: string,
  send: (lane: TerminalSendLane) => Promise<T>,
  maxWaitMs: number
): Promise<T | { laneBusy: true }> {
  const runtime =
    runtimeTarget.kind === 'environment' ? `environment:${runtimeTarget.environmentId}` : 'local'
  const key = `${runtime}\n${terminalHandle}`
  const previous = laneTails.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const tail = new Promise<void>((resolve) => {
    release = resolve
  })
  laneTails.set(key, tail)
  void tail.then(() => {
    if (laneTails.get(key) === tail) {
      laneTails.delete(key)
    }
  })
  if (!(await turnCameWithin(previous, maxWaitMs))) {
    // Leaving the queue must not let the send behind overtake the one ahead.
    void previous.then(release)
    return { laneBusy: true }
  }
  try {
    return await send({
      unsentPaste: () => unsentPastes.get(key),
      setUnsentPaste: (paste) => {
        if (paste) {
          unsentPastes.set(key, paste)
        } else {
          unsentPastes.delete(key)
        }
      }
    })
  } finally {
    release()
  }
}

function turnCameWithin(previous: Promise<void>, maxWaitMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), maxWaitMs)
    void previous.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}
