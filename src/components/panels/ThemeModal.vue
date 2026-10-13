<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { useDocumentStore } from '../../core/documentStore'
import { useAppearance } from '../../composables/useAppearance'
import BaseModal from '../modals/BaseModal.vue'

const store = useDocumentStore()
const { appearance, reset } = useAppearance(store.active.id)

const FALLBACK = { entity: '#b6e3ff', relation: '#fff8c5', edge: '#57606a', text: '#1f2328' }
// Les champs, leurs noms et leurs explications viennent du type affiché : pages, participants, associations…
const fields = store.active.appearance ?? []
</script>

<template>
  <BaseModal :title="`Couleurs — ${store.active.label}`" @close="store.showThemeModal = false">
    <p class="mb-4 text-sm text-slate-600">
      Personnalisez les couleurs de ce type de schéma. Elles s'appliquent à toutes ses vues et aux exports (PNG, SVG, PDF) ; chaque type garde les siennes.
    </p>
    <div class="space-y-3">
      <label v-for="f in fields" :key="f.key" class="flex items-center gap-3">
        <input type="color" :value="appearance[f.key] || FALLBACK[f.key]" class="h-9 w-12 cursor-pointer rounded border border-slate-300 p-0.5"
          @input="appearance[f.key] = ($event.target as HTMLInputElement).value" />
        <span class="flex-1">
          <span class="block text-sm font-medium">{{ f.label }}</span>
          <span class="block text-xs text-slate-500">{{ f.hint }}</span>
        </span>
        <button v-if="appearance[f.key]" type="button" class="text-xs text-slate-500 underline hover:text-slate-700" @click.prevent="appearance[f.key] = ''">défaut</button>
      </label>
    </div>
    <div class="mt-5 flex justify-between">
      <button class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" @click="reset">
        <RotateCcw :size="14" /> Tout réinitialiser
      </button>
      <button class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="store.showThemeModal = false">Fermer</button>
    </div>
  </BaseModal>
</template>
