<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AlertTriangle, Check, Copy } from 'lucide-vue-next'
import { useDocumentStore } from '../../core/documentStore'
import { useActiveDocument } from '../../core/useActiveDocument'
import BaseModal from '../modals/BaseModal.vue'
import { buildShareUrl, SHARE_SOFT_LIMIT } from '../../engine/shareLink'

const store = useDocumentStore()
const { type, doc } = useActiveDocument()
const url = ref('')
const copied = ref(false)
const input = ref<HTMLInputElement>()

onMounted(async () => {
  url.value = await buildShareUrl(doc.value.schema.value, location.origin + location.pathname, type.value.id)
  input.value?.select()
})

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
  } catch {
    input.value?.select()
    document.execCommand('copy')
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <BaseModal title="Partager par lien" @close="store.showShareModal = false">
    <p class="mb-3 text-sm text-slate-600">
      Toute personne ouvrant ce lien obtient une copie du diagramme actuel. Le diagramme est contenu dans le lien lui-même :
      rien n'est stocké sur un serveur, et les modifications ultérieures ne sont pas synchronisées.
    </p>
    <div class="flex gap-2">
      <input
        ref="input"
        :value="url"
        readonly
        autofocus
        class="min-w-0 flex-1 rounded-md border border-slate-300 bg-surface px-3 py-1.5 font-mono text-xs"
        @focus="($event.target as HTMLInputElement).select()"
      />
      <button
        class="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        :disabled="!url"
        @click="copy"
      >
        <component :is="copied ? Check : Copy" :size="16" /> {{ copied ? 'Copié' : 'Copier' }}
      </button>
    </div>
    <p v-if="url.length > SHARE_SOFT_LIMIT" class="mt-3 flex items-start gap-2 text-sm text-amber-600">
      <AlertTriangle :size="16" class="mt-0.5 shrink-0" />
      Lien long ({{ url.length }} caractères) : certaines messageries risquent de le tronquer. Préférez alors « Exporter le projet (JSON) ».
    </p>
  </BaseModal>
</template>
