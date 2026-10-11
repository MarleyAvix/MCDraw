import { computed, ref, watch, type WatchSource } from 'vue'

export interface HistoryOptions<S> {
  /** État à observer ; il doit être sérialisable en JSON. */
  state: WatchSource<S>
  /** Restaure un état (appelé par annuler / rétablir). */
  load: (snapshot: S) => void
  /** Nombre maximal d'étapes conservées. */
  max?: number
  /** Les modifications séparées de moins que ce délai (ms) ne forment qu'une étape (saisie au clavier…). */
  coalesceMs?: number
}

/**
 * Historique annuler / rétablir par instantanés JSON.
 * À appeler une fois l'état initial chargé : c'est lui qui sert de point de départ, il n'est pas une étape.
 */
export function useHistory<S>({ state, load, max = 100, coalesceMs = 600 }: HistoryOptions<S>) {
  const read = () => (typeof state === 'function' ? (state as () => S)() : (state as { value: S }).value)
  const past = ref<string[]>([])
  const future = ref<string[]>([])
  let lastChange = 0
  let present = JSON.stringify(read())

  watch(
    state,
    (s) => {
      const snap = JSON.stringify(s)
      if (snap === present) return
      const now = Date.now()
      const grouped = past.value.length > 0 && now - lastChange < coalesceMs
      lastChange = now
      if (!grouped) {
        past.value.push(present)
        if (past.value.length > max) past.value.shift()
      }
      future.value = []
      present = snap
    },
    { deep: true },
  )

  function undo() {
    const prev = past.value.pop()
    if (prev === undefined) return
    future.value.push(present)
    present = prev
    lastChange = 0
    load(JSON.parse(prev))
  }

  function redo() {
    const next = future.value.pop()
    if (next === undefined) return
    past.value.push(present)
    present = next
    lastChange = 0
    load(JSON.parse(next))
  }

  return { undo, redo, canUndo: computed(() => past.value.length > 0), canRedo: computed(() => future.value.length > 0) }
}
