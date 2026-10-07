<script setup lang="ts">
import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useSpawnPoint } from '../../composables/useSpawnPoint'
import {
  Square, Circle, Code2, RotateCcw, BookOpen, ChevronDown, Sun, Moon,
  Undo2, Redo2, LayoutGrid, FileDown, FileUp, Image, FileJson,
} from 'lucide-vue-next'
import { EXAMPLES, useSchemaStore } from '../../stores/schemaStore'
import { useTheme } from '../../composables/useTheme'
import { useFileIO } from '../../composables/useFileIO'
import { useAutoLayout } from '../../composables/useAutoLayout'

const store = useSchemaStore()
const { fitView } = useVueFlow('mcdraw')
const spawnPoint = useSpawnPoint()
const { isDark, toggle: toggleTheme } = useTheme()
const { exportJson, importJson, exportImage } = useFileIO()
const { layout } = useAutoLayout()

const menu = ref<'examples' | 'file' | null>(null)
const fileInput = ref<HTMLInputElement>()
const toggleMenu = (m: 'examples' | 'file') => (menu.value = menu.value === m ? null : m)

const addEntity = () => {
  const p = spawnPoint()
  store.addEntity(p.x, p.y)
}
const addRelation = () => {
  const p = spawnPoint()
  store.addRelation(p.x, p.y)
}
function loadExample(id: string) {
  menu.value = null
  store.loadExample(id)
  setTimeout(() => fitView({ padding: 0.2 }), 50)
}
function reset() {
  if (confirm('Effacer tout le MCD ? (Ctrl+Z pour annuler)')) store.reset()
}
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) importJson(file)
  input.value = ''
}
function run(fn: () => void) {
  menu.value = null
  fn()
}

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface'
const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100'
const panel = 'absolute left-0 top-full z-40 mt-1 rounded-md border border-slate-200 bg-surface py-1 shadow-lg'
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="inline-flex overflow-hidden rounded-md border border-slate-300" role="tablist" aria-label="Vue">
      <button
        v-for="v in (['mcd', 'mld'] as const)"
        :key="v"
        role="tab"
        :aria-selected="store.view === v"
        class="px-3 py-1.5 text-sm font-semibold uppercase"
        :class="store.view === v ? 'bg-indigo-600 text-white' : 'bg-surface hover:bg-slate-100'"
        :title="v === 'mcd' ? 'Modèle conceptuel (édition)' : 'Modèle logique : tables et clés étrangères'"
        @click="store.view = v"
      >
        {{ v }}
      </button>
    </div>

    <span class="mx-1 h-6 w-px bg-slate-200" />

    <template v-if="store.view === 'mcd'">
    <button :class="btn" @click="addEntity"><Square :size="16" class="text-indigo-600" /> Entité</button>
    <button :class="btn" @click="addRelation"><Circle :size="16" class="text-amber-600" /> Association</button>

    <span class="mx-1 h-6 w-px bg-slate-200" />

    <button :class="btn" :disabled="!store.canUndo" title="Annuler (Ctrl+Z)" @click="store.undo()"><Undo2 :size="16" /></button>
    <button :class="btn" :disabled="!store.canRedo" title="Rétablir (Ctrl+Y)" @click="store.redo()"><Redo2 :size="16" /></button>
    </template>
    <button :class="btn" title="Organiser automatiquement" @click="store.view === 'mcd' ? layout() : store.mldRelayout++"><LayoutGrid :size="16" /> Organiser</button>

    <span class="mx-1 h-6 w-px bg-slate-200" />

    <div v-if="store.view === 'mcd'" class="relative">
      <button :class="btn" @click="toggleMenu('examples')"><BookOpen :size="16" /> Exemples <ChevronDown :size="14" /></button>
      <div v-if="menu === 'examples'" :class="[panel, 'w-72']">
        <button v-for="ex in EXAMPLES" :key="ex.id" :class="item" @click="loadExample(ex.id)">{{ ex.label }}</button>
      </div>
    </div>

    <div class="relative">
      <button :class="btn" @click="toggleMenu('file')"><FileDown :size="16" /> Fichier <ChevronDown :size="14" /></button>
      <div v-if="menu === 'file'" :class="[panel, 'w-60']">
        <button :class="item" @click="run(exportJson)"><FileJson :size="15" /> Exporter le projet (JSON)</button>
        <button :class="item" @click="run(() => fileInput?.click())"><FileUp :size="15" /> Importer un projet…</button>
        <hr class="my-1 border-slate-200" />
        <button :class="item" @click="run(() => exportImage('png'))"><Image :size="15" /> Image PNG</button>
        <button :class="item" @click="run(() => exportImage('svg'))"><Image :size="15" /> Image SVG</button>
      </div>
      <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onFile" />
    </div>

    <button :class="btn" :title="isDark ? 'Thème clair' : 'Thème sombre'" @click="toggleTheme">
      <component :is="isDark ? Sun : Moon" :size="16" />
    </button>
    <button v-if="store.view === 'mcd'" :class="btn" @click="reset"><RotateCcw :size="16" /> Réinitialiser</button>
    <button class="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="store.showSqlModal = true">
      <Code2 :size="16" /> Exporter SQL
    </button>
  </div>
</template>
