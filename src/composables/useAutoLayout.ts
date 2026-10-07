import { useVueFlow } from '@vue-flow/core'
import dagre from '@dagrejs/dagre'
import { useSchemaStore } from '../stores/schemaStore'

type Size = { w: number; h: number }
type Layout = { positions: Record<string, { x: number; y: number }>; width: number; height: number }

/** Dispose automatiquement entités et associations avec dagre, dans le sens qui épouse le mieux la zone visible. */
export function useAutoLayout() {
  const store = useSchemaStore()
  const { getNodes, fitView, dimensions } = useVueFlow({ id: 'mcdraw' })

  function run(rankdir: 'LR' | 'TB', size: Map<string, Size>): Layout {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir, nodesep: 60, ranksep: 90, marginx: 20, marginy: 20 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const [id, s] of size) g.setNode(id, { width: s.w, height: s.h })

    // Chaîne entité → association → entité pour obtenir des rangs successifs (et non une seule colonne).
    for (const r of store.relations) {
      const legs = store.links.filter((l) => l.relationId === r.id)
      legs.forEach((l, i) => (i === 0 ? g.setEdge(l.entityId, r.id) : g.setEdge(r.id, l.entityId)))
    }
    dagre.layout(g)

    const positions: Layout['positions'] = {}
    for (const [id, s] of size) {
      const p = g.node(id)
      if (p) positions[id] = { x: p.x - s.w / 2, y: p.y - s.h / 2 }
    }
    const { width = 1, height = 1 } = g.graph()
    return { positions, width, height }
  }

  function layout() {
    const size = new Map<string, Size>()
    for (const n of getNodes.value) size.set(n.id, { w: n.dimensions?.width || 180, h: n.dimensions?.height || 100 })

    const target = (dimensions.value.width || 1000) / (dimensions.value.height || 600)
    const score = (l: Layout) => Math.abs(Math.log(l.width / l.height / target))
    const lr = run('LR', size)
    const tb = run('TB', size)
    const best = score(tb) < score(lr) ? tb : lr

    store.moveNodes(best.positions)
    const centers = Object.fromEntries(
      Object.entries(best.positions).map(([id, p]) => [id, { x: p.x + size.get(id)!.w / 2, y: p.y + size.get(id)!.h / 2 }]),
    )
    store.rerouteLinks(centers)
    setTimeout(() => fitView({ padding: 0.2 }), 50)
  }

  return { layout }
}
