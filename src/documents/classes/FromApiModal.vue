<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import BaseModal from '../../components/modals/BaseModal.vue'
import { getDocumentType } from '../../core/documentType'
import type { ApiDocument } from '../api/model'
import { classesFromApi } from './fromApi'
import { useClassStore } from './classStore'

// Les ressources viennent de l'onglet « API REST » ; elles sont toutes cochées au départ.
const store = useClassStore()
const apiDoc = getDocumentType('api')?.useDocument()
const api = (apiDoc?.schema.value ?? { info: {}, resources: [], endpoints: [] }) as ApiDocument
const resources = api.resources
const checked = ref(new Set(resources.map((r) => r.name)))

const toggle = (name: string) => {
  const next = new Set(checked.value)
  if (!next.delete(name)) next.add(name)
  checked.value = next
}
const preview = computed(() => classesFromApi(api, { only: [...checked.value] }))
const close = () => (store.showApiModal = false)

function generate() {
  if (!preview.value.classes.length) return
  if (store.doc.classes.length && !confirm('Remplacer le diagramme actuel par celui de l’API ? (Ctrl+Z pour annuler)')) return
  store.load(preview.value)
  store.selection = []
  close()
  setTimeout(() => void useVueFlow('class-diagram').fitView({ padding: 0.28, duration: 300 }), 80)
}
</script>

<template>
  <BaseModal title="Diagramme de classes de l’API" @close="close">
    <p v-if="!resources.length" class="text-sm text-slate-600">L'API ne décrit encore aucune ressource : ouvrez l'onglet « API REST », ajoutez-en dans la vue « Schémas », puis revenez ici.</p>
    <template v-else>
      <fieldset>
        <legend class="text-sm font-medium">Ressources à représenter</legend>
        <div class="mt-2 grid gap-1 sm:grid-cols-2">
          <label v-for="r in resources" :key="r.name" class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" :checked="checked.has(r.name)" :aria-label="`Ressource ${r.name}`" @change="toggle(r.name)" /> {{ r.name }}
          </label>
        </div>
      </fieldset>
      <p class="mt-3 text-xs text-slate-500">
        Chaque ressource devient une classe. Un champ qui cite une autre ressource devient une association (multiplicité selon <code>[]</code> et le caractère facultatif) ; une énumération devient une classe « énumération ».
      </p>
      <p class="mt-2 text-xs text-slate-500" aria-live="polite">{{ preview.classes.length }} classe(s), {{ preview.relations.length }} relation(s)</p>
    </template>

    <template #footer>
      <span />
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="!preview.classes.length" @click="generate">Générer</button>
      </div>
    </template>
  </BaseModal>
</template>
