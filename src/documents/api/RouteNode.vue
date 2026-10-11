<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { FolderPlus, Layers, Lock, Plus } from 'lucide-vue-next'
import { methodBadgeStyle } from './methodStyle'
import { useApiStore } from './apiStore'
import type { PathNode } from './pathTree'

const props = defineProps<{ data: { node: PathNode; title?: string } }>()
const store = useApiStore()
const node = computed(() => props.data.node)
const isRoot = computed(() => node.value.id === '/')
const isParam = computed(() => node.value.segment.startsWith('{'))
const hit = computed(() => store.highlightId === node.value.id)

/** Anomalies de conception des routes de ce chemin (hors simples remarques). */
const problems = computed(() => {
  const ids = new Set(node.value.endpoints.map((e) => e.id))
  const mine = store.issues.filter((i) => i.endpointId && ids.has(i.endpointId) && i.severity !== 'info')
  return { count: mine.length, error: mine.some((i) => i.severity === 'error'), text: mine.map((i) => i.message).join('\n') }
})
</script>

<template>
  <div class="group/node relative w-[280px] rounded-md border-2 border-slate-700 bg-surface text-sm shadow-sm" :class="hit ? 'search-hit' : ''">
    <Handle type="target" :position="Position.Left" :connectable="false" class="!opacity-0" />
    <Handle type="source" :position="Position.Right" :connectable="false" class="!opacity-0" />

    <div
      class="entity-bg flex items-center gap-2 bg-(--entity-bg,var(--color-indigo-100)) px-3 py-1.5 font-mono font-semibold"
      :class="node.endpoints.length ? 'rounded-t-[4px] border-b-2 border-slate-700' : 'rounded-[4px]'"
    >
      <span class="min-w-0 flex-1 truncate" :class="isParam ? 'italic text-indigo-700' : ''">{{ isRoot ? (data.title || 'API') : `/${node.segment}` }}</span>
      <span v-if="problems.count" class="shrink-0 rounded-full px-1.5 text-[11px] font-bold text-white" :class="problems.error ? 'bg-red-500' : 'bg-amber-500'" :title="problems.text">{{ problems.count }}</span>
    </div>

    <ul v-if="node.endpoints.length" class="p-1">
      <li v-for="e in node.endpoints" :key="e.id">
        <button
          class="route-row nodrag nopan flex h-7 w-full items-center gap-2 rounded px-1.5 text-left hover:bg-slate-100"
          :title="`Modifier ${e.method} ${e.path}`"
          @click.stop="store.editingEndpointId = e.id"
        >
          <span class="w-14 shrink-0 rounded px-1 text-center font-mono text-[11px] font-bold" :style="methodBadgeStyle(e.method)">{{ e.method }}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-slate-600">{{ e.summary }}</span>
          <Layers v-if="e.paginated" :size="12" class="shrink-0 text-slate-400" title="Liste paginée" />
          <Lock v-if="e.auth" :size="12" class="shrink-0 text-amber-600" title="Authentification requise" />
        </button>
      </li>
    </ul>

    <!-- Actions au survol -->
    <div class="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100">
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Ajouter une route sur ce chemin"
        aria-label="Ajouter une route sur ce chemin"
        @click.stop="store.addEndpoint(node.id)"
      >
        <Plus :size="14" />
      </button>
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Ajouter un sous-chemin (N)"
        aria-label="Ajouter un sous-chemin"
        @click.stop="store.addSubPath(node.id)"
      >
        <FolderPlus :size="13" />
      </button>
    </div>
  </div>
</template>
