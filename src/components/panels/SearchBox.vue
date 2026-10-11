<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { Search, Square, Circle, Table2, TextCursorInput, FileText, X } from 'lucide-vue-next'
import { useActiveDocument } from '../../core/useActiveDocument'
import type { SearchHit as Hit } from '../../core/documentType'

const { doc, view } = useActiveDocument()

const query = ref('')
const open = ref(false)
const active = ref(0)
const input = ref<HTMLInputElement>()

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tout ce qui est cherchable dans la vue courante. */
const index = computed<Hit[]>(() => doc.value.searchIndex(view.value.id))

const results = computed<Hit[]>(() => {
  const q = norm(query.value.trim())
  if (!q) return []
  const rank = (h: Hit) => {
    const l = norm(h.label)
    return (l === q ? 0 : l.startsWith(q) ? 1 : 2) + (h.kind === 'attribute' ? 3 : 0)
  }
  return index.value
    .filter((h) => norm(h.label).includes(q))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 8)
})

watch(results, () => (active.value = 0))

const icons = { entity: Square, relation: Circle, table: Table2, attribute: TextCursorInput, page: FileText }

/** Sélectionne l'élément, recadre le canvas dessus et le fait clignoter. */
function pick(hit: Hit) {
  const flow = useVueFlow(view.value.flowId)
  if (view.value.editable) doc.value.selection.value = [hit.nodeId]
  const node = flow.findNode(hit.nodeId)
  if (node) {
    const w = node.dimensions?.width || 180
    const h = node.dimensions?.height || 100
    flow.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: Math.max(flow.viewport.value.zoom, 0.9), duration: 350 })
  }
  doc.value.flash(hit.nodeId)
  open.value = false
  input.value?.blur()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(active.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter') {
    const hit = results.value[active.value]
    if (hit) pick(hit)
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    clear()
    input.value?.blur()
  }
}

function clear() {
  query.value = ''
  open.value = false
}

async function focusSearch() {
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

// Ctrl+F (ou « / » hors champ de saisie) active la recherche de l'application plutôt que celle du navigateur.
function onGlobalKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  if (document.querySelector('.fixed.inset-0')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    focusSearch()
  } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    focusSearch()
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <div class="absolute left-3 top-3 z-20 w-72" @focusout="open = false">
    <div class="flex items-center gap-2 rounded-md border border-slate-300 bg-surface px-2.5 py-1.5 shadow-sm focus-within:border-indigo-600">
      <Search :size="15" class="shrink-0 text-slate-400" />
      <input
        ref="input"
        v-model="query"
        :placeholder="view.searchPlaceholder ?? 'Rechercher… (Ctrl+F)'"
        class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
        aria-label="Rechercher dans le schéma"
        @focus="open = true"
        @input="open = true"
        @keydown="onKeydown"
      />
      <button v-if="query" class="shrink-0 text-slate-400 hover:text-slate-700" title="Effacer" @mousedown.prevent="clear"><X :size="14" /></button>
    </div>

    <ul v-if="open && query.trim()" class="mt-1 overflow-hidden rounded-md border border-slate-200 bg-surface text-sm shadow-lg" role="listbox">
      <li
        v-for="(h, i) in results"
        :key="h.key"
        role="option"
        :aria-selected="i === active"
        class="flex cursor-pointer items-center gap-2 px-3 py-1.5"
        :class="i === active ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'"
        @mousedown.prevent="pick(h)"
        @mousemove="active = i"
      >
        <component :is="icons[h.kind]" :size="14" class="shrink-0" :class="i === active ? 'text-white' : 'text-slate-400'" />
        <span class="min-w-0 flex-1 truncate font-medium">{{ h.label || '(sans nom)' }}</span>
        <span class="shrink-0 text-xs" :class="i === active ? 'text-indigo-100' : 'text-slate-400'">{{ h.context }}</span>
      </li>
      <li v-if="!results.length" class="px-3 py-2 text-xs italic text-slate-400">Aucun résultat</li>
    </ul>
  </div>
</template>
