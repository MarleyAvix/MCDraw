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

watchEffect(() => {
  const root = document.documentElement.style
  for (const k of Object.keys(VARS) as (keyof Appearance)[]) {
    if (appearance[k]) root.setProperty(VARS[k], appearance[k])
    else root.removeProperty(VARS[k])
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
