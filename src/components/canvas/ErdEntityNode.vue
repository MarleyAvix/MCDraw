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
const isBox = computed(() => props.data.kind === 'box')
// Les associations réifiées (comme les tables d'association du MLD) se renomment par double-clic.
const renamable = computed(() => props.data.kind !== 'entity')
const { editing, draft, setInput, start, commit, cancel } = useInlineRename(
  () => props.data.name,
  (name) => store.updateRelation(props.data.id, { name }),
)
const startRename = () => renamable.value && start()
</script>

<template>
  <div
    class="w-[210px] border-slate-700 bg-surface text-sm shadow-sm"
    :class="[isBox ? 'rounded-xl border-2 border-dashed' : 'rounded-md', data.weak ? 'border-double border-[6px]' : isBox ? '' : 'border-2', hit ? 'search-hit' : '']"
    :title="data.weak ? 'Entité faible : identifiée relativement à une autre entité' : undefined"
  >
    <Handle type="source" :position="Position.Top" :connectable="false" class="!opacity-0" />
    <div
      class="flex items-center justify-center gap-3 border-b-2 border-slate-700 px-3 py-1.5 font-bold uppercase tracking-wide"
      :class="isBox ? 'rounded-t-[10px] bg-amber-100' : 'rounded-t-[4px] bg-indigo-100'"
    >
      <input
        v-if="editing"
        :ref="setInput"
        v-model="draft"
        class="nodrag min-w-0 flex-1 rounded border border-indigo-600 bg-surface px-1 py-0.5 text-sm font-bold outline-none"
        placeholder="nom de l’association"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.esc="cancel"
      />
      <span
        v-else
        class="group/name flex min-w-0 items-center gap-1.5"
        :title="renamable ? 'Double-clic pour renommer l’association' : undefined"
        @dblclick.stop="startRename"
      >
        <span class="truncate">{{ data.name || '(sans nom)' }}</span>
        <Pencil v-if="renamable" :size="11" class="nodrag shrink-0 cursor-pointer text-slate-400 opacity-0 group-hover/name:opacity-100" @click.stop="startRename" />
      </span>
    </div>
    <ul class="px-3 py-1.5">
      <li v-for="a in data.attributes" :key="a.id" class="flex items-center gap-1.5 py-0.5">
        <span class="w-5 shrink-0 text-[10px] font-bold text-amber-600">{{ a.isPrimaryKey ? 'PK' : '' }}</span>
        <span class="flex-1 truncate" :class="a.isPrimaryKey ? 'font-semibold underline' : ''">{{ a.name || '…' }}</span>
        <span class="text-[10px] text-slate-400">{{ a.type }}</span>
      </li>
      <li v-if="!data.attributes.length" class="py-0.5 text-xs italic text-slate-400">Aucun attribut</li>
    </ul>
  </div>
</template>
