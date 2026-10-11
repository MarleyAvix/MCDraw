<script setup lang="ts">
import { ref } from 'vue'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useApiStore } from './apiStore'
import type { ApiInfo, AuthScheme } from './model'

const store = useApiStore()
const info = store.doc.info

// Copie de travail : validée uniquement à l'enregistrement.
const title = ref(info.title ?? '')
const version = ref(info.version ?? '')
const description = ref(info.description ?? '')
const server = ref(info.server ?? '')
const auth = ref<AuthScheme | ''>(info.auth ?? '')

const close = () => (store.showInfoModal = false)
function save() {
  const next: ApiInfo = {}
  if (title.value.trim()) next.title = title.value.trim()
  if (version.value.trim()) next.version = version.value.trim()
  if (description.value.trim()) next.description = description.value.trim()
  if (server.value.trim()) next.server = server.value.trim()
  if (auth.value) next.auth = auth.value
  store.setInfo(next)
  close()
}
const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
</script>

<template>
  <BaseModal title="Informations sur l'API" @close="close">
    <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
      <label class="text-sm font-medium">
        Titre
        <input v-model="title" autofocus :class="field" placeholder="API Boutique" @keydown.enter="save" />
      </label>
      <label class="text-sm font-medium">
        Version
        <input v-model="version" :class="[field, 'font-mono']" placeholder="1.0.0" @keydown.enter="save" />
      </label>
    </div>
    <label class="mt-4 block text-sm font-medium">
      Adresse du serveur
      <input v-model="server" :class="[field, 'font-mono text-sm']" placeholder="https://api.exemple.fr" @keydown.enter="save" />
    </label>
    <label class="mt-4 block text-sm font-medium">
      Description
      <textarea v-model="description" rows="3" :class="field" placeholder="À quoi sert cette API ?" />
    </label>
    <label class="mt-4 block text-sm font-medium">
      Authentification
      <select v-model="auth" :class="field">
        <option value="">Aucune</option>
        <option value="bearer">Jeton Bearer (JWT)</option>
        <option value="apiKey">Clé d'API (en-tête X-API-Key)</option>
        <option value="basic">Basic (identifiant et mot de passe)</option>
      </select>
      <span class="mt-1 block text-xs font-normal text-slate-500">Les routes marquées « authentification requise » utilisent ce mécanisme.</span>
    </label>

    <template #footer>
      <span />
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
