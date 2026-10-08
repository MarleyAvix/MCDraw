<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSpawnPoint } from './composables/useSpawnPoint'
import { Database } from 'lucide-vue-next'
import { useSchemaStore } from './stores/schemaStore'
import FlowCanvas from './components/canvas/FlowCanvas.vue'
import MldDiagram from './components/canvas/MldDiagram.vue'
import DerivedDiagram from './components/canvas/DerivedDiagram.vue'
import SearchBox from './components/panels/SearchBox.vue'
import Toolbar from './components/panels/Toolbar.vue'
import TextPanel from './components/panels/TextPanel.vue'
import LintPanel from './components/panels/LintPanel.vue'
import MldPanel from './components/panels/MldPanel.vue'
import SqlExportModal from './components/panels/SqlExportModal.vue'
import EditEntityModal from './components/modals/EditEntityModal.vue'
import EditRelationModal from './components/modals/EditRelationModal.vue'

const store = useSchemaStore()
const spawnPoint = useSpawnPoint()

// Panneau MLD repliable : le choix est mémorisé ; sans choix, replié sur écran étroit.
const MLD_KEY = 'mcdraw.mldOpen'
function initialMldOpen(): boolean {
  try {
    const v = localStorage.getItem(MLD_KEY)
    if (v !== null) return v === '1'
  } catch {
    /* stockage indisponible */
  }
  return window.innerWidth >= 1024
}
const mldOpen = ref(initialMldOpen())
// Le panneau de saisie texte appartient à la vue MCD.
const textOpen = computed(() => store.showTextPanel && store.view === 'mcd')
function toggleMld() {
  mldOpen.value = !mldOpen.value
  try {
    localStorage.setItem(MLD_KEY, mldOpen.value ? '1' : '0')
  } catch {
    /* stockage indisponible */
  }
}

// Raccourcis (hors champs de saisie) : N entité, A association, Ctrl+Z/Y annuler/rétablir, Ctrl+A tout sélectionner, Ctrl+C/V/D copier/coller/dupliquer.
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (store.view !== 'mcd') return
  if (document.querySelector('[role="dialog"], .fixed.inset-0')) return // modale ouverte
  const k = e.key.toLowerCase()
  if (!(e.ctrlKey || e.metaKey)) {
    if (e.altKey || e.shiftKey) return
    const p = spawnPoint()
    if (k === 'n') store.addEntity(p.x, p.y)
    else if (k === 'a') store.addRelation(p.x, p.y)
    else return
    e.preventDefault()
    return
  }
  if (k === 'z' && !e.shiftKey) store.undo()
  else if (k === 'y' || (k === 'z' && e.shiftKey)) store.redo()
  else if (k === 'a') store.selection = [...store.entities, ...store.relations].map((n) => n.id)
  else if (k === 'c') store.copyNodes(store.selection)
  else if (k === 'v') store.paste()
  else if (k === 'd') store.duplicateNodes(store.selection)
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-surface px-4 py-2.5">
      <div class="flex items-center gap-2">
        <Database :size="22" class="text-indigo-600" />
        <div class="leading-tight">
          <h1 class="text-base font-bold">MCDraw</h1>
          <p class="text-xs text-slate-500">Concevez vos MCD, exportez vos MLD en un clic.</p>
        </div>
      </div>
      <Toolbar />
    </header>

    <main
      class="grid min-h-0 flex-1"
      :class="[textOpen ? (mldOpen ? 'grid-cols-[340px_1fr_340px]' : 'grid-cols-[340px_1fr_40px]') : mldOpen ? 'grid-cols-[1fr_340px]' : 'grid-cols-[1fr_40px]']"
    >
      <TextPanel v-if="textOpen" />
      <div class="relative h-full min-w-0">
        <SearchBox />
        <LintPanel v-if="store.view === 'mcd'" />
        <FlowCanvas v-if="store.view === 'mcd'" />
        <MldDiagram v-else-if="store.view === 'mld'" />
        <DerivedDiagram v-else :key="store.view" :kind="store.view" />
      </div>
      <MldPanel :open="mldOpen" @toggle="toggleMld" />
    </main>

    <EditEntityModal v-if="store.editingEntityId" :key="store.editingEntityId" />
    <EditRelationModal v-if="store.editingRelationId" :key="store.editingRelationId" />
    <SqlExportModal v-if="store.showSqlModal" />
  </div>
</template>
