import type {DemangleOptions, Profile} from './profile'
import {DemangleDiagnostics} from './demangle/demangle-diagnostics'

// Share the diagnostic quota across the entire recording, including cached
// failures encountered in subsequent profiles. No frame/event history is kept.
export async function demangleProfiles(
  profiles: readonly Profile[],
  options: Omit<DemangleOptions, 'onFailure'> = {},
): Promise<void> {
  const diagnostics = new DemangleDiagnostics()
  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('Demangling cancelled', 'AbortError')
  }
  let lastYield = Date.now(),
    profilesSinceYield = 0
  const yieldControl = async () => {
    await (options.yieldControl
      ? options.yieldControl()
      : new Promise<void>(resolve => setTimeout(resolve, 0)))
    checkAbort()
    lastYield = Date.now()
    profilesSinceYield = 0
  }
  try {
    checkAbort()
    for (const profile of profiles) {
      // Awaiting a resolved per-profile promise does not service browser tasks.
      // Also yield between small profiles, with a count fallback for clock jumps.
      if (profilesSinceYield >= 256 || Date.now() - lastYield >= 8) await yieldControl()
      checkAbort()
      await profile.demangle({...options, yieldControl, onFailure: name => diagnostics.warn(name)})
      profilesSinceYield++
      checkAbort()
    }
  } finally {
    diagnostics.flush()
  }
}
