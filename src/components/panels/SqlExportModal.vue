<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy, Download } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import BaseModal from '../modals/BaseModal.vue'
import { DIALECT_LABELS, SQL_DIALECTS } from '../../engine/mldToSql'
import { EF_DEFAULTS, mldToEfCore } from '../../engine/mldToEfCore'

const store = useSchemaStore()
const copied = ref(false)
const tab = ref<'sql' | 'efcore'>('sql')
const ef = ref({ ...EF_DEFAULTS })

const code = computed(() => (tab.value === 'sql' ? store.sql : mldToEfCore(store.mld, ef.value)))

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Coloration basique : commentaires, mots-clés, types, nombres.
const SQL_TOKEN =
  /(--[^\n]*)|\b(CREATE|TABLE|PRIMARY|FOREIGN|KEY|REFERENCES|NOT|NULL|CONSTRAINT|ALTER|ADD|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|GENERATED|ALWAYS|AS)\b|\b(INT|INTEGER|VARCHAR|NVARCHAR|TEXT|DECIMAL|NUMERIC|FLOAT|REAL|DOUBLE PRECISION|BOOLEAN|BIT|DATE|DATETIME|DATETIME2|TIMESTAMP|SERIAL|MAX)\b|\b(\d+)\b/g
const CS_TOKEN =
  /(\/\/[^\n]*)|\b(using|namespace|public|class|protected|override|void|get|set|new|null|return|var)\b|\b(int|string|decimal|double|bool|DateTime|ICollection|List|DbSet|DbContext|DbContextOptions|ModelBuilder|DeleteBehavior)\b|\b(\d+)\b|("[^"\n]*")/g

const highlighted = computed(() => {
  const src = code.value
  const re = tab.value === 'sql' ? SQL_TOKEN : CS_TOKEN
  let out = ''
  let last = 0
  for (const m of src.matchAll(re)) {
    out += escapeHtml(src.slice(last, m.index))
    const cls = m[1]
      ? 'text-slate-500 italic'
      : m[2]
        ? 'text-indigo-300 font-semibold'
        : m[3]
          ? 'text-emerald-300'
          : m[5]
            ? 'text-sky-300'
            : 'text-amber-300'
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`
    last = m.index! + m[0].length
  }
  return out + escapeHtml(src.slice(last))
})

async function copy() {
  try {
    await navigator.clipboard.writeText(code.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    /* presse-papiers refusé */
  }
}

function download() {
  const isSql = tab.value === 'sql'
  const url = URL.createObjectURL(new Blob([code.value], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: isSql ? 'mcdraw.sql' : `${ef.value.contextName}.cs` })
  a.click()
  URL.revokeObjectURL(url)
}

const tabClass = (t: string) =>
  `px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${tab.value === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`
const field = 'rounded border border-slate-300 px-2 py-1'
</script>

<template>
  <BaseModal title="Export du MLD" wide @close="store.showSqlModal = false">
    <div class="mb-4 flex border-b border-slate-200">
      <button :class="tabClass('sql')" @click="tab = 'sql'">SQL (DDL)</button>
      <button :class="tabClass('efcore')" @click="tab = 'efcore'">C# — EF Core DbContext</button>
    </div>

    <div v-if="tab === 'sql'" class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <label class="flex items-center gap-2">
        Dialecte
        <select v-model="store.sqlOptions.dialect" :class="field">
          <option v-for="d in SQL_DIALECTS" :key="d" :value="d">{{ DIALECT_LABELS[d] }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <input v-model="store.sqlOptions.autoIncrement" type="checkbox" /> Clés primaires auto-incrémentées
      </label>
    </div>
    <div v-else class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <label class="flex items-center gap-2">Namespace <input v-model="ef.namespace" :class="[field, 'w-44']" /></label>
      <label class="flex items-center gap-2">Contexte <input v-model="ef.contextName" :class="[field, 'w-40']" /></label>
    </div>

    <pre class="overflow-x-auto rounded-md bg-[#0d1117] p-4 font-mono text-xs leading-relaxed text-[#e2e8f0]" v-html="highlighted" />
    <template #footer>
      <button class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm hover:bg-slate-100" @click="download">
        <Download :size="14" /> Télécharger {{ tab === 'sql' ? '.sql' : '.cs' }}
      </button>
      <button class="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="copy">
        <component :is="copied ? Check : Copy" :size="14" /> {{ copied ? 'Copié !' : 'Copier' }}
      </button>
    </template>
  </BaseModal>
</template>
