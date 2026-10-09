<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { KeyRound, Link2, Pencil } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import type { MldTable } from '../../types/schema'
import { constraintTags, splitColumns } from '../../engine/meriseToMld'

const props = defineProps<{ data: MldTable }>()
const cols = computed(() => splitColumns(props.data))
const store = useSchemaStore()
const hit = computed(() => store.highlightId === props.data.name)

// Les tables d'association peuvent être renommées (double-clic) ; un nom vide rétablit le nom automatique.
const renamable = computed(() => props.data.origin === 'association')
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()
async function startRename() {
  if (!renamable.value) return
  draft.value = props.data.name
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function commit() {
  if (!editing.value) return
  editing.value = false
  const name = draft.value.trim()
  if (name === props.data.name) return
  store.updateRelation(props.data.sourceId, { tableName: name || undefined })
}
</script>

<template>
  <div :class="{ 'search-hit': hit }" class="min-w-48 rounded-md border-2 border-slate-700 bg-surface text-sm shadow-sm">
    <div
      class="flex items-center justify-between gap-3 rounded-t-[4px] border-b-2 border-slate-700 px-3 py-1.5 font-bold"
      :class="data.origin === 'entity' ? 'bg-(--entity-bg,var(--color-indigo-100))' : 'bg-(--relation-bg,var(--color-amber-100))'"
    >
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="nodrag min-w-0 flex-1 rounded border border-indigo-600 bg-surface px-1 py-0.5 text-sm font-bold outline-none"
        placeholder="nom automatique"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.esc="editing = false"
      />
      <span
        v-else
        class="group/name flex items-center gap-1.5"
        :title="renamable ? 'Double-clic pour renommer la table' : undefined"
        @dblclick.stop="startRename"
      >
        {{ data.name }}
        <Pencil v-if="renamable" :size="11" class="nodrag cursor-pointer text-slate-400 opacity-0 group-hover/name:opacity-100" @click.stop="startRename" />
      </span>
      <span class="text-[10px] font-normal uppercase text-slate-500">{{ data.origin === 'entity' ? 'entité' : 'association' }}</span>
    </div>

    <!-- Clé primaire : un seul bloc, même composée (une clé, plusieurs colonnes) -->
    <div v-if="cols.pk.length" class="border-b border-slate-300 border-l-4 border-l-amber-500 bg-amber-500/10">
      <div class="flex items-center gap-1 px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
        <KeyRound :size="10" /> Clé primaire{{ cols.pk.length > 1 ? ' composée' : '' }}
      </div>
      <ul>
        <li v-for="c in cols.pk" :key="c.name" class="relative flex items-center gap-1.5 px-3 py-1">
          <Handle :id="`l-${c.name}`" type="source" :position="Position.Left" />
          <Link2 v-if="c.isForeignKey" :size="12" class="shrink-0 text-sky-500" />
          <span class="flex-1 font-semibold underline">{{ c.name }}</span>
          <span class="text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}{{ constraintTags(c) }}</span>
          <Handle :id="`r-${c.name}`" type="source" :position="Position.Right" />
        </li>
      </ul>
    </div>

    <!-- Une clé étrangère = un bloc (même présentation que la clé primaire, en bleu) -->
    <div
      v-for="g in cols.fks"
      :key="g.columns.map((c) => c.name).join()"
      class="border-b border-slate-300 border-l-4 border-l-sky-500 bg-sky-500/10"
    >
      <div class="flex items-center gap-1 px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">
        <Link2 :size="10" /> Clé étrangère{{ g.columns.length > 1 ? ' composée' : '' }}{{ g.unique && g.columns.length > 1 ? ' unique' : '' }} → {{ g.refTable }}
      </div>
      <ul>
        <li v-for="c in g.columns" :key="c.name" class="relative flex items-center gap-1.5 px-3 py-1">
          <Handle :id="`l-${c.name}`" type="source" :position="Position.Left" />
          <span class="flex-1">{{ c.name }}</span>
          <span class="text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}{{ constraintTags(c) }}</span>
          <Handle :id="`r-${c.name}`" type="source" :position="Position.Right" />
        </li>
      </ul>
    </div>

    <ul>
      <li v-for="c in cols.others" :key="c.name" class="relative flex items-center gap-1.5 px-3 py-1">
        <Handle :id="`l-${c.name}`" type="source" :position="Position.Left" />
        <span class="flex-1">{{ c.name }}</span>
        <span class="text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}{{ constraintTags(c) }}</span>
        <Handle :id="`r-${c.name}`" type="source" :position="Position.Right" />
      </li>
    </ul>
  </div>
</template>
