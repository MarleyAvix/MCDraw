<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed, nextTick, ref } from 'vue'
import { ChevronLeft, ChevronRight, Pencil, Plus, StickyNote } from 'lucide-vue-next'
import { useMindmapStore } from './mindmapStore'
import type { MindNode, Side } from './engine'

const props = defineProps<{ data: { node: MindNode; side: Side; color: string; isRoot: boolean; childCount: number } }>()
const store = useMindmapStore()
const node = computed(() => props.data.node)
const hit = computed(() => store.highlightId === node.value.id)
const collapsed = computed(() => !!node.value.collapsed)

// Renommage direct par double-clic.
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()
async function startRename() {
  draft.value = node.value.text
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function commit() {
  if (!editing.value) return
  editing.value = false
  const text = draft.value.trim()
  if (text && text !== node.value.text) store.updateNode(node.value.id, { text })
}

// Le bouton de repli est du côté où partent les branches.
const outward = computed(() => (props.data.side === 'left' ? 'left' : 'right'))
</script>

<template>
  <div
    class="group/node relative flex h-[40px] w-[170px] items-center justify-center rounded-full border-2 px-3 text-sm shadow-sm"
    :class="[hit ? 'search-hit' : '', data.isRoot ? 'font-bold text-white' : 'font-medium']"
    :style="
      data.isRoot
        ? { background: data.color, borderColor: data.color }
        : { borderColor: data.color, background: `color-mix(in srgb, ${data.color} 14%, var(--color-surface))` }
    "
    title="Double-clic pour renommer"
    @dblclick.stop="startRename"
  >
    <Handle id="tl" type="target" :position="Position.Left" :connectable="false" class="!opacity-0" />
    <Handle id="tr" type="target" :position="Position.Right" :connectable="false" class="!opacity-0" />
    <Handle id="sl" type="source" :position="Position.Left" :connectable="false" class="!opacity-0" />
    <Handle id="sr" type="source" :position="Position.Right" :connectable="false" class="!opacity-0" />

    <input
      v-if="editing"
      ref="input"
      v-model="draft"
      class="nodrag w-full bg-transparent text-center outline-none"
      aria-label="Texte de l'idée"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.esc="editing = false"
    />
    <span v-else class="min-w-0 truncate">{{ node.text || '(sans titre)' }}</span>
    <StickyNote v-if="node.note && !editing" :size="12" class="ml-1.5 shrink-0" :class="data.isRoot ? 'text-white/80' : 'text-amber-600'" :title="node.note" />

    <!-- Repli / dépli de la branche -->
    <button
      v-if="data.childCount"
      class="nodrag nopan absolute top-1/2 z-10 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-surface px-1 text-[10px] font-semibold text-slate-600 shadow transition-opacity hover:bg-indigo-600 hover:text-white focus-visible:opacity-100"
      :class="[outward === 'left' ? '-left-3' : '-right-3', collapsed ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100']"
      :title="collapsed ? 'Déplier la branche' : 'Replier la branche'"
      :aria-label="collapsed ? 'Déplier la branche' : 'Replier la branche'"
      :aria-expanded="!collapsed"
      @click.stop="store.toggleCollapse(node.id)"
    >
      <template v-if="collapsed">{{ data.childCount }}</template>
      <component :is="outward === 'left' ? ChevronRight : ChevronLeft" v-else :size="12" />
    </button>

    <!-- Actions au survol -->
    <div class="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100">
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Ajouter une sous-idée (Tab)"
        aria-label="Ajouter une sous-idée"
        @click.stop="store.addNode(node.id)"
      >
        <Plus :size="14" />
      </button>
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Modifier (note, suppression)"
        aria-label="Modifier l'idée"
        @click.stop="store.editingNodeId = node.id"
      >
        <Pencil :size="12" />
      </button>
    </div>
  </div>
</template>
