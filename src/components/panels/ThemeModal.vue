<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { useAppearance, type Appearance } from '../../composables/useAppearance'
import BaseModal from '../modals/BaseModal.vue'

const store = useSchemaStore()
const { appearance, reset } = useAppearance()

const FIELDS: { key: keyof Appearance; label: string; hint: string; fallback: string }[] = [
  { key: 'entity', label: 'Entités', hint: 'En-tête des entités, tables et classes', fallback: '#b6e3ff' },
  { key: 'relation', label: 'Associations', hint: 'Fond des associations', fallback: '#fff8c5' },
  { key: 'edge', label: 'Liens', hint: 'Pattes et traits de liaison', fallback: '#57606a' },
]
</script>

<template>
  <BaseModal title="Thème du diagramme" @close="store.showThemeModal = false">
    <p class="mb-4 text-sm text-slate-600">
      Personnalisez les couleurs du diagramme. Elles s'appliquent à toutes les vues et aux exports (PNG, SVG, PDF).
    </p>
    <div class="space-y-3">
      <label v-for="f in FIELDS" :key="f.key" class="flex items-center gap-3">
        <input type="color" :value="appearance[f.key] || f.fallback" class="h-9 w-12 cursor-pointer rounded border border-slate-300 p-0.5"
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
