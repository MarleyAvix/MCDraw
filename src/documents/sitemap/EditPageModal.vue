<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useSitemapStore } from './sitemapStore'

const store = useSitemapStore()
const page = computed(() => store.pages.find((p) => p.id === store.editingPageId))

const title = ref(page.value?.title ?? '')
const url = ref(page.value?.url ?? '')
const note = ref(page.value?.note ?? '')
const subCount = computed(() => (page.value ? store.childrenOf(page.value.id).length : 0))

const close = () => (store.editingPageId = null)
function save() {
  if (page.value) store.updatePage(page.value.id, { title: title.value.trim() || page.value.title, url: url.value, note: note.value })
  close()
}
function remove() {
  if (page.value) store.removePages([page.value.id])
}
const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
</script>

<template>
  <BaseModal v-if="page" title="Modifier la page" @close="close">
    <label class="mb-4 block text-sm font-medium">
      Titre de la page
      <input v-model="title" autofocus :class="field" @keydown.enter="save" />
    </label>
    <label class="mb-4 block text-sm font-medium">
      Adresse
      <input v-model="url" :class="[field, 'font-mono text-sm']" placeholder="/produits" @keydown.enter="save" />
      <span class="mt-1 block text-xs font-normal text-slate-500">Un chemin (/produits) ou une adresse complète. Sans adresse, la page n'apparaît pas dans le sitemap.xml.</span>
    </label>
    <label class="block text-sm font-medium">
      Note
      <textarea v-model="note" rows="3" :class="field" placeholder="À relire, contenu à fournir…" />
    </label>

    <template #footer>
      <button class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove">
        <Trash2 :size="15" /> Supprimer<template v-if="subCount"> (et {{ subCount }} sous-page{{ subCount > 1 ? 's' : '' }})</template>
      </button>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
