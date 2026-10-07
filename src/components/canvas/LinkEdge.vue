<script setup lang="ts">
import { computed, ref } from 'vue'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core'
import { CARDINALITIES, type Cardinality } from '../../types/schema'
import { useSchemaStore } from '../../stores/schemaStore'
import { floatingLine } from '../../composables/edgeGeometry'

const props = defineProps<EdgeProps<{ linkId: string; cardinality: Cardinality; role?: string; identifying?: boolean; index?: number; count?: number }>>()
const store = useSchemaStore()
const open = ref(false)

// Le trait rejoint le bord de l'ovale / du rectangle sur la droite des centres ; les pattes jumelles sont décalées.
const line = computed(() => {
  const { index = 0, count = 1 } = props.data ?? {}
  return floatingLine(props.sourceNode, props.targetNode, (index - (count - 1) / 2) * 18)
})
const path = computed(() => `M ${line.value.source.x},${line.value.source.y} L ${line.value.target.x},${line.value.target.y}`)
// Cardinalité écrite à côté du trait, près de l'entité (extrémité cible), comme sur un MCD papier.
// L'étiquette part du point d'ancrage vers l'association (jamais sur l'entité) ; avec des traits jumeaux,
// chaque étiquette s'écarte du côté de son propre trait.
const label = computed(() => {
  const { target, dir, normal } = line.value
  const { index = 0, count = 1 } = props.data ?? {}
  const side = count > 1 ? Math.sign(index - (count - 1) / 2 || 1) : 1
  const x = target.x - dir.x * 8 + normal.x * 14 * side
  const y = target.y - dir.y * 8 + normal.y * 14 * side
  return `translate(${-50 - dir.x * 50}%, ${-50 - dir.y * 50}%) translate(${x}px, ${y}px)`
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
      :style="{ transform: label, pointerEvents: 'all', zIndex: open ? 10 : 1 }"
      @mouseleave="open = false"
    >
      <button
        class="rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-xs font-semibold hover:border-indigo-600"
        :title="'Cliquer pour changer la cardinalité' + (data?.role ? ` — rôle : ${data.role}` : '')"
        @click.stop="open = !open"
      >
        {{ data?.cardinality }}<span v-if="data?.identifying" class="ml-1 font-normal text-indigo-600" title="Identifiant relatif">(CIF)</span><span v-if="data?.role" class="ml-1 font-normal text-slate-500">({{ data.role }})</span>
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
