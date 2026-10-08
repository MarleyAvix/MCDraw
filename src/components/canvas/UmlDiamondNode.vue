<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Pencil } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { useInlineRename } from '../../composables/useInlineRename'
import type { DiagramNode } from '../../engine/meriseToDiagram'

const props = defineProps<{ data: DiagramNode }>()
const store = useSchemaStore()
const hit = computed(() => store.highlightId === props.data.id)
const { editing, draft, setInput, start, commit, cancel } = useInlineRename(
  () => props.data.name,
  (name) => store.updateRelation(props.data.id, { name }),
)
</script>

<template>
  <!-- Losange d'association n-aire ; le nom est posé dessous sans compter dans la taille du nœud -->
  <div class="relative h-11 w-11" :class="hit ? 'search-hit' : ''">
    <Handle type="source" :position="Position.Top" :connectable="false" class="!opacity-0" />
    <svg viewBox="0 0 44 44" class="h-full w-full text-slate-700">
      <polygon points="22,2 42,22 22,42 2,22" fill="var(--color-surface, white)" stroke="currentColor" stroke-width="2" />
    </svg>
    <div class="absolute left-1/2 top-full mt-0.5 -translate-x-1/2">
      <input
        v-if="editing"
        :ref="setInput"
        v-model="draft"
        class="nodrag w-36 rounded border border-indigo-600 bg-surface px-1 py-0.5 text-sm font-bold outline-none"
        placeholder="nom de l’association"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.esc="cancel"
      />
      <span
        v-else
        class="group/name flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold"
        title="Double-clic pour renommer l’association"
        @dblclick.stop="start"
      >
        {{ data.name || '(sans nom)' }}
        <Pencil :size="11" class="nodrag cursor-pointer text-slate-400 opacity-0 group-hover/name:opacity-100" @click.stop="start" />
      </span>
    </div>
  </div>
</template>
