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
// Les associations réifiées (comme les tables d'association du MLD) se renomment par double-clic.
const renamable = computed(() => props.data.kind !== 'entity')
const { editing, draft, setInput, start, commit, cancel } = useInlineRename(
  () => props.data.name,
  (name) => store.updateRelation(props.data.id, { name }),
)
const startRename = () => renamable.value && start()
</script>

<template>
  <!-- Classe UML : nom, puis attributs « + nom : TYPE » ; la classe d'association est dessinée en pointillés -->
  <div
    class="w-[210px] border-2 border-slate-700 bg-surface text-sm shadow-sm"
    :class="[data.kind === 'box' ? 'border-dashed' : '', hit ? 'search-hit' : '']"
  >
    <Handle type="source" :position="Position.Top" :connectable="false" class="!opacity-0" />
    <div
      class="flex items-center justify-center gap-3 border-b-2 border-slate-700 px-3 py-1.5 font-bold"
      :class="data.kind === 'box' ? 'bg-(--relation-bg,var(--color-amber-100)) relation-bg' : 'bg-(--entity-bg,var(--color-indigo-100)) entity-bg'"
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
    <ul class="min-h-6 px-3 py-1.5 font-mono text-xs">
      <li v-for="a in data.attributes" :key="a.id" class="truncate py-0.5" :class="a.isPrimaryKey ? 'font-semibold' : ''">
        + {{ a.name || '…' }} : {{ a.type }}<span v-if="a.isPrimaryKey" class="text-amber-600"> {id}</span>
      </li>
    </ul>
  </div>
</template>
