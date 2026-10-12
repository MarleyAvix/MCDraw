<script setup lang="ts">
import { computed, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import { Hand, MousePointer2 } from 'lucide-vue-next'
import { useTheme } from '../../composables/useTheme'
import { useCanvasTools } from '../../composables/useCanvasTools'
import { useSequenceStore } from './sequenceStore'
import SequenceDiagram from './SequenceDiagram.vue'
import { locate } from './layout'

const store = useSequenceStore()
const { isDark } = useTheme()
const { onPaneClick, setCenter, viewport } = useVueFlow('seq-diagram')
const { tool } = useCanvasTools('seq-diagram')

// Le diagramme entier est un seul nœud : sa mise en page est calculée (layout.ts), pas posée à la main.
const nodes = computed(() => (store.layout.participants.length ? [{ id: 'sequence', type: 'sequence', position: { x: 0, y: 0 }, data: {}, draggable: false, selectable: false, connectable: false }] : []))

// Une recherche (ou un clic dans la liste d'erreurs) fait clignoter un élément : on y recentre la vue.
watch(
  () => store.highlightId,
  (id) => {
    const at = id ? locate(store.layout, id) : null
    if (at) setCenter(at.x, at.y, { zoom: Math.max(viewport.value.zoom, 0.9), duration: 350 })
  },
)

onPaneClick(() => {
  store.selection = []
})
</script>

<template>
  <div class="relative h-full w-full">
    <div v-if="!store.participants.length" class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
      <div class="rounded-2xl border-2 border-dashed border-slate-300 bg-surface/80 p-10 text-center shadow-sm backdrop-blur-sm">
        <p class="text-2xl font-extrabold tracking-tight text-slate-700">Votre diagramme est vide</p>
        <p class="mt-3 text-base text-slate-500">
          Appuyez sur <kbd class="mx-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-sm font-semibold text-slate-700">M</kbd>
          pour ajouter un message, ou écrivez-le dans le panneau texte.
        </p>
      </div>
    </div>

    <VueFlow
      id="seq-diagram"
      :nodes="nodes"
      :edges="[]"
      :default-viewport="{ x: 40, y: 20, zoom: 0.9 }"
      :min-zoom="0.2"
      :max-zoom="2"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :pan-on-drag="true"
      fit-view-on-init
      class="bg-slate-50"
      :class="tool === 'pan' ? 'tool-pan' : ''"
    >
      <template #node-sequence><SequenceDiagram /></template>
      <Background :gap="20" :size="2" :pattern-color="isDark ? '#484f58' : '#afb8c1'" />
      <Controls position="bottom-left">
        <ControlButton title="Sélection (cliquer sur un élément)" :class="{ 'tool-active': tool === 'select' }" @click="tool = 'select'"><MousePointer2 :size="14" /></ControlButton>
        <ControlButton title="Main (glisser = déplacer la vue)" :class="{ 'tool-active': tool === 'pan' }" @click="tool = 'pan'"><Hand :size="14" /></ControlButton>
      </Controls>
    </VueFlow>
  </div>
</template>
