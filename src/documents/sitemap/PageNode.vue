<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed, nextTick, ref } from 'vue'
import { Pencil, Plus, StickyNote } from 'lucide-vue-next'
import { useSitemapStore } from './sitemapStore'
import type { SitemapPage } from './engine'

const props = defineProps<{ data: { page: SitemapPage; depth: number; hasChildren: boolean } }>()
const store = useSitemapStore()
const page = computed(() => props.data.page)
const hit = computed(() => store.highlightId === page.value.id)

// Renommage direct par double-clic sur le titre.
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()
async function startRename() {
  draft.value = page.value.title
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function commit() {
  if (!editing.value) return
  editing.value = false
  const title = draft.value.trim()
  if (title && title !== page.value.title) store.updatePage(page.value.id, { title })
}
</script>

<template>
  <div class="group/node relative w-[190px] rounded-md border-2 border-slate-700 bg-surface text-sm shadow-sm" :class="hit ? 'search-hit' : ''">
    <Handle type="target" :position="Position.Top" :connectable="false" class="!opacity-0" />
    <Handle type="source" :position="Position.Bottom" :connectable="false" class="!opacity-0" />

    <div
      class="entity-bg rounded-t-[4px] bg-(--entity-bg,var(--color-indigo-100)) px-3 py-1.5 text-center font-semibold"
      :class="page.url || page.note ? 'border-b-2 border-slate-700' : 'rounded-b-[4px]'"
      title="Double-clic pour renommer"
      @dblclick.stop="startRename"
    >
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="nodrag w-full bg-transparent text-center font-semibold outline-none"
        aria-label="Titre de la page"
        @blur="commit"
        @keydown.enter="commit"
        @keydown.esc="editing = false"
      />
      <template v-else>{{ page.title || '(sans titre)' }}</template>
    </div>
    <div v-if="page.url || page.note" class="flex items-center gap-1.5 px-3 py-1 font-mono text-xs text-slate-500">
      <span class="min-w-0 flex-1 truncate">{{ page.url ?? '' }}</span>
      <StickyNote v-if="page.note" :size="12" class="shrink-0 text-amber-600" :title="page.note" />
    </div>

    <!-- Actions au survol -->
    <div class="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within:opacity-100">
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Ajouter une sous-page (N)"
        aria-label="Ajouter une sous-page"
        @click.stop="store.addPage(page.id)"
      >
        <Plus :size="14" />
      </button>
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 shadow hover:bg-indigo-600 hover:text-white"
        title="Modifier (adresse, note)"
        aria-label="Modifier la page"
        @click.stop="store.editingPageId = page.id"
      >
        <Pencil :size="12" />
      </button>
    </div>
  </div>
</template>
