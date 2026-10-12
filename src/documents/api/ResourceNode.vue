<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { Pencil } from 'lucide-vue-next'
import { useApiStore } from './apiStore'
import type { ApiResource } from './model'

const props = defineProps<{ data: { resource: ApiResource; used: number; usedBySchemas: number } }>()
const store = useApiStore()
const resource = computed(() => props.data.resource)
const hit = computed(() => store.highlightId === resource.value.id)
const usage = computed(() => {
  const { used, usedBySchemas } = props.data
  const parts = [used ? `${used} route${used > 1 ? 's' : ''}` : '', usedBySchemas ? `${usedBySchemas} schéma${usedBySchemas > 1 ? 's' : ''}` : ''].filter(Boolean)
  return parts.length ? `Utilisé par ${parts.join(' et ')}` : 'Utilisé nulle part'
})
</script>

<template>
  <div class="group/node relative w-[250px] rounded-md border-2 border-slate-700 bg-surface text-sm shadow-sm" :class="hit ? 'search-hit' : ''" title="Double-clic pour modifier">
    <Handle type="target" :position="Position.Left" :connectable="false" class="!opacity-0" />
    <Handle type="source" :position="Position.Right" :connectable="false" class="!opacity-0" />

    <div class="entity-bg rounded-t-[4px] border-b-2 border-slate-700 bg-(--entity-bg,var(--color-indigo-100)) px-3 py-1.5">
      <div class="truncate text-center font-mono font-semibold">{{ resource.name || '(sans nom)' }}</div>
      <div v-if="resource.description" class="truncate text-center text-[11px] text-slate-500">{{ resource.description }}</div>
    </div>

    <ul class="px-2 py-1 font-mono text-xs">
      <li v-for="f in resource.fields" :key="f.name" class="flex h-6 items-center justify-between gap-2">
        <span class="max-w-[45%] shrink-0 truncate" :class="f.optional ? 'text-slate-500' : 'font-semibold'">{{ f.name }}<span v-if="!f.optional" class="text-red-500" title="Obligatoire">*</span></span>
        <span class="min-w-0 truncate text-indigo-600" :title="f.type">{{ f.type }}</span>
      </li>
      <li v-if="!resource.fields.length" class="h-6 text-center text-slate-400">aucun champ</li>
    </ul>

    <div class="border-t border-slate-200 px-3 py-1 text-[11px]" :class="data.used || data.usedBySchemas ? 'text-slate-500' : 'text-amber-600'">
      {{ usage }}
    </div>

    <div class="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100">
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Modifier le schéma"
        aria-label="Modifier le schéma"
        @click.stop="store.editingResourceId = resource.id"
      >
        <Pencil :size="12" />
      </button>
    </div>
  </div>
</template>
