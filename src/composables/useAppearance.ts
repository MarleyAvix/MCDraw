import { reactive, watchEffect } from 'vue'

export interface Appearance {
  /** Fond de l'en-tête des entités / tables / classes. `''` = couleur du thème. */
  entity: string
  /** Fond des associations. */
  relation: string
  /** Couleur des liens et pattes. */
  edge: string
}

const KEY = 'mcdraw:appearance'
const EMPTY: Appearance = { entity: '', relation: '', edge: '' }
const HEX = /^#[0-9a-f]{6}$/i

function read(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const out = { ...EMPTY }
    for (const k of Object.keys(EMPTY) as (keyof Appearance)[]) if (HEX.test(raw?.[k])) out[k] = raw[k]
    return out
  } catch {
    return { ...EMPTY }
  }
}

const appearance = reactive<Appearance>(read())

const VARS: Record<keyof Appearance, string> = { entity: '--entity-bg', relation: '--relation-bg', edge: '--edge' }

/** Texte lisible (sombre ou blanc) sur un fond donné, d'après sa luminance perçue. */
function contrastOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1f2328' : '#ffffff'
}

watchEffect(() => {
  const html = document.documentElement
  for (const k of Object.keys(VARS) as (keyof Appearance)[]) {
    if (appearance[k]) html.style.setProperty(VARS[k], appearance[k])
    else html.style.removeProperty(VARS[k])
  }
  for (const k of ['entity', 'relation'] as const) {
    html.classList.toggle(`themed-${k}`, !!appearance[k])
    if (appearance[k]) html.style.setProperty(`--${k}-fg`, contrastOn(appearance[k]))
    else html.style.removeProperty(`--${k}-fg`)
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance))
  } catch {
    /* ignoré */
  }
})

/** Couleurs personnalisées des entités, associations et liens (persistées localement, indépendantes du projet). */
export function useAppearance() {
  return { appearance, reset: () => Object.assign(appearance, EMPTY) }
}
