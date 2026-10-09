<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { AlertTriangle } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import AttributeRows from './AttributeRows.vue'
import type { Relation } from '../../types/schema'

const props = defineProps<{ data: Relation }>()
const store = useSchemaStore()
const hit = computed(() => store.highlightId === props.data.id)
const issues = computed(() => store.issues[props.data.id] ?? [])

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()
async function startRename() {
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
  if (name && name !== props.data.name) store.updateRelation(props.data.id, { name })
}
</script>

<template>
  <div
    :class="[hit ? 'search-hit' : '', data.attributes.length ? 'rounded-2xl px-4 py-2' : 'rounded-[50%] px-6 py-3']"
    class="group/node relative flex min-h-16 min-w-32 flex-col items-center justify-center border-2 border-slate-700 bg-(--relation-bg,var(--color-amber-50)) relation-bg text-center text-sm shadow-sm">
    <span
      v-if="issues.length"
      class="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow"
      :title="issues.join(' · ')"
    >
      <AlertTriangle :size="12" />
    </span>
    <Handle id="t" type="source" :position="Position.Top" />
    <Handle id="r" type="source" :position="Position.Right" />
    <Handle id="b" type="source" :position="Position.Bottom" />
    <Handle id="l" type="source" :position="Position.Left" />

    <div class="font-bold" title="Double-clic pour renommer" @dblclick.stop="startRename">
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="nodrag w-28 bg-transparent text-center font-bold outline-none"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.esc="editing = false"
      />
      <template v-else>{{ data.name || '(sans nom)' }}</template>
    </div>
    <hr v-if="data.attributes.length" class="my-1.5 w-full border-t-2 border-slate-600" />
    <AttributeRows :node-id="data.id" :attributes="data.attributes" kind="relation" class="w-full text-left text-xs" />
  </div>
</template>
