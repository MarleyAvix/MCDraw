<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed, nextTick, ref } from 'vue'
import { AlertTriangle, KeyRound } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import type { Entity } from '../../types/schema'
import { sqlTypeOf } from '../../engine/meriseToMld'

const props = defineProps<{ data: Entity }>()
const store = useSchemaStore()
const issues = computed(() => store.issues[props.data.id] ?? [])

// Renommage direct par double-clic sur le titre.
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()
async function startRename() {
  draft.value = props.data.name
  editing.value = true
  await nextTick()
  input.value?.select()
}
function commit() {
  if (!editing.value) return
  editing.value = false
  const name = draft.value.trim()
  if (name && name !== props.data.name) store.updateEntity(props.data.id, { name })
}
</script>

<template>
  <div class="relative min-w-40 rounded-md border-2 border-slate-700 bg-surface text-sm shadow-sm">
    <span
      v-if="issues.length"
      class="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow"
      :title="issues.join(' · ')"
    >
      <AlertTriangle :size="12" />
    </span>
    <Handle id="t" type="source" :position="Position.Top" />
    <Handle id="r" type="source" :position="Position.Right" />
    <Handle id="b" type="source" :position="Position.Bottom" />
    <Handle id="l" type="source" :position="Position.Left" />

    <div
      class="rounded-t-[4px] border-b-2 border-slate-700 bg-indigo-100 px-3 py-1.5 text-center font-bold uppercase tracking-wide"
      title="Double-clic pour renommer"
      @dblclick.stop="startRename"
    >
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="nodrag w-full bg-transparent text-center font-bold uppercase outline-none"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.esc="editing = false"
      />
      <template v-else>{{ data.name || '(sans nom)' }}</template>
    </div>
    <ul class="px-3 py-1.5">
      <li v-for="a in data.attributes" :key="a.id" class="flex items-center gap-2 py-0.5">
        <KeyRound v-if="a.isPrimaryKey" :size="12" class="shrink-0 text-amber-600" />
        <span class="flex-1" :class="a.isPrimaryKey ? 'font-semibold underline' : ''">{{ a.name || '…' }}</span>
        <span class="text-[10px] text-slate-400">{{ sqlTypeOf(a) }}</span>
      </li>
      <li v-if="!data.attributes.length" class="py-0.5 text-xs italic text-slate-400">Aucun attribut</li>
    </ul>
  </div>
</template>
