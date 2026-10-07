<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@vue-flow/core'
import { floatingLine } from '../../composables/edgeGeometry'
import type { InheritanceStrategy } from '../../types/schema'

const props = defineProps<EdgeProps<{ strategy: InheritanceStrategy }>>()

const LABELS: Record<InheritanceStrategy, string> = {
  class: 'une table par classe',
  single: 'une seule table',
  concrete: 'une table par classe fille',
}

const line = computed(() => floatingLine(props.sourceNode, props.targetNode))
const path = computed(() => `M ${line.value.source.x},${line.value.source.y} L ${line.value.target.x},${line.value.target.y}`)
const mid = computed(() => ({ x: (line.value.source.x + line.value.target.x) / 2, y: (line.value.source.y + line.value.target.y) / 2 }))
// Triangle creux (flèche de spécialisation) posé sur l'entité mère, pointe vers elle.
const arrow = computed(() => {
  const { target, dir } = line.value
  return `translate(${target.x} ${target.y}) rotate(${(Math.atan2(dir.y, dir.x) * 180) / Math.PI})`
})
</script>

<template>
  <BaseEdge :id="id" :path="path" :style="{ strokeWidth: 2, ...style }" />
  <polygon points="0,0 -16,-9 -16,9" :transform="arrow" fill="var(--color-surface, white)" stroke="currentColor" stroke-width="2" class="pointer-events-none text-slate-700" />
  <EdgeLabelRenderer>
    <div
      class="nodrag nopan pointer-events-none absolute rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-xs"
      :style="{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }"
    >
      <span class="font-semibold">est un</span>
      <span class="ml-1 text-slate-500">· {{ LABELS[data?.strategy ?? 'class'] }}</span>
    </div>
  </EdgeLabelRenderer>
</template>
