import { onUnmounted, ref, shallowRef } from 'vue'
import type { SeedJob, SeedJobResult } from '../engine/seedJob'

/** Au-delà, la génération est jugée bloquée : le worker est arrêté plutôt que de laisser l'onglet tourner dans le vide. */
const TIMEOUT_MS = 20_000

type Reply = { id: number } & (SeedJobResult | { error: string })

/**
 * Génère les données fictives dans un Web Worker. Une seule génération tourne à la fois : pendant ce temps, seule la
 * demande la plus récente est gardée (les intermédiaires, dépassées, sont abandonnées). Une génération qui échoue ou
 * s'éternise produit un message d'erreur, jamais un onglet figé. Le worker est arrêté quand le composant disparaît.
 */
export function useSeedWorker() {
  const result = shallowRef<SeedJobResult | null>(null)
  const error = ref<string | null>(null)
  const busy = ref(false)

  let worker: Worker | null = null
  let running: number | null = null
  let queued: SeedJob | null = null
  let lastJob: SeedJob | null = null
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function spawn(): Worker {
    const w = new Worker(new URL('../engine/seed.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Reply>) => {
      if (e.data.id !== running) return
      clearTimeout(timer)
      running = null
      if ('error' in e.data) error.value = `La génération a échoué : ${e.data.error}`
      else {
        result.value = { code: e.data.code, reduced: e.data.reduced }
        error.value = null
      }
      pump()
    }
    w.onerror = (e) => {
      e.preventDefault()
      fail(`Le générateur n'a pas pu démarrer${e.message ? ` : ${e.message}` : ''}.`)
    }
    return w
  }

  /** Arrête le worker (il sera recréé à la prochaine demande) et signale l'erreur. */
  function fail(message: string) {
    clearTimeout(timer)
    worker?.terminate()
    worker = null
    running = null
    error.value = message
    pump()
  }

  function pump() {
    if (running !== null) return
    const job = queued
    queued = null
    if (!job) {
      busy.value = false
      return
    }
    busy.value = true
    running = ++nextId
    timer = setTimeout(() => fail('La génération a pris trop de temps et a été interrompue : réduisez le nombre de lignes.'), TIMEOUT_MS)
    try {
      worker ??= spawn()
      worker.postMessage({ id: running, job })
    } catch (err) {
      fail(`La génération n'a pas pu être lancée : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Demande une génération ; si une autre est en cours, celle-ci attend (et remplace toute demande déjà en attente). */
  function request(job: SeedJob) {
    lastJob = job
    queued = job
    busy.value = true
    pump()
  }

  /** Relance la dernière demande (après une erreur). */
  const retry = () => lastJob && request(lastJob)

  onUnmounted(() => {
    clearTimeout(timer)
    worker?.terminate()
  })

  return { result, error, busy, request, retry }
}
