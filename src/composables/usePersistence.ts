import { watch, type WatchSource } from 'vue'

/** Sauvegarde l'état dans le localStorage à chaque modification. Un stockage indisponible est ignoré. */
export function usePersistence<S>(state: WatchSource<S>, storageKey: string) {
  watch(
    state,
    (s) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(s))
      } catch {
        /* stockage indisponible : on ignore */
      }
    },
    { deep: true },
  )
}
