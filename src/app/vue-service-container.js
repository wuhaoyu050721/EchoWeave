import { markRaw } from 'vue'

export function preserveServiceIdentity(services) {
  return markRaw(services)
}
