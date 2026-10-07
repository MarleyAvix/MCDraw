/** Transforme un libellé libre en identifiant SQL (snake_case, sans accents). */
export function slug(label: string, fallback = 'sans_nom'): string {
  let s = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  if (!s) s = fallback
  if (/^\d/.test(s)) s = `_${s}`
  return s
}

/** `base`, ou `base_2`, `base_3`… s'il est déjà pris. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}
