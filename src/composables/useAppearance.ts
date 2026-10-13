import { reactive, watchEffect } from 'vue'

export interface Appearance {
  /** Fond de l'en-tête des entités / tables / classes (pages, routes, participants selon le type). `''` = couleur du thème. */
  entity: string
  /** Fond du second type de forme : associations, notes. */
  relation: string
  /** Couleur des liens et pattes. */
  edge: string
}

const KEY = 'mcdraw:appearance'
/** Avant les couleurs par type, un seul jeu était partagé : il revient au MCD, seul type qui existait alors. */
const LEGACY_TYPE = 'mcd'
const EMPTY: Appearance = { entity: '', relation: '', edge: '' }
const HEX = /^#[0-9a-f]{6}$/i
const keyOf = (typeId: string) => `${KEY}:${typeId}`

function read(typeId: string): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(typeId)) ?? (typeId === LEGACY_TYPE ? (localStorage.getItem(KEY) ?? '{}') : '{}'))
    const out = { ...EMPTY }
    for (const k of Object.keys(EMPTY) as (keyof Appearance)[]) if (HEX.test(raw?.[k])) out[k] = raw[k]
    return out
  } catch {
    return { ...EMPTY }
  }
}

const byType = new Map<string, Appearance>()
/** Couleurs d'un type de document, créées à la première demande (réactives, persistées localement). */
function appearanceOf(typeId: string): Appearance {
  let a = byType.get(typeId)
  if (!a) {
    a = reactive<Appearance>(read(typeId))
    byType.set(typeId, a)
  }
  return a
}

const VARS: Record<keyof Appearance, string> = { entity: '--entity-bg', relation: '--relation-bg', edge: '--edge' }

/** Texte lisible (sombre ou blanc) sur un fond donné, d'après sa luminance perçue. */
function contrastOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1f2328' : '#ffffff'
}

function apply(a: Appearance) {
  const html = document.documentElement
  for (const k of Object.keys(VARS) as (keyof Appearance)[]) {
    if (a[k]) html.style.setProperty(VARS[k], a[k])
    else html.style.removeProperty(VARS[k])
  }
  html.classList.toggle('themed-edge', !!a.edge)
  for (const k of ['entity', 'relation'] as const) {
    html.classList.toggle(`themed-${k}`, !!a[k])
    if (a[k]) html.style.setProperty(`--${k}-fg`, contrastOn(a[k]))
    else html.style.removeProperty(`--${k}-fg`)
  }
}

/** Applique à la page les couleurs du type affiché (à appeler une fois, depuis le shell) et les mémorise à chaque changement. */
export function useAppearanceApplier(activeId: () => string) {
  watchEffect(() => {
    const id = activeId()
    const a = appearanceOf(id)
    apply(a)
    try {
      localStorage.setItem(keyOf(id), JSON.stringify(a))
    } catch {
      /* ignoré */
    }
  })
}

/** Couleurs personnalisées d'un type de document (indépendantes du projet et des autres types). */
export function useAppearance(typeId: string) {
  const appearance = appearanceOf(typeId)
  return { appearance, reset: () => Object.assign(appearance, EMPTY) }
}
