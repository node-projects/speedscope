import createWasmDemangleModule from './demangle.wasm'
import {CachedDemangler} from './demangle-cache'
import {DemangleDiagnostics} from './demangle-diagnostics'

// The loaded implementation owns exactly one bounded cache, shared by callers.
const cachedDemanglerPromise = createWasmDemangleModule().then(
  module => new CachedDemangler(module.wasm_demangle),
)

export async function loadDemangling(
  onFailure?: (name: string) => void,
): Promise<(name: string) => string> {
  // Convert C++ and Rust symbols to readable names. Recording importers supply
  // their own diagnostic observer; direct callers get bounded local examples.
  const demangler = await cachedDemanglerPromise
  if (onFailure) return name => demangler.demangle(name, onFailure)
  const diagnostics = new DemangleDiagnostics()
  const reportFailure = (name: string) => diagnostics.warn(name)
  return name => demangler.demangle(name, reportFailure)
}
