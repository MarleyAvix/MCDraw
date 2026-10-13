<script setup lang="ts">
import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import BaseModal from '../../components/modals/BaseModal.vue'
import { getDocumentType } from '../../core/documentType'
import type { ApiDocument } from '../api/model'
import { seqFromEndpoint } from './fromApi'
import { useSequenceStore } from './sequenceStore'

// Les routes viennent de l'onglet « API REST » ; on part de celle qui y est sélectionnée.
const store = useSequenceStore()
const apiDoc = getDocumentType('api')?.useDocument()
const api = (apiDoc?.schema.value ?? { info: {}, resources: [], endpoints: [] }) as ApiDocument
const routes = api.endpoints
const picked = apiDoc?.selection.value[0]
const first = routes.find((e) => e.path === picked) ?? routes.find((e) => picked && e.path.startsWith(`${picked}/`)) ?? routes[0]
const routeId = ref(first?.id ?? '')
const database = ref(true)

const label = (e: (typeof routes)[number]) => `${e.method} ${e.path}${e.summary ? ` — ${e.summary}` : ''}`
const close = () => (store.showApiModal = false)

function generate() {
  const route = routes.find((e) => e.id === routeId.value)
  if (!route) return
  if (store.doc.items.length && !confirm('Remplacer le diagramme actuel par celui de cette route ? (Ctrl+Z pour annuler)')) return
  store.load(seqFromEndpoint(api, route, { database: database.value }, () => Math.random().toString(36).slice(2, 10)))
  store.selection = []
  close()
  setTimeout(() => void useVueFlow('seq-diagram').fitView({ padding: 0.28, duration: 300 }), 80)
}

const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
</script>

<template>
  <BaseModal title="Diagramme d’une route de l’API" @close="close">
    <p v-if="!routes.length" class="text-sm text-slate-600">L'API ne décrit encore aucune route : ouvrez l'onglet « API REST » et ajoutez-en, puis revenez ici.</p>
    <template v-else>
      <label class="block text-sm font-medium">
        Route
        <select v-model="routeId" autofocus :class="field" aria-label="Route à représenter">
          <option v-for="e in routes" :key="e.id" :value="e.id">{{ label(e) }}</option>
        </select>
      </label>
      <label class="mt-4 inline-flex items-center gap-2 text-sm"><input v-model="database" type="checkbox" /> Montrer la base de données</label>
      <p class="mt-3 text-xs text-slate-500">
        Le client appelle l'API, qui vérifie l'authentification si la route en exige une, interroge la base, puis répond : chaque réponse déclarée devient une section d'un bloc <code>alt</code>.
      </p>
    </template>

    <template #footer>
      <span />
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="!routes.length" @click="generate">Générer</button>
      </div>
    </template>
  </BaseModal>
</template>
