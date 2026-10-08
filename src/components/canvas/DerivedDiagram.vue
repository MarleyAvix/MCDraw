<script lang="ts">
import { ref } from 'vue'

// Positions déplacées à la main, par vue : conservées quand on change d'onglet.
const overridesByKind = { erd: ref<Record<string, { x: number; y: number }>>({}), uml: ref<Record<string, { x: number; y: number }>>({}) }
</script>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { useSchemaStore } from '../../stores/schemaStore'
import { useTheme } from '../../composables/useTheme'
import { layoutByAspect } from '../../composables/diagramLayout'
import { meriseToDiagram, type DiagramNode } from '../../engine/meriseToDiagram'
import ErdEntityNode from './ErdEntityNode.vue'
import UmlClassNode from './UmlClassNode.vue'
import UmlDiamondNode from './UmlDiamondNode.vue'
import NotationEdge from './NotationEdge.vue'

/** Vue ERD (pattes de corbeau) ou UML (diagramme de classes), dérivée du MCD. */
const props = defineProps<{ kind: 'erd' | 'uml' }>()

const W = 210
const estimateSize = (n: DiagramNode) =>
  n.kind === 'diamond' ? { w: 44, h: 44 } : { w: W, h: 38 + 24 * Math.max(n.attributes.length, 1) + 8 }

const store = useSchemaStore()
const { isDark } = useTheme()
const { onNodeDragStop, fitView, dimensions, getNodes } = useVueFlow(props.kind)
const overrides = overridesByKind[props.kind]

const diagram = computed(() => meriseToDiagram(store.schema, props.kind))

// La mise en page ne dépend que de la structure (pas des noms ni des positions du MCD).
const structure = computed(() =>
  JSON.stringify([
    diagram.value.nodes.map((n) => [n.id, n.kind, n.attributes.length]),
    diagram.value.edges.map((e) => [e.source, e.target, e.variant]),
  ]),
)
// Forme de la zone visible, mesurée une fois connue puis à chaque « Organiser ».
const aspect = ref(1000 / 600)
const measure = () => {
  if (dimensions.value.width > 0 && dimensions.value.height > 0) aspect.value = dimensions.value.width / dimensions.value.height
}
const autoLayout = computed(() => {
  void structure.value
  const { nodes, edges } = diagram.value
  return layoutByAspect(
    nodes.map((n) => ({ id: n.id, ...estimateSize(n) })),
    // une classe d'association se place près des deux entités qu'elle qualifie
    edges.flatMap((e): [string, string][] =>
      e.variant === 'classLink' ? [[e.source, e.anchor![0]], [e.source, e.anchor![1]]] : [[e.source, e.target]],
    ),
    aspect.value,
  )
})

const nodeType = (n: DiagramNode) => (props.kind === 'erd' ? 'erdEntity' : n.kind === 'diamond' ? 'umlDiamond' : 'umlClass')

const nodes = computed<Node[]>(() =>
  diagram.value.nodes.map((n) => ({
    id: n.id,
    type: nodeType(n),
    position: overrides.value[n.id] ?? autoLayout.value[n.id] ?? { x: 0, y: 0 },
    data: n,
    connectable: false,
  })),
)
const edges = computed<Edge[]>(() =>
  diagram.value.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'notation',
    data: { ...e, style: props.kind },
    selectable: false,
  })),
)

onNodeDragStop(({ nodes: moved }) => {
  for (const n of moved) overrides.value[n.id] = { x: n.position.x, y: n.position.y }
})

// Recadrage dès que la zone et les nœuds sont mesurés (la mise en page dépend de la forme de la zone).
const ready = computed(
  () => dimensions.value.width > 0 && getNodes.value.length > 0 && getNodes.value.every((n) => n.dimensions?.width > 0),
)
watch(
  ready,
  (ok) => {
    if (!ok) return
    measure()
    setTimeout(() => fitView({ padding: 0.2 }), 100)
    setTimeout(() => fitView({ padding: 0.2 }), 400)
  },
  { immediate: true },
)
watch(structure, () => setTimeout(() => fitView({ padding: 0.2 }), 80))

// Bouton « Organiser » : oublie les déplacements manuels et recadre.
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
    :id="kind"
    :nodes="nodes"
    :edges="edges"
    :nodes-connectable="false"
    :elements-selectable="false"
    :min-zoom="0.2"
    :max-zoom="2"
    class="bg-slate-50"
  >
    <template #node-erdEntity="p"><ErdEntityNode :data="p.data" /></template>
    <template #node-umlClass="p"><UmlClassNode :data="p.data" /></template>
    <template #node-umlDiamond="p"><UmlDiamondNode :data="p.data" /></template>
    <template #edge-notation="p"><NotationEdge v-bind="p" /></template>
    <Background :gap="20" :size="2" :pattern-color="isDark ? '#484f58' : '#afb8c1'" />
    <Controls position="bottom-left" :show-interactive="false" />
  </VueFlow>
</template>
