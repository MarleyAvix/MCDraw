<script lang="ts">
import { ref } from 'vue'

const KEY = 'mcdraw.textDraft'
const EXAMPLE = `// Une ligne par entité ou association
Client: #id_client, nom, email
Commande: #id_commande, date_commande:DATE
Produit: #id_produit, libelle, prix:DECIMAL(8,2)

Passer: Client 0,n -- Commande 1,1
Contenir (quantite:INT): Commande 1,n -- Produit 0,n
`
function loadDraft(): string {
  try {
    return localStorage.getItem(KEY) ?? EXAMPLE
  } catch {
    return EXAMPLE
  }
}
// Hors de <script setup> : le brouillon survit à la fermeture du panneau.
const draft = ref(loadDraft())
</script>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { AlertTriangle, CheckCircle2, FilePlus2, RefreshCw, Wand2, X } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { layoutMcd, mcdToText, parseMcdText } from '../../engine/textToMcd'

const store = useSchemaStore()
const { fitView } = useVueFlow('mcdraw')

const uid = () => Math.random().toString(36).slice(2, 10)
const parsed = computed(() => parseMcdText(draft.value, uid))
const counts = computed(() => `${parsed.value.schema.entities.length} entité(s), ${parsed.value.schema.relations.length} association(s)`)
const canApply = computed(() => !parsed.value.errors.length && parsed.value.schema.entities.length > 0)

watch(draft, (v) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* stockage indisponible */
  }
})

/** Remplace le MCD (annulable par Ctrl+Z) ou, en mode ajout, place le nouveau schéma à droite de l'existant. */
function apply(mode: 'replace' | 'append') {
  if (!canApply.value) return
  const fresh = parsed.value.schema
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
  setTimeout(() => fitView({ padding: 0.2 }), 50)
}

function fromMcd() {
  draft.value = mcdToText(store.schema) || EXAMPLE
}

const lineNumber = (n: number) => `L${n}`
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-surface" aria-label="Saisie textuelle du MCD">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Saisie texte</h2>
        <p class="text-xs text-slate-400">Quelques lignes, un MCD.</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer le panneau" @click="store.showTextPanel = false"><X :size="18" /></button>
    </div>

    <textarea
      v-model="draft"
      spellcheck="false"
      wrap="off"
      class="min-h-40 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
      aria-label="Description textuelle du MCD"
      placeholder="Client: #id_client, nom&#10;Commande: #id_commande&#10;Passer: Client 0,n -- Commande 1,1"
    />

    <ul v-if="parsed.errors.length" class="max-h-32 space-y-1 overflow-y-auto border-t border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <li v-for="(e, i) in parsed.errors" :key="i" class="flex gap-1.5">
        <AlertTriangle :size="13" class="mt-0.5 shrink-0" />
        <span><b>{{ lineNumber(e.line) }}</b> · {{ e.message }}</span>
      </li>
    </ul>
    <p v-else class="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ counts }}
    </p>

    <div class="flex flex-wrap gap-2 border-t border-slate-200 p-3">
      <button
        class="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canApply"
        title="Remplace le MCD actuel (Ctrl+Z pour annuler)"
        @click="apply('replace')"
      >
        <Wand2 :size="14" /> Générer
      </button>
      <button
        class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canApply"
        title="Ajoute ce schéma à droite du MCD actuel"
        @click="apply('append')"
      >
        <FilePlus2 :size="14" /> Ajouter
      </button>
      <button class="ml-auto inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-slate-100" title="Écrire le MCD actuel dans la zone de texte" @click="fromMcd">
        <RefreshCw :size="14" /> Depuis le MCD
      </button>
    </div>

    <details class="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <summary class="cursor-pointer text-sm font-medium">Syntaxe</summary>
      <div class="mt-2 space-y-1.5 font-mono leading-relaxed">
        <p><b>Client: #id, nom, email</b><br /><span class="text-slate-400">entité ; # = identifiant (sinon le 1er attribut)</span></p>
        <p><b>prix:DECIMAL(8,2)</b><br /><span class="text-slate-400">type et taille (INT, VARCHAR, TEXT, DECIMAL, FLOAT, BOOLEAN, DATE, DATETIME)</span></p>
        <p><b>Etudiant &lt; Personne: numero</b><br /><span class="text-slate-400">héritage « est un »</span></p>
        <p><b>Passer: Client 0,n -- Commande 1,1</b><br /><span class="text-slate-400">association ; cardinalités 0,1 1,1 0,n 1,n (ou 0N, 1..n)</span></p>
        <p><b>Contenir (quantite:INT): …</b><br /><span class="text-slate-400">propriétés de l'association</span></p>
        <p><b>Employe 0,n chef -- Employe 0,1 sub</b><br /><span class="text-slate-400">rôle des pattes (réflexive)</span></p>
        <p><b>Ligne: Cmd 1,1 CIF -- Prod 0,n</b><br /><span class="text-slate-400">identifiant relatif</span></p>
        <p class="text-slate-400">// ou % pour un commentaire</p>
      </div>
    </details>
  </aside>
</template>
