import { createDiagnosticLogStore } from './diagnostic-log.js'

const STORE_KEY = '__echoWeaveRuntimeDiagnosticLogStore'

export function getRuntimeDiagnosticLogStore() {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = createDiagnosticLogStore({
      maxEntries: 500,
      maxDetailLength: 1600
    })
  }
  return globalThis[STORE_KEY]
}
