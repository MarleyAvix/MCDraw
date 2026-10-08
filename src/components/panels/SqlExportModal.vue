<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { Check, Copy, Dices, Download } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import BaseModal from '../modals/BaseModal.vue'
import { DIALECT_LABELS, SQL_DIALECTS } from '../../engine/mldToSql'
import { EF_DEFAULTS, mldToEfCore } from '../../engine/mldToEfCore'
import { mldToPrisma, PRISMA_VERSIONS, type PrismaVersion } from '../../engine/mldToPrisma'
import { mldToTypeOrm } from '../../engine/mldToTypeOrm'
import { diagramToText, LANGUAGE_LABELS, NOTATION_LABELS, type DiagramLanguage, type DiagramNotation } from '../../engine/diagramToText'
import { downloadBlob } from '../../composables/useFileIO'

const store = useSchemaStore()
const copied = ref(false)
const tab = ref<'sql' | 'efcore' | 'prisma' | 'typeorm' | 'seed' | 'diagram'>('sql')
const diagram = ref({ language: 'mermaid' as DiagramLanguage, notation: 'erd' as DiagramNotation, fence: true })
const ef = ref({ ...EF_DEFAULTS })
const prismaVersion = ref<PrismaVersion>('7')

// Données fictives : script INSERT direct, classe C# (Bogus) ou script Node (Faker).
const SEED_FORMATS = {
  sql: { label: 'SQL INSERT', file: 'seed.sql' },
  csharp: { label: 'C# — Bogus (DbInitializer)', file: 'DbInitializer.cs' },
  faker: { label: 'JavaScript — Faker', file: 'seed.mjs' },
} as const
const seed = ref({ rows: 10, seed: 42, format: 'sql' as keyof typeof SEED_FORMATS })
// Plafond à 100 : au-delà, la génération + la coloration du script font ramer le modal (voir ROADMAP).
const SEED_MAX_ROWS = 100
const SEED_ROW_PRESETS = [10, 25, 50, 100]
const clampRows = (n: number) => Math.min(Math.max(Math.floor(n) || 1, 1), SEED_MAX_ROWS)
const seedRows = computed(() => clampRows(seed.value.rows))
// Le champ est corrigé dès la saisie : la valeur affichée est toujours celle réellement générée.
watch(
  () => seed.value.rows,
  (n) => {
    const c = clampRows(n)
    if (c !== n) seed.value.rows = c
  },
)
const reroll = () => (seed.value.seed = Math.floor(Math.random() * 100000))
const lang = computed(() =>
  tab.value === 'diagram'
    ? diagram.value.language
    : tab.value === 'efcore' || (tab.value === 'seed' && seed.value.format === 'csharp')
    ? 'cs'
    : tab.value === 'prisma'
      ? 'prisma'
      : tab.value === 'typeorm'
        ? 'ts'
        : tab.value === 'seed' && seed.value.format === 'faker'
          ? 'js'
          : 'sql',
)

// Faker est volumineux : il n'est chargé qu'à la première ouverture de l'onglet.
const seedLib = shallowRef<{ data: typeof import('../../engine/mldToSeed'); scripts: typeof import('../../engine/seedScripts') } | null>(null)
watch(
  tab,
  async (t) => {
    if (t !== 'seed' || seedLib.value) return
    const [data, scripts] = await Promise.all([import('../../engine/mldToSeed'), import('../../engine/seedScripts')])
    seedLib.value = { data, scripts }
  },
  { immediate: true },
)

function seedCode(): string {
  if (!seedLib.value) return '-- Chargement du générateur de données…'
  const { data, scripts } = seedLib.value
  const opts = { rows: seedRows.value, seed: seed.value.seed }
  const { dialect, autoIncrement } = store.sqlOptions
  if (seed.value.format === 'csharp') return scripts.seedToBogus(store.mld, opts, ef.value)
  if (seed.value.format === 'faker') return scripts.seedToFaker(store.mld, opts, { dialect, autoIncrement })
  return data.seedToSql(data.seedData(data.planSeed(store.mld, opts), opts), { dialect, autoIncrement })
}

// Tables qui auront moins de lignes que demandé (relation 1-1, table d'association limitée par ses parents).
const reducedTables = computed(() => {
  if (tab.value !== 'seed' || !seedLib.value) return []
  const plan = seedLib.value.data.planSeed(store.mld, { rows: seedRows.value, seed: seed.value.seed })
  return plan.tables.filter((t) => t.count < seedRows.value).map((t) => `${t.table.name} (${t.count})`)
})

const code = computed(() => {
  switch (tab.value) {
    case 'sql':
      return store.sql
    case 'efcore':
      return mldToEfCore(store.mld, ef.value)
    case 'prisma':
      return mldToPrisma(store.mld, { ...store.sqlOptions, version: prismaVersion.value })
    case 'typeorm':
      return mldToTypeOrm(store.mld, store.sqlOptions)
    case 'diagram':
      return diagramToText(store.schema, diagram.value)
    default:
      return seedCode()
  }
})

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Coloration basique. Groupes : 1 commentaire, 2 mot-clé, 3 type, 4 nombre, 5 chaîne, 6 identifiant délimité
// (reconnu pour qu'un mot réservé entre délimiteurs, ex. `order`, ne soit pas coloré comme un mot-clé).
const SQL_TOKEN =
  /(--[^\n]*)|\b(CREATE|TABLE|INDEX|PRIMARY|FOREIGN|KEY|REFERENCES|NOT|NULL|CONSTRAINT|ALTER|ADD|UNIQUE|CHECK|DEFAULT|ON|DELETE|UPDATE|CASCADE|SET|RESTRICT|NO|ACTION|WHERE|IS|AND|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|GENERATED|ALWAYS|AS|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE)\b|\b(INT|INTEGER|VARCHAR|NVARCHAR|TEXT|DECIMAL|NUMERIC|FLOAT|REAL|DOUBLE PRECISION|BOOLEAN|BIT|DATE|DATETIME|DATETIME2|TIMESTAMP|SERIAL|MAX)\b|\b(\d+)\b|('(?:[^'\n]|'')*')|("[^"\n]*"|`[^`\n]*`|\[[^\]\n]*\])/g
const CS_TOKEN =
  /(\/\/[^\n]*)|\b(using|namespace|public|static|class|protected|override|void|get|set|new|null|return|var|if|for|from|select)\b|\b(int|string|decimal|double|bool|DateTime|ICollection|List|DbSet|DbContext|DbContextOptions|ModelBuilder|DeleteBehavior|Faker|Randomizer|Math)\b|\b(\d+)\b|("[^"\n]*")/g
const JS_TOKEN =
  /(\/\/[^\n]*)|\b(import|from|const|let|for|of|return|null|true|false|new)\b|\b(faker|Math|Array|String|console)\b|\b(\d+)\b|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g
const TS_TOKEN =
  /(\/\/[^\n]*)|(@[A-Za-z]+|\b(?:import|from|export|class|new|null)\b)|\b(string|number|boolean|Date|Relation)\b|\b(\d+)\b|('(?:[^'\\\n]|\\.)*')/g
const PRISMA_TOKEN =
  /(\/\/[^\n]*)|(@@?[A-Za-z]+(?:\.[A-Za-z]+)?|\b(?:model|generator|datasource|provider|url|env)\b)|\b(Int|String|Boolean|DateTime|Decimal|Float)\b|\b(\d+)\b|("(?:[^"\\\n]|\\.)*")/g
const MERMAID_TOKEN =
  /(%%[^\n]*)|\b(erDiagram|classDiagram|class)\b|\b(INT|VARCHAR|TEXT|DECIMAL|FLOAT|BOOLEAN|DATE|DATETIME|PK)\b|\b(\d+)\b|("[^"\n]*")/g
const PLANTUML_TOKEN =
  /('[^\n]*)|(@startuml|@enduml|\b(?:entity|class|diamond|hide|circle|as)\b)|\b(INT|VARCHAR|TEXT|DECIMAL|FLOAT|BOOLEAN|DATE|DATETIME)\b|\b(\d+)\b|("[^"\n]*")/g
const TOKEN_CLASS =['', 'text-slate-500 italic', 'text-indigo-300 font-semibold', 'text-emerald-300', 'text-amber-300', 'text-sky-300', '']

const highlighted = computed(() => {
  const src = code.value
  const re = { mermaid: MERMAID_TOKEN, plantuml: PLANTUML_TOKEN, sql: SQL_TOKEN, js: JS_TOKEN, ts: TS_TOKEN, prisma: PRISMA_TOKEN, cs: CS_TOKEN }[lang.value]
  let out = ''
  let last = 0
  for (const m of src.matchAll(re)) {
    out += escapeHtml(src.slice(last, m.index))
    const cls = TOKEN_CLASS[m.findIndex((g, i) => i > 0 && g !== undefined)]
    out += cls ? `<span class="${cls}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0])
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

const fileName = computed(() => {
  switch (tab.value) {
    case 'sql':
      return 'mcdraw.sql'
    case 'efcore':
      return `${ef.value.contextName}.cs`
    case 'prisma':
      return 'schema.prisma'
    case 'typeorm':
      return 'entities.ts'
    case 'diagram':
      return diagram.value.fence ? 'diagramme.md' : diagram.value.language === 'mermaid' ? 'diagramme.mmd' : 'diagramme.puml'
    default:
      return SEED_FORMATS[seed.value.format].file
  }
})
const download = () => downloadBlob(code.value, 'text/plain', fileName.value)

const tabClass = (t: string) =>
  `px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${tab.value === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`
const field = 'rounded border border-slate-300 px-2 py-1'
</script>

<template>
  <BaseModal title="Export du MLD" wide @close="store.showSqlModal = false">
    <div class="mb-4 flex border-b border-slate-200">
      <button :class="tabClass('sql')" @click="tab = 'sql'">SQL (DDL)</button>
      <button :class="tabClass('efcore')" @click="tab = 'efcore'">C# — EF Core DbContext</button>
      <button :class="tabClass('prisma')" @click="tab = 'prisma'">Prisma</button>
      <button :class="tabClass('typeorm')" @click="tab = 'typeorm'">TypeORM</button>
      <button :class="tabClass('seed')" @click="tab = 'seed'">Données fictives</button>
      <button :class="tabClass('diagram')" @click="tab = 'diagram'">Mermaid / PlantUML</button>
    </div>

    <div v-if="tab !== 'diagram' && tab !== 'efcore' && (tab !== 'seed' || seed.format !== 'csharp')" class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <label v-if="tab === 'seed'" class="flex items-center gap-2">
        Format
        <select v-model="seed.format" :class="field">
          <option v-for="(f, k) in SEED_FORMATS" :key="k" :value="k">{{ f.label }}</option>
        </select>
      </label>
      <label v-if="tab === 'prisma'" class="flex items-center gap-2">
        Version
        <select v-model="prismaVersion" :class="field">
          <option v-for="(label, v) in PRISMA_VERSIONS" :key="v" :value="v">{{ label }}</option>
        </select>
      </label>
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
    <div v-else-if="tab === 'diagram'" class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <label class="flex items-center gap-2">
        Langage
        <select v-model="diagram.language" :class="field">
          <option v-for="(label, l) in LANGUAGE_LABELS" :key="l" :value="l">{{ label }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        Notation
        <select v-model="diagram.notation" :class="field">
          <option v-for="(label, n) in NOTATION_LABELS" :key="n" :value="n">{{ label }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <input v-model="diagram.fence" type="checkbox" /> Bloc de code Markdown (README, GitHub, wiki)
      </label>
    </div>
    <div v-else class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <label v-if="tab === 'seed'" class="flex items-center gap-2">
        Format
        <select v-model="seed.format" :class="field">
          <option v-for="(f, k) in SEED_FORMATS" :key="k" :value="k">{{ f.label }}</option>
        </select>
      </label>
      <label class="flex items-center gap-2">Namespace <input v-model="ef.namespace" :class="[field, 'w-44']" /></label>
      <label class="flex items-center gap-2">Contexte <input v-model="ef.contextName" :class="[field, 'w-40']" /></label>
    </div>

    <div v-if="tab === 'seed'" class="mb-3 flex flex-wrap items-center gap-4 text-sm">
      <label class="flex items-center gap-2">
        Lignes par table <input v-model.number="seed.rows" type="number" min="1" :max="SEED_MAX_ROWS" :class="[field, 'w-20']" />
      </label>
      <div class="flex items-center gap-1" role="group" aria-label="Nombre de lignes">
        <button
          v-for="n in SEED_ROW_PRESETS"
          :key="n"
          class="rounded px-2 py-1 text-xs hover:bg-slate-100"
          :class="seedRows === n ? 'bg-slate-200 font-semibold' : ''"
          @click="seed.rows = n"
        >{{ n }}</button>
      </div>
      <label class="flex items-center gap-2">
        Graine <input v-model.number="seed.seed" type="number" :class="[field, 'w-24']" />
        <button class="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100" title="Tirer d'autres données" @click="reroll"><Dices :size="14" /> Autres données</button>
      </label>
    </div>
    <p v-if="tab === 'seed' && reducedTables.length" class="mb-3 text-xs text-amber-600">
      Moins de {{ seedRows }} lignes pour : {{ reducedTables.join(', ') }} — limité par une relation 1-1 ou par le nombre de combinaisons possibles.
    </p>

    <pre class="overflow-x-auto rounded-md bg-[#0d1117] p-4 font-mono text-xs leading-relaxed text-[#e2e8f0]" v-html="highlighted" />
    <template #footer>
      <button class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm hover:bg-slate-100" @click="download">
        <Download :size="14" /> Télécharger {{ fileName }}
      </button>
      <button class="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="copy">
        <component :is="copied ? Check : Copy" :size="14" /> {{ copied ? 'Copié !' : 'Copier' }}
      </button>
    </template>
  </BaseModal>
</template>
