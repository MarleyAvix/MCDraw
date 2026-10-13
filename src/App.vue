<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useDocumentStore } from './core/documentStore'
import { useActiveDocument } from './core/useActiveDocument'
import { initPanels, isPanelOpen, togglePanel } from './core/panelState'
import SearchBox from './components/panels/SearchBox.vue'
import HeaderToolbar from './components/panels/HeaderToolbar.vue'
import CanvasToolbar from './components/panels/CanvasToolbar.vue'
import ShareModal from './components/panels/ShareModal.vue'
import { useAppearanceApplier } from './composables/useAppearance'
import ThemeModal from './components/panels/ThemeModal.vue'
import ShortcutsModal from './components/modals/ShortcutsModal.vue'
import { useShareLink } from './composables/useShareLink'

const store = useDocumentStore()
useAppearanceApplier(() => store.activeId)
const { type, doc, view, ctx } = useActiveDocument()
initPanels()

// Panneaux du type actif, par emplacement (un panneau repliable ne garde que sa bande de 40 px quand il est fermé).
const panels = (side: 'left' | 'right' | 'canvas') => type.value.panels.filter((p) => p.side === side && p.visible(view.value.id))
const columns = computed(() =>
  [
    ...panels('left').map((p) => `${p.width ?? 340}px`),
    '1fr',
    ...panels('right').map((p) => (p.collapsible && !isPanelOpen(p.collapsible.storageKey) ? '40px' : `${p.width ?? 340}px`)),
  ].join(' '),
)
const panelProps = (p: ReturnType<typeof panels>[number]) =>
  p.collapsible ? { open: isPanelOpen(p.collapsible.storageKey), onToggle: () => togglePanel(p.collapsible!.storageKey) } : {}

// Raccourcis (hors champs de saisie, dans une vue d'édition) : les touches du type, puis Ctrl+Z/Y annuler/rétablir,
// Ctrl+A tout sélectionner, Ctrl+C/V/D copier/coller/dupliquer.
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (!view.value.editable) return
  if (document.querySelector('[role="dialog"], .fixed.inset-0')) return // modale ouverte
  const k = e.key.toLowerCase()
  const d = doc.value
  if (!(e.ctrlKey || e.metaKey)) {
    if (e.altKey || e.shiftKey) return
    const s = type.value.shortcuts.find((x) => x.key === k)
    if (!s) return
    s.run(ctx())
    e.preventDefault()
    return
  }
  if (k === 'z' && !e.shiftKey) d.undo()
  else if (k === 'y' || (k === 'z' && e.shiftKey)) d.redo()
  else if (k === 'a') d.selectAll()
  else if (k === 'c') d.copy()
  else if (k === 'v') d.paste()
  else if (k === 'd') d.duplicate()
  else return
  e.preventDefault()
}
useShareLink()
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-200 bg-surface px-4 py-2.5">
      <div class="flex items-center gap-2">
        <component :is="type.icon" :size="22" class="text-indigo-600" />
        <div class="leading-tight">
          <h1 class="text-base font-bold">MCDraw</h1>
          <p class="text-xs text-slate-500">{{ type.tagline }}</p>
        </div>
      </div>
      <HeaderToolbar />
    </header>

    <main class="grid min-h-0 flex-1" :style="{ gridTemplateColumns: columns }">
      <component :is="p.Component" v-for="p in panels('left')" :key="p.id" v-bind="panelProps(p)" />
      <div class="relative h-full min-w-0">
        <SearchBox />
        <component :is="p.Component" v-for="p in panels('canvas')" :key="p.id" />
        <component :is="view.Component" :key="view.id" v-bind="view.props" />
        <CanvasToolbar />
      </div>
      <component :is="p.Component" v-for="p in panels('right')" :key="p.id" v-bind="panelProps(p)" />
    </main>

    <template v-for="m in type.modals" :key="m.id">
      <component :is="m.Component" v-if="m.visible()" :key="m.key?.() ?? m.id" />
    </template>
    <ShortcutsModal v-if="store.showShortcutsModal" />
    <ShareModal v-if="store.showShareModal" />
    <ThemeModal v-if="store.showThemeModal" />
  </div>
</template>
