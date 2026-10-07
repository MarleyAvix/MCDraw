<script setup lang="ts">
import { ConnectionMode, VueFlow, useVueFlow, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { useSchemaStore } from '../../stores/schemaStore'
import { useTheme } from '../../composables/useTheme'
import EntityNode from './EntityNode.vue'
import RelationNode from './RelationNode.vue'
import LinkEdge from './LinkEdge.vue'
import IsaEdge from './IsaEdge.vue'

const store = useSchemaStore()
const { isDark } = useTheme()
const { onNodeDragStop, onNodeDoubleClick, onEdgeClick, onNodesChange, onEdgesChange, onConnect } = useVueFlow('mcdraw')

// `nodes` contient tous les nœuds déplacés ensemble (sélection multiple), pas seulement celui saisi.
onNodeDragStop(({ node, nodes }) => {
  const moved = nodes?.length ? nodes : [node]
  store.moveNodes(Object.fromEntries(moved.map((n) => [n.id, { x: n.position.x, y: n.position.y }])))
})

onNodeDoubleClick(({ node }) => {
  if (node.type === 'entity') store.editingEntityId = node.id
  else store.editingRelationId = node.id
})

onEdgeClick(({ edge }) => {
  if (edge.type === 'isa') store.editingEntityId = edge.source
  else store.editingRelationId = edge.source
})

onNodesChange((changes) => {
  for (const c of changes) {
    if (c.type === 'remove') store.removeNode(c.id)
    else if (c.type === 'select') {
      const has = store.selection.includes(c.id)
      if (c.selected && !has) store.selection = [...store.selection, c.id]
      else if (!c.selected && has) store.selection = store.selection.filter((id) => id !== c.id)
    }
  }
})
onEdgesChange((changes) => {
  for (const c of changes) {
    if (c.type !== 'remove') continue
    if (c.id.startsWith('isa:')) store.setParent(c.id.slice(4), undefined)
    else store.removeLink(c.id)
  }
})

// Pas de boucle sur une association ; une entité peut en revanche se relier à elle-même (réflexive).
const isValid = (c: Connection) => c.source !== c.target || store.entities.some((e) => e.id === c.source)

// Une patte relie toujours une association à une entité.
onConnect((c: Connection) => {
  const kind = (id: string) =>
    store.entities.some((e) => e.id === id) ? 'entity' : store.relations.some((r) => r.id === id) ? 'relation' : null
  const [ks, kt] = [kind(c.source), kind(c.target)]
  if (ks === 'relation' && kt === 'entity') {
    store.addLink(c.source, c.target, { relation: c.sourceHandle ?? undefined, entity: c.targetHandle ?? undefined })
  } else if (ks === 'entity' && kt === 'relation') {
    store.addLink(c.target, c.source, { relation: c.targetHandle ?? undefined, entity: c.sourceHandle ?? undefined })
  } else if (ks === 'entity' && kt === 'entity') {
    // Entité → entité : une association est créée automatiquement entre les deux.
    store.addRelationBetween(c.source, c.target, { source: c.sourceHandle ?? undefined, target: c.targetHandle ?? undefined })
  }
})
</script>

<template>
  <VueFlow
    id="mcdraw"
    :nodes="store.nodes"
    :edges="store.edges"
    :connection-mode="ConnectionMode.Loose"
    :default-viewport="{ x: 40, y: 40, zoom: 0.9 }"
    :min-zoom="0.2"
    :max-zoom="2"
    :is-valid-connection="isValid"
    :delete-key-code="['Delete', 'Backspace']"
    :multi-selection-key-code="['Control', 'Meta']"
    fit-view-on-init
    class="bg-slate-50"
  >
    <template #node-entity="props"><EntityNode :data="props.data" /></template>
    <template #node-relation="props"><RelationNode :data="props.data" /></template>
    <template #edge-link="props"><LinkEdge v-bind="props" /></template>
    <template #edge-isa="props"><IsaEdge v-bind="props" /></template>
    <Background :gap="20" :size="2" :pattern-color="isDark ? '#484f58' : '#afb8c1'" />
    <Controls position="bottom-left" />
  </VueFlow>
</template>
