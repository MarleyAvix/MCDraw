<script setup lang="ts">
import { SelectionMode, VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import { Hand, MousePointer2 } from 'lucide-vue-next'
import { useTheme } from '../../composables/useTheme'
import { useCanvasTools } from '../../composables/useCanvasTools'
import { useApiStore } from './apiStore'
import ResourceNode from './ResourceNode.vue'

const store = useApiStore()
const { isDark } = useTheme()
const { onNodesChange, onNodeDoubleClick } = useVueFlow('api-schemas')
const { tool } = useCanvasTools('api-schemas')

onNodeDoubleClick(({ node }) => {
  store.editingResourceId = node.id
})

onNodesChange((changes) => {
  const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
  if (removed.length) store.removeResources(removed)
  for (const c of changes) {
    if (c.type !== 'select') continue
    const has = store.selection.includes(c.id)
    if (c.selected && !has) store.selection = [...store.selection, c.id]
    else if (!c.selected && has) store.selection = store.selection.filter((id) => id !== c.id)
  }
})
</script>

<template>
  <div class="relative h-full w-full">
    <div v-if="!store.resources.length" class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
      <div class="rounded-2xl border-2 border-dashed border-slate-300 bg-surface/80 p-10 text-center shadow-sm backdrop-blur-sm">
        <p class="text-2xl font-extrabold tracking-tight text-slate-700">Aucun schéma</p>
        <p class="mt-3 text-base text-slate-500">
          Appuyez sur <kbd class="mx-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-sm font-semibold text-slate-700">R</kbd>
          pour décrire un objet échangé par l'API (utilisateur, commande…).
        </p>
      </div>
    </div>

    <VueFlow
      id="api-schemas"
      :nodes="store.resourceNodes"
      :edges="store.resourceEdges"
      :default-viewport="{ x: 40, y: 40, zoom: 0.9 }"
      :min-zoom="0.2"
      :max-zoom="2"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :delete-key-code="['Delete', 'Backspace']"
      :multi-selection-key-code="['Control', 'Meta']"
      :selection-key-code="tool === 'select'"
      :selection-mode="SelectionMode.Partial"
      :pan-on-drag="tool === 'select' ? [1] : true"
      fit-view-on-init
      class="bg-slate-50"
      :class="tool === 'pan' ? 'tool-pan' : ''"
    >
      <template #node-resource="props"><ResourceNode :data="props.data" /></template>
      <Background :gap="20" :size="2" :pattern-color="isDark ? '#484f58' : '#afb8c1'" />
      <Controls position="bottom-left">
        <ControlButton title="Sélection (glisser = rectangle)" :class="{ 'tool-active': tool === 'select' }" @click="tool = 'select'"><MousePointer2 :size="14" /></ControlButton>
        <ControlButton title="Main (glisser = déplacer la vue)" :class="{ 'tool-active': tool === 'pan' }" @click="tool = 'pan'"><Hand :size="14" /></ControlButton>
      </Controls>
    </VueFlow>
  </div>
</template>
