<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { AlertTriangle, CheckCircle2, FilePlus2, FileUp, Wand2 } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import BaseModal from '../modals/BaseModal.vue'
import { sqlToMcd } from '../../engine/sqlToMcd'
import { layoutMcd } from '../../engine/textToMcd'

const store = useSchemaStore()
const { fitView } = useVueFlow('mcdraw')

const sql = ref('')
const fileInput = ref<HTMLInputElement>()
const uid = () => Math.random().toString(36).slice(2, 10)

const result = computed(() => (sql.value.trim() ? sqlToMcd(sql.value, uid) : null))
const counts = computed(() => {
  const s = result.value?.schema
  return s ? `${s.entities.length} entité(s), ${s.relations.length} association(s)` : ''
})
const canApply = computed(() => !!result.value && result.value.schema.entities.length > 0)

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) sql.value = await file.text()
  input.value = ''
}

/** Remplace le MCD (annulable par Ctrl+Z) ou place le schéma lu à droite de l'existant. */
function apply(mode: 'replace' | 'append') {
  if (!result.value || !canApply.value) return
  const fresh = result.value.schema
  if (mode === 'replace') {
    store.importSchema(layoutMcd(fresh))
  } else {
    const right = Math.max(0, ...[...store.entities, ...store.relations].map((n) => n.x + 200))
    const added = layoutMcd(fresh, { x: store.entities.length || store.relations.length ? right + 80 : 0, y: 0 })
    const s = store.schema
    store.importSchema({
      entities: [...s.entities, ...added.entities],
      relations: [...s.relations, ...added.relations],
      links: [...s.links, ...added.links],
    })
  }
  store.view = 'mcd'
  store.showSqlImportModal = false
  setTimeout(() => fitView({ padding: 0.2 }), 50)
}
</script>

<template>
  <BaseModal title="Importer du SQL" wide @close="store.showSqlImportModal = false">
    <p class="mb-2 text-sm text-slate-500">
      Collez des <code>CREATE TABLE</code> (MySQL, PostgreSQL, SQL Server, SQLite…) : MCDraw en déduit entités, associations et cardinalités.
    </p>
    <textarea
      v-model="sql"
      autofocus
      spellcheck="false"
      wrap="off"
      rows="14"
      class="w-full resize-y rounded-md border border-slate-300 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500"
      aria-label="Script SQL à importer"
      placeholder="CREATE TABLE client (id INT PRIMARY KEY, nom VARCHAR(100));&#10;CREATE TABLE commande (&#10;  id INT PRIMARY KEY,&#10;  client_id INT NOT NULL REFERENCES client(id)&#10;);"
    />
    <ul v-if="result?.warnings.length" class="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <li v-for="(w, i) in result.warnings" :key="i" class="flex gap-1.5">
        <AlertTriangle :size="13" class="mt-0.5 shrink-0" /> <span>{{ w }}</span>
      </li>
    </ul>
    <p v-if="result && canApply" class="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ counts }}
    </p>
    <p class="mt-3 text-xs text-slate-400">
      Les cardinalités sont déduites : clé étrangère obligatoire → 1,1, facultative → 0,1 ; côté référencé 0,n ; table de jointure → 0,n de chaque côté. À affiner ensuite.
    </p>

    <template #footer>
      <div class="flex items-center gap-2">
        <button class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100" @click="fileInput?.click()">
          <FileUp :size="14" /> Ouvrir un .sql
        </button>
        <input ref="fileInput" type="file" accept=".sql,.txt,text/plain" class="hidden" @change="onFile" />
      </div>
      <div class="flex items-center gap-2">
        <button
          class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canApply"
          title="Ajoute ce schéma à droite du MCD actuel"
          @click="apply('append')"
        >
          <FilePlus2 :size="14" /> Ajouter
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canApply"
          title="Remplace le MCD actuel (Ctrl+Z pour annuler)"
          @click="apply('replace')"
        >
          <Wand2 :size="14" /> Remplacer le MCD
        </button>
      </div>
    </template>
  </BaseModal>
</template>
