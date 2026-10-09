<script setup lang="ts">
import { useSpawnPoint } from '../../composables/useSpawnPoint'
import {
  Square, Circle, RotateCcw, Undo2, Redo2, LayoutGrid, TextCursorInput
} from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { useAutoLayout } from '../../composables/useAutoLayout'

const store = useSchemaStore()
const spawnPoint = useSpawnPoint()
const { layout } = useAutoLayout()

const addEntity = () => {
  const p = spawnPoint()
  store.addEntity(p.x, p.y)
}
const addRelation = () => {
  const p = spawnPoint()
  store.addRelation(p.x, p.y)
}
function reset() {
  if (confirm('Effacer tout le MCD ? (Ctrl+Z pour annuler)')) store.reset()
}

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface shadow-sm'
</script>

<template>
  <div class="absolute bottom-4 left-16 z-10 flex items-center gap-2 rounded-lg bg-surface/80 p-2 shadow-lg backdrop-blur-sm border border-slate-200">
    <template v-if="store.view === 'mcd'">
      <button :class="btn" @click="addEntity"><Square :size="16" class="text-indigo-600" /> Entité</button>
      <button :class="btn" @click="addRelation"><Circle :size="16" class="text-amber-600" /> Association</button>
      <button :class="[btn, store.showTextPanel ? 'border-indigo-600 text-indigo-600' : '']" :aria-pressed="store.showTextPanel" title="Saisir le MCD en texte" @click="store.showTextPanel = !store.showTextPanel">
        <TextCursorInput :size="16" /> Texte
      </button>

      <span class="mx-1 h-6 w-px bg-slate-200" />

      <button :class="btn" :disabled="!store.canUndo" title="Annuler (Ctrl+Z)" @click="store.undo()"><Undo2 :size="16" /></button>
      <button :class="btn" :disabled="!store.canRedo" title="Rétablir (Ctrl+Y)" @click="store.redo()"><Redo2 :size="16" /></button>
    </template>
    <button :class="btn" title="Organiser automatiquement" @click="store.view === 'mcd' ? layout() : store.mldRelayout++"><LayoutGrid :size="16" /> Organiser</button>

    <template v-if="store.view === 'mcd'">
      <span class="mx-1 h-6 w-px bg-slate-200" />
      <button :class="btn" @click="reset"><RotateCcw :size="16" /> Réinitialiser</button>
    </template>
  </div>
</template>
