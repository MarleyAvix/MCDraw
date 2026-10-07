<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import type { Attribute } from '../../types/schema'
import BaseModal from './BaseModal.vue'
import AttributeList from './AttributeList.vue'

const store = useSchemaStore()
const entity = computed(() => store.entities.find((e) => e.id === store.editingEntityId))

// Copie de travail : validée uniquement à l'enregistrement.
const name = ref(entity.value?.name ?? '')
const attributes = ref<Attribute[]>(entity.value?.attributes.map((a) => ({ ...a })) ?? [])

const close = () => (store.editingEntityId = null)
function save() {
  if (entity.value) store.updateEntity(entity.value.id, { name: name.value.trim(), attributes: attributes.value })
  close()
}
function remove() {
  if (entity.value) store.removeNode(entity.value.id)
}
</script>

<template>
  <BaseModal v-if="entity" title="Modifier l'entité" wide @close="close">
    <label class="mb-4 block text-sm font-medium">
      Nom de l'entité
      <input v-model="name" autofocus class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" @keydown.enter="save" />
    </label>
    <h3 class="mb-2 text-sm font-medium">Attributs <span class="font-normal text-slate-400">— la clé identifie l'entité (clé primaire)</span></h3>
    <AttributeList v-model="attributes" allow-pk />
    <template #footer>
      <button class="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove">
        <Trash2 :size="14" /> Supprimer
      </button>
      <div class="flex gap-2">
        <button class="rounded px-3 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
