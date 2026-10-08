import dagre from '@dagrejs/dagre'

export interface LayoutNode {
  id: string
  w: number
  h: number
}

/**
 * Mise en page dagre dont le sens (horizontal / vertical) épouse la forme de la zone visible.
 * Renvoie la position du coin haut-gauche de chaque nœud.
 */
export function layoutByAspect(nodes: LayoutNode[], edges: [string, string][], aspect: number): Record<string, { x: number; y: number }> {
  const run = (rankdir: 'LR' | 'TB') => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir, nodesep: 70, ranksep: 130, marginx: 20, marginy: 20 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h })
    for (const [s, t] of edges) if (s !== t) g.setEdge(s, t)
    dagre.layout(g)
    const { width = 1, height = 1 } = g.graph()
    const positions: Record<string, { x: number; y: number }> = {}
    for (const n of nodes) {
      const p = g.node(n.id)
      positions[n.id] = { x: p.x - n.w / 2, y: p.y - n.h / 2 }
    }
    return { positions, ratio: width / height }
  }
  const lr = run('LR')
  const tb = run('TB')
  const score = (r: number) => Math.abs(Math.log(r / aspect))
  return (score(tb.ratio) < score(lr.ratio) ? tb : lr).positions
}
