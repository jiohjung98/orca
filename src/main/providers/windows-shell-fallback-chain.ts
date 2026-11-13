import { win32 as pathWin32 } from 'node:path'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import type { WindowsShellWslContext } from './windows-shell-args'
import { resolveWindowsPowerShellSpawnChain } from './windows-powershell-executable'
import { isPreviewPwshPath } from './windows-pwsh-discovery'

export type WindowsShellSpawnAttempt = {
  shellPath: string
  shellArgs: string[]
  effectiveCwd: string
  validationCwd: string
  startupCommandDeliveredInShellArgs: boolean
}

function toAttempt(
  shellPath: string,
  cwd: string,
  defaultCwd: string,
  wslContext: WindowsShellWslContext | undefined,
  startupCommand: string | undefined,
  startupNotice?: string
): WindowsShellSpawnAttempt {
  const resolved = resolveWindowsShellLaunchArgs(
    shellPath,
    cwd,
    defaultCwd,
    wslContext,
    startupCommand,
    undefined,
    startupNotice
  )
  return {
    shellPath,
    shellArgs: resolved.shellArgs,
    effectiveCwd: resolved.effectiveCwd,
    validationCwd: resolved.validationCwd,
    startupCommandDeliveredInShellArgs: resolved.startupCommandDeliveredInShellArgs === true
  }
}

function pwshNotFoundNotice(fallbackShellPath: string): string {
  const fallback =
    pathWin32.basename(fallbackShellPath).toLowerCase() === 'powershell.exe'
      ? 'Windows PowerShell'
      : 'Command Prompt'
  return `[Orca could not find PowerShell 7 (pwsh.exe), so this terminal opened ${fallback} instead.]`
}

/** Requested PowerShell → inbox PowerShell → cmd.exe, with absolute ConPTY-safe paths and per-shell argv.
 * Store alias stubs fail CreateProcessW (5); non-PowerShell requests retain their single-shell path. */
export async function buildWindowsPowerShellSpawnAttempts(args: {
  shellPath: string
  cwd: string
  defaultCwd: string
  wslContext?: WindowsShellWslContext
  startupCommand?: string
  /** The environment the terminal will get, so PATH lookups see what the shell will see. */
  env: NodeJS.ProcessEnv
  /** The shell setting as requested (name or path) and the PowerShell version setting. */
  requestedShell: string
  powerShellImplementation: string | undefined
}): Promise<WindowsShellSpawnAttempt[]> {
  const basename = pathWin32.basename(args.shellPath).toLowerCase()
  if (basename !== 'pwsh.exe' && basename !== 'powershell.exe') {
    return []
  }
  const chain = await resolveWindowsPowerShellSpawnChain(basename, {
    env: args.env,
    settingKey: `${args.requestedShell}|${args.powerShellImplementation ?? ''}`,
    preferPreview: isPreviewPwshPath(args.requestedShell)
  })
  // A missing PowerShell 7 is announced by the fallback shell itself.
  const pwshMissing =
    basename === 'pwsh.exe' && pathWin32.basename(chain[0] ?? '').toLowerCase() !== 'pwsh.exe'
  return chain.map((candidate) =>
    toAttempt(
      candidate,
      args.cwd,
      args.defaultCwd,
      args.wslContext,
      args.startupCommand,
      pwshMissing ? pwshNotFoundNotice(candidate) : undefined
    )
  )
}
