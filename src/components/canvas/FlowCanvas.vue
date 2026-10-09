<script setup lang="ts">
import { ref } from 'vue'
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
const { onNodeDragStop, onNodeDoubleClick, onEdgeClick, onNodesChange, onEdgesChange, onConnect, onConnectStart, onConnectEnd, screenToFlowCoordinate } = useVueFlow('mcdraw')

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

// Relâchement et propositions
type Proposal = { sourceId: string; handle?: string; kind: 'entity' | 'relation'; px: number; py: number; x: number; y: number }
const root = ref<HTMLElement>()
const proposal = ref<Proposal | null>(null)
let pending: { nodeId: string; handleId?: string } | null = null
let connected = false

// Menu contextuel
const contextMenu = ref<{ px: number; py: number; flowX?: number; flowY?: number; node?: any } | null>(null)

function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  proposal.value = null
  const rect = root.value!.getBoundingClientRect()
  const p = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  contextMenu.value = { px: event.clientX - rect.left, py: event.clientY - rect.top, flowX: p.x, flowY: p.y }
}

function onNodeContextMenu({ event, node }: { event: MouseEvent; node: any }) {
  event.preventDefault()
  proposal.value = null
  const rect = root.value!.getBoundingClientRect()
  contextMenu.value = { px: event.clientX - rect.left, py: event.clientY - rect.top, node }
}

function closeMenus() {
  proposal.value = null
  contextMenu.value = null
}

onConnectStart(({ nodeId, handleId }) => {
  pending = nodeId ? { nodeId, handleId: handleId ?? undefined } : null
  connected = false
  closeMenus()
})

onConnectEnd((event) => {
  const start = pending
  pending = null
  if (!start || !event) return
  const e = 'changedTouches' in event ? event.changedTouches[0] : event
  const target = event.target as HTMLElement | null
  if (!target?.closest('.vue-flow__pane')) return
  setTimeout(() => {
    if (connected) return
    const kind = store.entities.some((x) => x.id === start.nodeId) ? 'entity' : store.relations.some((x) => x.id === start.nodeId) ? 'relation' : null
    if (!kind) return
    const rect = root.value!.getBoundingClientRect()
    const p = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
    proposal.value = { sourceId: start.nodeId, handle: start.handleId, kind, px: e.clientX - rect.left, py: e.clientY - rect.top, x: p.x, y: p.y }
  }, 0)
})

function createFromProposal(what: 'entity' | 'relation') {
  const pr = proposal.value
  closeMenus()
  if (!pr) return
  if (pr.kind === 'entity' && what === 'relation') {
    const r = store.addRelation(pr.x - 65, pr.y - 32)
    store.addLink(r.id, pr.sourceId, { entity: pr.handle })
    store.editingRelationId = r.id
  } else if (pr.kind === 'entity' && what === 'entity') {
    const e = store.addEntity(pr.x - 90, pr.y - 50)
    store.addRelationBetween(pr.sourceId, e.id, { source: pr.handle })
  } else if (pr.kind === 'relation' && what === 'entity') {
    const e = store.addEntity(pr.x - 90, pr.y - 50)
    store.addLink(pr.sourceId, e.id, { relation: pr.handle })
    store.editingEntityId = e.id
  }
}

function handleContextAction(action: string) {
  const ctx = contextMenu.value
  if (!ctx) return
  
  if (action === 'add-entity' && ctx.flowX !== undefined && ctx.flowY !== undefined) {
    store.addEntity(ctx.flowX - 90, ctx.flowY - 50)
  } else if (action === 'add-relation' && ctx.flowX !== undefined && ctx.flowY !== undefined) {
    store.addRelation(ctx.flowX - 65, ctx.flowY - 32)
  } else if (ctx.node) {
    if (action === 'edit') {
      if (ctx.node.type === 'entity') store.editingEntityId = ctx.node.id
      else store.editingRelationId = ctx.node.id
    } else if (action === 'duplicate') {
      store.duplicateNodes([ctx.node.id])
    } else if (action === 'delete') {
      store.removeNode(ctx.node.id)
    }
  }
  closeMenus()
}

onConnect((c: Connection) => {
  connected = true
  const kind = (id: string) =>
    store.entities.some((e) => e.id === id) ? 'entity' : store.relations.some((r) => r.id === id) ? 'relation' : null
  const [ks, kt] = [kind(c.source), kind(c.target)]
  if (ks === 'relation' && kt === 'entity') {
    store.addLink(c.source, c.target, { relation: c.sourceHandle ?? undefined, entity: c.targetHandle ?? undefined })
  } else if (ks === 'entity' && kt === 'relation') {
    store.addLink(c.target, c.source, { relation: c.targetHandle ?? undefined, entity: c.sourceHandle ?? undefined })
  } else if (ks === 'entity' && kt === 'entity') {
    store.addRelationBetween(c.source, c.target, { source: c.sourceHandle ?? undefined, target: c.targetHandle ?? undefined })
  }
})
</script>

<template>
  <div ref="root" class="relative h-full w-full" @keydown.esc="closeMenus" @click="closeMenus" @contextmenu.prevent>
  
  <!-- Empty State -->
  <div v-if="store.entities.length === 0 && store.relations.length === 0" class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
    <div class="rounded-2xl border-2 border-dashed border-slate-300 bg-surface/80 p-10 text-center shadow-sm backdrop-blur-sm transition-opacity">
      <p class="text-2xl font-extrabold tracking-tight text-slate-700">Votre canevas est vide</p>
      <p class="mt-3 text-base text-slate-500">Appuyez sur <kbd class="mx-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-sm font-semibold text-slate-700">N</kbd> ou faites un <b>clic-droit</b> pour créer une entité.</p>
    </div>
  </div>

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
    @pane-click="closeMenus"
    @move-start="closeMenus"
    @node-click="closeMenus"
    @edge-click="closeMenus"
    @pane-context-menu="onPaneContextMenu"
    @node-context-menu="onNodeContextMenu"
  >
    <template #node-entity="props"><EntityNode :data="props.data" /></template>
    <template #node-relation="props"><RelationNode :data="props.data" /></template>
    <template #edge-link="props"><LinkEdge v-bind="props" /></template>
    <template #edge-isa="props"><IsaEdge v-bind="props" /></template>
    <Background :gap="20" :size="2" :pattern-color="isDark ? '#484f58' : '#afb8c1'" />
    <Controls position="bottom-left" />
  </VueFlow>
  
  <div
    v-if="proposal"
    class="absolute z-50 w-52 rounded-md border border-slate-200 bg-surface py-1 text-sm shadow-lg"
    :style="{ left: `${proposal.px}px`, top: `${proposal.py}px` }"
  >
    <p class="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Créer ici</p>
    <button v-if="proposal.kind === 'entity'" class="block w-full px-3 py-2 text-left hover:bg-slate-100" @click.stop="createFromProposal('relation')">Une association</button>
    <button class="block w-full px-3 py-2 text-left hover:bg-slate-100" @click.stop="createFromProposal('entity')">Une entité</button>
    <button class="block w-full px-3 py-2 text-left text-slate-500 hover:bg-slate-100" @click.stop="closeMenus">Annuler</button>
  </div>

  <div
    v-if="contextMenu"
    class="absolute z-50 w-48 rounded-md border border-slate-200 bg-surface py-1 text-sm shadow-lg"
    :style="{ left: `${contextMenu.px}px`, top: `${contextMenu.py}px` }"
  >
    <template v-if="!contextMenu.node">
      <button class="block w-full px-3 py-2 text-left hover:bg-slate-100" @click.stop="handleContextAction('add-entity')">Créer une entité</button>
      <button class="block w-full px-3 py-2 text-left hover:bg-slate-100" @click.stop="handleContextAction('add-relation')">Créer une association</button>
    </template>
    <template v-else>
      <button class="block w-full px-3 py-2 text-left hover:bg-slate-100" @click.stop="handleContextAction('edit')">Éditer</button>
      <button class="block w-full px-3 py-2 text-left hover:bg-slate-100" @click.stop="handleContextAction('duplicate')">Dupliquer</button>
      <hr class="my-1 border-slate-200" />
      <button class="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50" @click.stop="handleContextAction('delete')">Supprimer</button>
    </template>
  </div>
  </div>
</template>
