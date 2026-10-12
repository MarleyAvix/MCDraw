import { describe, expect, it } from 'vitest'
import { layoutHorizontalTree, repairTree, moveSibling, walkTree, type TreeItem } from '../tree'

const item = (id: string, parentId?: string): TreeItem => ({ id, ...(parentId ? { parentId } : {}) })

describe('layoutHorizontalTree', () => {
  const gap = { x: 20, y: 10 }

  it('place la racine à gauche et centre chaque élément en face de ses enfants', () => {
    const items = [item('r'), item('a', 'r'), item('b', 'r'), item('c', 'r')]
    const pos = layoutHorizontalTree(items, () => 40, 100, gap)
    expect(pos.get('r')!.x).toBe(0)
    expect(pos.get('a')!.x).toBe(120)
    expect(pos.get('a')!.y).toBeLessThan(pos.get('b')!.y)
    expect(pos.get('b')!.y).toBeLessThan(pos.get('c')!.y)
    expect(pos.get('r')!.y).toBe(pos.get('b')!.y) // centré sur le bloc de ses trois enfants
  })

  it('ne chevauche jamais, même avec des hauteurs très différentes', () => {
    const items = [item('r'), item('a', 'r'), item('a1', 'a'), item('b', 'r'), item('c', 'b')]
    const heights: Record<string, number> = { r: 200, a: 30, a1: 30, b: 150, c: 20 }
    const pos = layoutHorizontalTree(items, (i) => heights[i.id], 100, gap)
    for (const x of items) for (const y of items) {
      if (x.id >= y.id || pos.get(x.id)!.x !== pos.get(y.id)!.x) continue // seuls les éléments d'une même colonne se gênent
      const [p, q] = [pos.get(x.id)!, pos.get(y.id)!]
      const [hp, hq] = [heights[x.id], heights[y.id]]
      expect(p.y + hp <= q.y || q.y + hq <= p.y).toBe(true)
    }
  })

  it('un élément plus haut que ses enfants décale le sous-arbre sans le casser', () => {
    const items = [item('r'), item('k', 'r')]
    const pos = layoutHorizontalTree(items, (i) => (i.id === 'r' ? 100 : 20), 100, gap)
    expect(pos.get('r')!.y).toBe(0)
    expect(pos.get('k')!.y).toBe(40) // centré sur la racine : 0 + 50 - 10
  })

  it('empile plusieurs racines et gère le vide', () => {
    const pos = layoutHorizontalTree([item('a'), item('b')], () => 40, 100, gap)
    expect(pos.get('b')!.y).toBe(50)
    expect(layoutHorizontalTree([], () => 40, 100, gap).size).toBe(0)
  })
})

describe('arbre générique', () => {
  it('répare père inconnu, auto-référence et cycles', () => {
    const items = [item('a', 'b'), item('b', 'a'), item('c', 'zzz'), item('d', 'd')]
    repairTree(items)
    expect(items.filter((i) => !i.parentId).length).toBeGreaterThanOrEqual(3)
    expect(walkTree(items)).toHaveLength(4)
  })

  it('échange deux sœurs, ou renvoie null', () => {
    const items = [item('r'), item('a', 'r'), item('b', 'r')]
    expect(moveSibling(items, 'b', -1)!.map((i) => i.id)).toEqual(['r', 'b', 'a'])
    expect(moveSibling(items, 'a', -1)).toBeNull()
    expect(moveSibling(items, 'zzz', 1)).toBeNull()
  })
})
