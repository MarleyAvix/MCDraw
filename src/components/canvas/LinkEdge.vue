<script setup lang="ts">
import { computed, ref } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@vue-flow/core'
import { CARDINALITIES, type Cardinality } from '../../types/schema'
import { useSchemaStore } from '../../stores/schemaStore'

const props = defineProps<EdgeProps<{ linkId: string; cardinality: Cardinality; role?: string }>>()
const store = useSchemaStore()
const open = ref(false)

const path = computed(() => getStraightPath(props)[0])
// Cardinalité affichée près de l'entité (extrémité cible), comme en Merise.
const pos = computed(() => {
  const t = 0.3
  return {
    x: props.targetX + (props.sourceX - props.targetX) * t,
    y: props.targetY + (props.sourceY - props.targetY) * t,
  }
})

function pick(c: Cardinality) {
  if (props.data) store.updateLink(props.data.linkId, { cardinality: c })
  open.value = false
}
</script>

<template>
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" :style="style" />
  <EdgeLabelRenderer>
    <div
      class="nodrag nopan absolute"
      :style="{ transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`, pointerEvents: 'all', zIndex: open ? 10 : 1 }"
      @mouseleave="open = false"
    >
      <button
        class="rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-xs font-semibold hover:border-indigo-600"
        :title="'Cliquer pour changer la cardinalité' + (data?.role ? ` — rôle : ${data.role}` : '')"
        @click.stop="open = !open"
      >
        {{ data?.cardinality }}<span v-if="data?.role" class="ml-1 font-normal text-slate-500">({{ data.role }})</span>
      </button>
      <div v-if="open" class="absolute left-1/2 top-full z-10 mt-1 flex -translate-x-1/2 overflow-hidden rounded border border-slate-300 bg-surface shadow-lg">
        <button
          v-for="c in CARDINALITIES"
          :key="c"
          class="px-2 py-1 text-xs"
          :class="c === data?.cardinality ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'"
          @click.stop="pick(c)"
        >
          {{ c }}
        </button>
      </div>
    </div>
  </EdgeLabelRenderer>
</template>
