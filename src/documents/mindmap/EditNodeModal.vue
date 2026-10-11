<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useMindmapStore } from './mindmapStore'

const store = useMindmapStore()
const node = computed(() => store.nodesList.find((n) => n.id === store.editingNodeId))

const text = ref(node.value?.text ?? '')
const note = ref(node.value?.note ?? '')
const subCount = computed(() => {
  if (!node.value) return 0
  const count = (id: string): number => store.childrenOf(id).reduce((sum, c) => sum + 1 + count(c.id), 0)
  return count(node.value.id)
})

const close = () => (store.editingNodeId = null)
function save() {
  if (node.value) store.updateNode(node.value.id, { text: text.value.trim() || node.value.text, note: note.value })
  close()
}
function remove() {
  if (node.value) store.removeNodes([node.value.id])
}
const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
</script>

<template>
  <BaseModal v-if="node" title="Modifier l'idée" @close="close">
    <label class="mb-4 block text-sm font-medium">
      Idée
      <input v-model="text" autofocus :class="field" @keydown.enter="save" />
    </label>
    <label class="block text-sm font-medium">
      Note
      <textarea v-model="note" rows="4" :class="field" placeholder="Détails, liens, à creuser…" />
    </label>

    <template #footer>
      <button class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove">
        <Trash2 :size="15" /> Supprimer<template v-if="subCount"> (et {{ subCount }} sous-idée{{ subCount > 1 ? 's' : '' }})</template>
      </button>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
