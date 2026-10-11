/**
 * Outils purs pour les documents en arbre (plan de site, carte mentale…) : une liste à plat d'éléments `{ id, parentId? }`
 * dont l'ordre est aussi l'ordre des sœurs.
 */

export interface TreeItem {
  id: string
  /** Élément père ; absent pour une racine. */
  parentId?: string
}

export const childrenOf = <T extends TreeItem>(items: T[], id: string | undefined) => items.filter((p) => p.parentId === id)

/** Les racines : éléments sans père (ou dont le père n'existe pas). */
export function rootsOf<T extends TreeItem>(items: T[]) {
  const ids = new Set(items.map((p) => p.id))
  return items.filter((p) => !p.parentId || !ids.has(p.parentId))
}

/** Élément et tous ses descendants. */
export function subtreeIds(items: TreeItem[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of items) {
      if (p.parentId && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id)
        grew = true
      }
    }
  }
  return out
}

/** Profondeur de chaque élément (racine = 0). */
export function depths(items: TreeItem[]): Map<string, number> {
  const byId = new Map(items.map((p) => [p.id, p]))
  const out = new Map<string, number>()
  const depthOf = (p: TreeItem, seen = new Set<string>()): number => {
    const known = out.get(p.id)
    if (known !== undefined) return known
    const parent = p.parentId ? byId.get(p.parentId) : undefined
    const d = parent && !seen.has(parent.id) ? depthOf(parent, seen.add(p.id)) + 1 : 0
    out.set(p.id, d)
    return d
  }
  for (const p of items) depthOf(p)
  return out
}

/**
 * Échange l'élément avec sa sœur précédente (`dir` -1) ou suivante (+1). L'ordre des sœurs est celui du tableau :
 * échanger les deux entrées suffit, les descendants suivent leur père. Renvoie `null` s'il n'y a pas de sœur de ce côté.
 */
export function moveSibling<T extends TreeItem>(items: T[], id: string, dir: -1 | 1): T[] | null {
  const item = items.find((p) => p.id === id)
  if (!item) return null
  const sibs = items.filter((p) => (p.parentId ?? undefined) === (item.parentId ?? undefined))
  const other = sibs[sibs.indexOf(item) + dir]
  if (!other) return null
  const next = [...items]
  const [i, j] = [items.indexOf(item), items.indexOf(other)]
  next[i] = other
  next[j] = item
  return next
}

/** Parcours en profondeur dans l'ordre d'affichage. */
export function walkTree<T extends TreeItem>(items: T[]): { item: T; depth: number }[] {
  const out: { item: T; depth: number }[] = []
  const visit = (p: T, depth: number) => {
    out.push({ item: p, depth })
    for (const c of childrenOf(items, p.id)) visit(c, depth + 1)
  }
  for (const r of rootsOf(items)) visit(r, 0)
  return out
}

/** Répare, en place, une structure venue de l'extérieur : père inconnu ou égal à soi retiré, cycles coupés. */
export function repairTree(items: TreeItem[]): void {
  const ids = new Set(items.map((p) => p.id))
  const byId = new Map(items.map((p) => [p.id, p]))
  for (const p of items) {
    if (p.parentId && (!ids.has(p.parentId) || p.parentId === p.id)) delete p.parentId
  }
  // En remontant depuis chaque élément, on détache celui qui boucle.
  for (const p of items) {
    const seen = new Set<string>([p.id])
    let cur = p
    while (cur.parentId) {
      if (seen.has(cur.parentId)) {
        delete cur.parentId
        break
      }
      seen.add(cur.parentId)
      cur = byId.get(cur.parentId)!
    }
  }
}
