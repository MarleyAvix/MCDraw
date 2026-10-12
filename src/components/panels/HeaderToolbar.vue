<script setup lang="ts">
import { ref } from 'vue'
import {
  BookOpen, ChevronDown, Sun, Moon,
  FileDown, FileUp, Image, FileJson, FileText, Palette, HelpCircle, Link2
} from 'lucide-vue-next'
import { documentTypes } from '../../core/documentType'
import { useDocumentStore } from '../../core/documentStore'
import { useActiveDocument } from '../../core/useActiveDocument'
import { useTheme } from '../../composables/useTheme'
import { useFileIO } from '../../composables/useFileIO'

const store = useDocumentStore()
const { type, doc, view, ctx } = useActiveDocument()
const { isDark, toggle: toggleTheme } = useTheme()
const { exportJson, importJson, exportImage, exportPdf } = useFileIO()

const types = documentTypes()
const exampleGroups = () => type.value.exampleGroups.map((g) => ({ ...g, items: type.value.examples.filter((e) => e.category === g.category) }))
const fileActions = () => (type.value.fileActions ?? []).filter((a) => !a.views || a.views.includes(view.value.id))
const headerActions = () => type.value.headerActions.filter((a) => !a.views || a.views.includes(view.value.id))

const menu = ref<'examples' | 'file' | null>(null)
const fileInput = ref<HTMLInputElement>()
const toggleMenu = (m: 'examples' | 'file') => (menu.value = menu.value === m ? null : m)

function loadExample(id: string) {
  menu.value = null
  doc.value.loadExample(id)
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
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 2xl:gap-4">
    <!-- Type de document (visible dès qu'il y en a plusieurs) -->
    <div v-if="types.length > 1" class="inline-flex overflow-hidden rounded-md border border-slate-300" role="tablist" aria-label="Type de diagramme">
      <button
        v-for="t in types"
        :key="t.id"
        role="tab"
        :aria-selected="store.activeId === t.id"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold"
        :class="store.activeId === t.id ? 'bg-indigo-600 text-white' : 'bg-surface hover:bg-slate-100'"
        @click="store.select(t.id)"
      >
        <component :is="t.icon" :size="15" /> {{ t.label }}
      </button>
    </div>

    <!-- Vues -->
    <div v-if="type.views.length > 1" class="inline-flex overflow-hidden rounded-md border border-slate-300" role="tablist" aria-label="Vue">
      <button
        v-for="v in type.views"
        :key="v.id"
        role="tab"
        :aria-selected="view.id === v.id"
        class="px-3 py-1.5 text-sm font-semibold uppercase"
        :class="view.id === v.id ? 'bg-indigo-600 text-white' : 'bg-surface hover:bg-slate-100'"
        :title="v.title"
        @click="doc.view.value = v.id"
      >
        {{ v.label }}
      </button>
    </div>

    <!-- Séparateur -->
    <span class="hidden h-6 w-px bg-slate-200 md:block" />

    <!-- Outils (Exemples, Fichiers) -->
    <div class="flex items-center gap-2">
      <div v-if="view.editable && type.examples.length" class="relative">
        <button :class="btn" @click="toggleMenu('examples')"><BookOpen :size="16" /> Exemples <ChevronDown :size="14" /></button>
        <div v-if="menu === 'examples'" :class="[panel, 'max-h-[75vh] w-80 overflow-y-auto']">
          <template v-for="group in exampleGroups()" :key="group.category">
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
          <button :class="item" @click="run(() => (store.showShareModal = true))"><Link2 :size="15" /> Partager par lien…</button>
          <hr class="my-1 border-slate-200" />
          <button :class="item" @click="run(() => exportImage('png'))"><Image :size="15" /> Image PNG</button>
          <button :class="item" @click="run(() => exportImage('svg'))"><Image :size="15" /> Image SVG</button>
          <button :class="item" @click="run(exportPdf)"><FileText :size="15" /> PDF / Imprimer…</button>
          <template v-if="fileActions().length">
            <hr class="my-1 border-slate-200" />
            <button v-for="a in fileActions()" :key="a.id" :class="item" :title="a.title" @click="run(() => a.run(ctx()))"><component :is="a.icon" :size="15" /> {{ a.label }}</button>
          </template>
        </div>
        <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onFile" />
      </div>
    </div>

    <!-- Séparateur -->
    <span class="hidden h-6 w-px bg-slate-200 2xl:block" />

    <!-- Actions propres au type de document -->
    <template v-if="headerActions().length">
      <div class="flex items-center gap-2">
        <button
          v-for="a in headerActions()"
          :key="a.id"
          :class="a.primary ? 'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700' : btn"
          :title="a.title"
          :aria-label="a.compact ? a.label : undefined"
          @click="a.run(ctx())"
        >
          <component :is="a.icon" :size="16" /> <span :class="a.compact ? 'hidden 2xl:inline' : ''">{{ a.label }}</span>
        </button>
      </div>

      <!-- Séparateur -->
      <span class="hidden h-6 w-px bg-slate-200 2xl:block" />
    </template>

    <!-- Préférences / App -->
    <div class="flex items-center gap-2">
      <button :class="btn" title="Couleurs du diagramme" @click="store.showThemeModal = true"><Palette :size="16" /></button>
      <button :class="btn" :title="isDark ? 'Thème clair' : 'Thème sombre'" @click="toggleTheme">
        <component :is="isDark ? Sun : Moon" :size="16" />
      </button>
      
      <button :class="btn" title="Raccourcis clavier" @click="store.showShortcutsModal = true">
        <HelpCircle :size="16" />
      </button>
    </div>
  </div>
</template>
