<script setup lang="ts">
import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useSpawnPoint } from '../../composables/useSpawnPoint'
import {
  Square, Circle, Code2, RotateCcw, BookOpen, ChevronDown, Sun, Moon,
  Undo2, Redo2, LayoutGrid, FileDown, FileUp, Image, FileJson, TextCursorInput, DatabaseZap, Link2,
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

const EXAMPLE_GROUPS = [
  { category: 'modele', title: 'Modèles de départ' },
  { category: 'exemple', title: 'Petits exemples' },
].map((g) => ({ ...g, items: EXAMPLES.filter((e) => e.category === g.category) }))

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

const VIEW_TITLES = {
  mcd: 'Modèle conceptuel (édition)',
  mld: 'Modèle logique : tables et clés étrangères',
  erd: 'Diagramme entité-relation (notation pattes de corbeau)',
  uml: 'Diagramme de classes UML',
} as const

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface'
const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100'
const panel = 'absolute left-0 top-full z-40 mt-1 rounded-md border border-slate-200 bg-surface py-1 shadow-lg'
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="inline-flex overflow-hidden rounded-md border border-slate-300" role="tablist" aria-label="Vue">
      <button
        v-for="v in (['mcd', 'mld', 'erd', 'uml'] as const)"
        :key="v"
        role="tab"
        :aria-selected="store.view === v"
        class="px-3 py-1.5 text-sm font-semibold uppercase"
        :class="store.view === v ? 'bg-indigo-600 text-white' : 'bg-surface hover:bg-slate-100'"
        :title="VIEW_TITLES[v]"
        @click="store.view = v"
      >
        {{ v }}
      </button>
    </div>

    <span class="mx-1 h-6 w-px bg-slate-200" />

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

    <span class="mx-1 h-6 w-px bg-slate-200" />

    <div v-if="store.view === 'mcd'" class="relative">
      <button :class="btn" @click="toggleMenu('examples')"><BookOpen :size="16" /> Exemples <ChevronDown :size="14" /></button>
      <div v-if="menu === 'examples'" :class="[panel, 'max-h-[75vh] w-80 overflow-y-auto']">
        <template v-for="group in EXAMPLE_GROUPS" :key="group.category">
          <p class="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{{ group.title }}</p>
          <button v-for="ex in group.items" :key="ex.id" :class="[item, 'flex-col !items-start gap-0']" @click="loadExample(ex.id)">
            <span>{{ ex.label }}</span>
            <span v-if="ex.description" class="text-xs font-normal text-slate-500">{{ ex.description }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="relative">
      <button :class="btn" @click="toggleMenu('file')"><FileDown :size="16" /> Fichier <ChevronDown :size="14" /></button>
      <div v-if="menu === 'file'" :class="[panel, 'w-60']">
        <button :class="item" @click="run(exportJson)"><FileJson :size="15" /> Exporter le projet (JSON)</button>
        <button :class="item" @click="run(() => fileInput?.click())"><FileUp :size="15" /> Importer un projet…</button>
        <button :class="item" @click="run(() => (store.showSqlImportModal = true))"><DatabaseZap :size="15" /> Importer du SQL (CREATE TABLE)…</button>
        <button :class="item" @click="run(() => (store.showShareModal = true))"><Link2 :size="15" /> Partager par lien…</button>
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
    <button :class="btn" title="Reconstruire un MCD à partir de CREATE TABLE" @click="store.showSqlImportModal = true"><DatabaseZap :size="16" /> Importer SQL</button>
    <button class="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="store.showSqlModal = true">
      <Code2 :size="16" /> Exporter SQL
    </button>
  </div>
</template>
