<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useClassStore } from './classStore'
import { CLASS_KINDS, KIND_LABEL, REL_LABEL, REL_TYPES, classOfKey, findClass, isClassKey, isValidName, type ClassKind, type RelType } from './model'

// Une seule fenêtre pour tout ce qui s'édite : les réglages (`doc`), une classe (`c:Nom`) ou une relation.
// Les champs sont une copie de travail : rien ne change avant « Enregistrer ».
const store = useClassStore()
const key = store.editing ?? ''
const oldName = isClassKey(key) ? classOfKey(key) : ''
const box = oldName ? findClass(store.doc, oldName) : undefined
const relIndex = !oldName && key !== 'doc' ? store.relKeys.indexOf(key) : -1
const rel = relIndex >= 0 ? store.doc.relations[relIndex] : undefined
const mode = key === 'doc' ? 'doc' : box ? 'class' : rel ? 'relation' : 'none'
const names = computed(() => store.doc.classes.map((c) => c.name))

// Réglages généraux
const title = ref(store.doc.title ?? '')

// Classe
const name = ref(box?.name ?? '')
const kind = ref<ClassKind>(box?.kind ?? 'class')
const attributes = ref((box?.attributes ?? []).join('\n'))
const methods = ref((box?.methods ?? []).join('\n'))

// Relation
const from = ref(rel?.from ?? '')
const to = ref(rel?.to ?? '')
const type = ref<RelType>(rel?.type ?? 'association')
const label = ref(rel?.label ?? '')
const fromMult = ref(rel?.fromMult ?? '')
const toMult = ref(rel?.toMult ?? '')

const problems = computed(() => {
  const out: string[] = []
  if (mode === 'class') {
    const n = name.value.trim()
    if (!isValidName(n)) out.push('Le nom doit commencer par une lettre et ne contenir que lettres, chiffres et _ (sans espace).')
    else if (n !== oldName && names.value.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(`Une classe s'appelle déjà « ${n} ».`)
  }
  return out
})

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
const close = () => (store.editing = null)
function save() {
  if (problems.value.length) return
  if (mode === 'doc') store.setMeta({ title: title.value })
  else if (mode === 'class') store.setClass(oldName, { name: name.value.trim(), kind: kind.value, attributes: lines(attributes.value), methods: lines(methods.value) })
  else if (rel) {
    store.setRelation(key, {
      from: from.value,
      to: to.value,
      type: type.value,
      ...(label.value.trim() ? { label: label.value.trim() } : {}),
      ...(fromMult.value.trim() ? { fromMult: fromMult.value.trim() } : {}),
      ...(toMult.value.trim() ? { toMult: toMult.value.trim() } : {}),
    })
  }
  close()
}
function remove() {
  if (mode === 'class') {
    const n = store.usageOf([oldName])
    if (n && !confirm(`Supprimer « ${oldName} » retire aussi ${n} relation(s) qui la citent. Continuer ? (Ctrl+Z pour annuler)`)) return
    store.removeClasses([oldName])
  } else if (rel) store.removeRelations([key])
  close()
}

const titles: Record<string, string> = { doc: 'Réglages du diagramme', class: 'Modifier la classe', relation: 'Modifier la relation' }
const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
</script>

<template>
  <BaseModal v-if="mode !== 'none'" :title="titles[mode]" @close="close">
    <!-- Réglages -->
    <template v-if="mode === 'doc'">
      <label class="block text-sm font-medium">
        Titre du diagramme
        <input v-model="title" autofocus :class="field" placeholder="Gestion d'une bibliothèque" aria-label="Titre du diagramme" />
      </label>
    </template>

    <!-- Classe -->
    <template v-else-if="mode === 'class'">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          Nom
          <input v-model="name" autofocus :class="[field, 'font-mono']" placeholder="Livre" aria-label="Nom de la classe" />
          <span class="mt-1 block text-xs font-normal text-slate-400">Renommer met à jour les relations.</span>
        </label>
        <label class="text-sm font-medium">
          Type
          <select v-model="kind" :class="field" aria-label="Type de la classe"><option v-for="k in CLASS_KINDS" :key="k" :value="k">{{ KIND_LABEL[k] }}</option></select>
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Attributs <span class="font-normal text-slate-400">(un par ligne)</span>
        <textarea v-model="attributes" rows="4" spellcheck="false" :class="[field, 'font-mono text-xs']" placeholder="-titre: String&#10;-isbn: String" aria-label="Attributs" />
      </label>
      <label class="mt-3 block text-sm font-medium">
        Méthodes <span class="font-normal text-slate-400">(une par ligne)</span>
        <textarea v-model="methods" rows="4" spellcheck="false" :class="[field, 'font-mono text-xs']" placeholder="+estDisponible() boolean" aria-label="Méthodes" />
      </label>
      <ul v-if="problems.length" role="alert" class="mt-3 space-y-1 text-xs text-red-600"><li v-for="p in problems" :key="p">{{ p }}</li></ul>
    </template>

    <!-- Relation -->
    <template v-else-if="mode === 'relation'">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          De <span class="font-normal text-slate-400">(le fils, la partie, la source)</span>
          <select v-model="from" :class="field" aria-label="Classe de départ"><option v-for="n in names" :key="n" :value="n">{{ n }}</option></select>
        </label>
        <label class="text-sm font-medium">
          Vers <span class="font-normal text-slate-400">(le parent, le tout, la cible)</span>
          <select v-model="to" :class="field" aria-label="Classe d'arrivée"><option v-for="n in names" :key="n" :value="n">{{ n }}</option></select>
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Nature
        <select v-model="type" :class="field" aria-label="Nature de la relation"><option v-for="t in REL_TYPES" :key="t" :value="t">{{ REL_LABEL[t] }}</option></select>
      </label>
      <label class="mt-4 block text-sm font-medium">
        Libellé
        <input v-model="label" :class="field" placeholder="contient (facultatif)" aria-label="Libellé de la relation" />
      </label>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          Multiplicité côté « De »
          <input v-model="fromMult" :class="[field, 'font-mono']" placeholder="0..*" aria-label="Multiplicité de départ" />
        </label>
        <label class="text-sm font-medium">
          Multiplicité côté « Vers »
          <input v-model="toMult" :class="[field, 'font-mono']" placeholder="1" aria-label="Multiplicité d'arrivée" />
        </label>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center gap-1">
        <button v-if="mode !== 'doc'" class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove"><Trash2 :size="15" /> Supprimer</button>
      </div>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="problems.length > 0" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
