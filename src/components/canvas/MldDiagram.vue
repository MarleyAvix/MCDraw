<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import dagre from '@dagrejs/dagre'
import { useSchemaStore } from '../../stores/schemaStore'
import { useTheme } from '../../composables/useTheme'
import MldTableNode from './MldTableNode.vue'
import { splitColumns } from '../../engine/meriseToMld'
import type { MldTable } from '../../types/schema'

const W = 230
// Hauteur approximative d'une carte : en-tête, lignes, et un titre par bloc de clé (primaire / étrangères).
const estimateHeight = (t: MldTable) => 34 + 28 * t.columns.length + 20 * (splitColumns(t).fks.length + (t.primaryKey.length ? 1 : 0))

const store = useSchemaStore()
const { isDark } = useTheme()
const { onNodeDragStop, fitView, dimensions } = useVueFlow('mld')

// Positions déplacées à la main (par nom de table) ; le reste suit la mise en page automatique.
const overrides = ref<Record<string, { x: number; y: number }>>({})

/** Mise en page dagre, sens horizontal ou vertical selon la forme de la zone visible. Ne dépend que de la structure. */
const structure = computed(() =>
  JSON.stringify(store.mld.tables.map((t) => [t.name, t.columns.length, t.foreignKeys.map((f) => f.refTable)])),
)
// Forme de la zone visible, mesurée une fois connue puis à chaque « Organiser » (pas de recalcul au redimensionnement).
const aspect = ref(1000 / 600)
const measure = () => {
  if (dimensions.value.width > 0 && dimensions.value.height > 0) aspect.value = dimensions.value.width / dimensions.value.height
}
const autoLayout = computed(() => {
  void structure.value // dépendance explicite
  const tables = store.mld.tables
  const run = (rankdir: 'LR' | 'TB') => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir, nodesep: 50, ranksep: 110, marginx: 20, marginy: 20 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const t of tables) g.setNode(t.name, { width: W, height: estimateHeight(t) })
    for (const t of tables) for (const fk of t.foreignKeys) if (fk.refTable !== t.name) g.setEdge(fk.refTable, t.name)
    dagre.layout(g)
    const { width = 1, height = 1 } = g.graph()
    const positions: Record<string, { x: number; y: number }> = {}
    for (const t of tables) {
      const p = g.node(t.name)
      positions[t.name] = { x: p.x - W / 2, y: p.y - estimateHeight(t) / 2 }
    }
    return { positions, ratio: width / height }
  }
  const target = aspect.value
  const lr = run('LR')
  const tb = run('TB')
  const score = (r: number) => Math.abs(Math.log(r / target))
  return (score(tb.ratio) < score(lr.ratio) ? tb : lr).positions
})

const posOf = (name: string) => overrides.value[name] ?? autoLayout.value[name] ?? { x: 0, y: 0 }

const nodes = computed<Node[]>(() =>
  store.mld.tables.map((t) => ({ id: t.name, type: 'mldTable', position: posOf(t.name), data: t, connectable: false })),
)

const edges = computed<Edge[]>(() => {
  const byName = new Map(store.mld.tables.map((t) => [t.name, t]))
  return store.mld.tables.flatMap((t) =>
    t.foreignKeys
      .filter((fk) => byName.has(fk.refTable))
      .map((fk, i) => {
        const dx = posOf(fk.refTable).x - posOf(t.name).x
        // Tables alignées (ou auto-référence) : les deux traits sortent par la droite ; sinon face à face.
        const sameColumn = fk.refTable === t.name || Math.abs(dx) < W * 0.6
        const hostSide = sameColumn || dx > 0 ? 'r' : 'l'
        const refSide = sameColumn ? 'r' : dx > 0 ? 'l' : 'r'
        return {
          id: `${t.name}-${i}`,
          source: t.name,
          target: fk.refTable,
          sourceHandle: `${hostSide}-${fk.columns[0]}`,
          targetHandle: `${refSide}-${fk.refColumns[0]}`,
          type: 'smoothstep',
          // Sens de lecture « la PK alimente la FK » : la pointe est du côté de la clé étrangère.
          markerStart: { type: MarkerType.ArrowClosed, color: '#8b949e', width: 22, height: 22, strokeWidth: 1.5 },
          selectable: false,
        }
      }),
  )
})

onNodeDragStop(({ nodes: moved }) => {
  for (const n of moved) overrides.value[n.id] = { x: n.position.x, y: n.position.y }
})

// Recadrage une fois la taille de la zone connue (la mise en page en dépend).
// Dès que la zone et les nœuds sont mesurés : mesure de la forme, puis recadrage une fois la mise en page appliquée.
const { getNodes } = useVueFlow('mld')
const ready = computed(
  () => dimensions.value.width > 0 && getNodes.value.length > 0 && getNodes.value.every((n) => n.dimensions?.width > 0),
)
const refit = () => {
  setTimeout(() => fitView({ padding: 0.2 }), 100)
  setTimeout(() => fitView({ padding: 0.2 }), 400) // filet de sécurité si les tailles changent encore
}
watch(
  ready,
  (ok) => {
    if (!ok) return
    measure()
    refit()
  },
  { immediate: true },
)
watch(structure, () => setTimeout(() => fitView({ padding: 0.2 }), 80))

// Bouton « Organiser » de la barre d'outils : oublie les déplacements manuels et recadre.
watch(
  () => store.mldRelayout,
  () => {
    overrides.value = {}
    measure()
    setTimeout(() => fitView({ padding: 0.2 }), 100)
  },
)
</script>

<template>
  <VueFlow
    id="mld"
    :nodes="nodes"
    :edges="edges"
    :nodes-connectable="false"
    :elements-selectable="false"
    :min-zoom="0.2"
    :max-zoom="2"
    class="bg-slate-50"
  >
    <template #node-mldTable="props"><MldTableNode :data="props.data" /></template>
    <Background :gap="20" :size="2" :pattern-color="isDark ? '#484f58' : '#afb8c1'" />
    <Controls position="bottom-left" :show-interactive="false" />
  </VueFlow>
</template>
