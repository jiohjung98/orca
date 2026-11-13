import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { ActiveAgentNotesSendFailureCode } from '@/lib/agent-session/messaging/terminal/active-agent-note-send-result'
import type { AgentMessageTarget } from '@/lib/agent-session/messaging/agent-message-target'
import { revealAgentTerminal } from '@/components/native-chat/selection-quotes/native-chat-workspace-selection'

/** Longest the toast says "pasting" before it asks for Enter, whatever the settle estimate. */
const MAX_PASTING_LINE_MS = 60_000

/** The toast action that shows and focuses the terminal holding a pasted note. */
function goToNoteTerminalAction(
  worktreeId: string,
  target: AgentMessageTarget,
  onClick?: () => void
): { action?: { label: string; onClick: () => void } } {
  if (target.kind !== 'terminal') {
    return {}
  }
  return {
    action: {
      label: translate('resourceManager.pty.goToTerminal', 'Go to terminal'),
      onClick: () => {
        onClick?.()
        revealAgentTerminal(worktreeId, target)
      }
    }
  }
}

/** The same action, for the refusal that says the terminal holds a note waiting for Enter. */
export function waitingNoteRefusalAction(
  code: ActiveAgentNotesSendFailureCode | undefined,
  worktreeId: string,
  target: AgentMessageTarget
): ReturnType<typeof goToNoteTerminalAction> {
  return code === 'terminal-draft-pending' ? goToNoteTerminalAction(worktreeId, target) : {}
}

/**
 * Says a note sits unsent in an agent's terminal: "pasting" until the terminal has taken it in,
 * then "press Enter", in the same toast. It stays until closed or until that terminal gets focus.
 * `toastId` replaces that send's pending toast.
 */
export function showNotePastedToast(args: {
  worktreeId: string
  target: AgentMessageTarget
  agentLabel: string
  settleMs?: number
  toastId?: string | number
}): void {
  const { worktreeId, target, agentLabel, settleMs = 0, toastId } = args
  let timer: ReturnType<typeof setTimeout> | undefined
  const onFocusIn = (event: FocusEvent): void => {
    if (target.kind !== 'terminal' || !(event.target instanceof Element)) {
      return
    }
    const pane = `[data-terminal-tab-id="${CSS.escape(target.tabId)}"] [data-leaf-id="${CSS.escape(target.leafId)}"]`
    if (event.target.closest(pane)) {
      toast.dismiss(id)
      stop()
    }
  }
  const stop = (): void => {
    clearTimeout(timer)
    timer = undefined
    document.removeEventListener('focusin', onFocusIn)
  }
  const options = {
    duration: Infinity,
    onDismiss: stop,
    ...goToNoteTerminalAction(worktreeId, target, stop)
  }
  const pressEnter = translate(
    'components.agentNotes.pastedPressEnter',
    'Note pasted into {{agent}}. Press Enter there to send.',
    { agent: agentLabel }
  )
  const id = toast.info(
    settleMs > 0
      ? translate('components.agentNotes.pastingNote', 'Pasting note into {{agent}}…', {
          agent: agentLabel
        })
      : pressEnter,
    { ...(toastId === undefined ? {} : { id: toastId }), ...options }
  )
  document.addEventListener('focusin', onFocusIn)
  if (settleMs > 0) {
    timer = setTimeout(
      () => {
        timer = undefined
        toast.info(pressEnter, { id, ...options })
      },
      Math.min(settleMs, MAX_PASTING_LINE_MS)
    )
  }
}
