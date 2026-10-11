import { reactive } from 'vue'
import { documentTypes } from './documentType'

/** Panneaux repliables : état ouvert / replié, mémorisé ; sans choix, replié sur écran étroit. */
const open = reactive<Record<string, boolean>>({})

function initial(key: string): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v === '1'
  } catch {
    /* stockage indisponible */
  }
  return window.innerWidth >= 1024
}

/** À appeler une fois les types enregistrés. */
export function initPanels() {
  for (const t of documentTypes()) for (const p of t.panels) if (p.collapsible) open[p.collapsible.storageKey] = initial(p.collapsible.storageKey)
}

export const isPanelOpen = (key: string) => open[key] ?? true

export function togglePanel(key: string) {
  open[key] = !isPanelOpen(key)
  try {
    localStorage.setItem(key, open[key] ? '1' : '0')
  } catch {
    /* stockage indisponible */
  }
}
