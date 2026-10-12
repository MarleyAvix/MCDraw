<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useApiStore } from './apiStore'
import { normalizeType, PRIMITIVES, type ApiField } from './model'

const store = useApiStore()
const resource = computed(() => store.resourceById.get(store.editingResourceId ?? ''))

// Copie de travail : validée uniquement à l'enregistrement.
const r = resource.value
const name = ref(r?.name ?? '')
const description = ref(r?.description ?? '')
const fields = ref<ApiField[]>(r?.fields.map((f) => ({ ...f })) ?? [])

const usedBy = computed(() => (r ? (store.usage.get(r.name) ?? 0) : 0))
const problems = computed(() => {
  const out: string[] = []
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(name.value.trim())) out.push('Le nom commence par une majuscule, puis lettres ou chiffres (ex. User).')
  else if (store.resources.some((x) => x.id !== r?.id && x.name === name.value.trim())) out.push(`Un schéma « ${name.value.trim()} » existe déjà.`)
  const seen = new Set<string>()
  for (const f of fields.value) {
    if (!f.name.trim()) out.push('Un champ n’a pas de nom.')
    else if (seen.has(f.name.trim())) out.push(`Le champ « ${f.name.trim()} » existe deux fois.`)
    seen.add(f.name.trim())
    if (!normalizeType(f.type)) out.push(`Type invalide pour « ${f.name || '?'} » : ${f.type || 'vide'}.`)
  }
  return out
})
const suggestions = computed(() => [...PRIMITIVES, ...store.resources.filter((x) => x.id !== r?.id).flatMap((x) => [x.name, `${x.name}[]`])])

const close = () => (store.editingResourceId = null)
function save() {
  if (!r || problems.value.length) return
  store.setResource({
    id: r.id,
    name: name.value.trim(),
    ...(description.value.trim() ? { description: description.value.trim() } : {}),
    fields: fields.value.map((f) => ({
      name: f.name.trim(),
      type: normalizeType(f.type)!,
      ...(f.optional ? { optional: true } : {}),
      ...(f.description?.trim() ? { description: f.description.trim() } : {}),
    })),
  })
  close()
}
function remove() {
  if (!r) return
  if (usedBy.value && !confirm(`Ce schéma est utilisé par ${usedBy.value} route(s). Le supprimer quand même ?`)) return
  store.removeResources([r.id])
}

const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
const cell = 'rounded border border-slate-300 px-2 py-1 text-sm'
</script>

<template>
  <BaseModal v-if="resource" title="Modifier le schéma" wide @close="close">
    <datalist id="api-field-types"><option v-for="t in suggestions" :key="t" :value="t" /></datalist>

    <div class="grid gap-4 sm:grid-cols-2">
      <label class="text-sm font-medium">
        Nom
        <input v-model="name" autofocus :class="[field, 'font-mono']" placeholder="User" aria-label="Nom du schéma" />
      </label>
      <label class="text-sm font-medium">
        Description
        <input v-model="description" :class="field" placeholder="Un compte utilisateur" />
      </label>
    </div>

    <section class="mt-5">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Champs</h3>
        <button class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="fields.push({ name: '', type: 'string' })"><Plus :size="12" /> Champ</button>
      </div>
      <p v-if="!fields.length" class="mt-2 text-xs text-slate-400">Aucun champ.</p>
      <div v-for="(f, i) in fields" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
        <input v-model="f.name" :class="[cell, 'w-40 font-mono']" placeholder="nom" aria-label="Nom du champ" />
        <input v-model="f.type" list="api-field-types" :class="[cell, 'w-44 font-mono']" placeholder="string" aria-label="Type du champ" />
        <label class="inline-flex items-center gap-1 text-xs"><input v-model="f.optional" type="checkbox" /> facultatif</label>
        <input v-model="f.description" :class="[cell, 'min-w-32 flex-1']" placeholder="description" aria-label="Description du champ" />
        <button class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" title="Retirer" aria-label="Retirer le champ" @click="fields.splice(i, 1)"><X :size="15" /></button>
      </div>
      <p class="mt-3 text-xs text-slate-500">Types : string, int, number, bool, date, datetime, uuid, email, url, any, un autre schéma (<code>User</code>), une liste (<code>User[]</code>) ou <code>enum(a|b)</code>.</p>
    </section>

    <ul v-if="problems.length" class="mt-4 space-y-0.5 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
      <li v-for="p in problems" :key="p">{{ p }}</li>
    </ul>

    <template #footer>
      <button class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove"><Trash2 :size="15" /> Supprimer</button>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="problems.length > 0" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
