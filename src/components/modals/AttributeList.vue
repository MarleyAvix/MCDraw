<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRight, Plus, Trash2, Underline } from 'lucide-vue-next'
import { DATA_TYPES, type Attribute } from '../../types/schema'
import { newAttribute } from '../../stores/schemaStore'

const attributes = defineModel<Attribute[]>({ required: true })
defineProps<{ allowPk?: boolean }>()

const add = () => attributes.value.push(newAttribute())
// Un seul identifiant : activer une clé retire les autres.
function togglePk(i: number) {
  const on = !attributes.value[i].isPrimaryKey
  attributes.value.forEach((a, j) => (a.isPrimaryKey = on && j === i))
}
const remove = (i: number) => attributes.value.splice(i, 1)
// Panneau « contraintes » déplié par attribut (NOT NULL, UNIQUE, valeur par défaut, CHECK).
const open = ref(new Set<string>())
function toggle(id: string) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}
const hasConstraints = (a: Attribute) => !!(a.notNull || a.unique || a.defaultValue?.trim() || a.check?.trim())
const hasSize = (a: Attribute) => a.type === 'VARCHAR' || a.type === 'DECIMAL'
</script>

<template>
  <div class="space-y-2">
    <div v-for="(a, i) in attributes" :key="a.id">
    <div class="flex items-center gap-2">
      <button
        v-if="allowPk"
        type="button"
        class="rounded p-1.5"
        :class="a.isPrimaryKey ? 'bg-indigo-100 text-indigo-600' : 'text-slate-300 hover:bg-slate-100'"
        :title="a.isPrimaryKey ? 'Identifiant (souligné) — cliquer pour retirer' : 'Définir comme identifiant (souligné)'"
        @click="togglePk(i)"
      >
        <Underline :size="16" />
      </button>
      <input v-model="a.name" placeholder="nom_attribut" class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
      <select v-model="a.type" class="rounded border border-slate-300 px-1 py-1 text-sm">
        <option v-for="t in DATA_TYPES" :key="t" :value="t">{{ t }}</option>
      </select>
      <input
        v-if="hasSize(a)"
        v-model="a.size"
        :placeholder="a.type === 'DECIMAL' ? '10,2' : '255'"
        class="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        title="Taille"
      />
      <button
        type="button"
        class="flex items-center rounded p-1.5 text-xs"
        :class="hasConstraints(a) ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-100'"
        title="Contraintes : NOT NULL, UNIQUE, valeur par défaut, CHECK"
        @click="toggle(a.id)"
      >
        <ChevronRight :size="14" :class="open.has(a.id) ? 'rotate-90' : ''" class="transition-transform" /> Contraintes
      </button>
      <button type="button" class="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Supprimer" @click="remove(i)">
        <Trash2 :size="16" />
      </button>
    </div>
    <div v-if="open.has(a.id)" class="ml-9 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-slate-200 p-2 text-sm">
      <template v-if="!a.isPrimaryKey">
        <label class="flex items-center gap-2" title="La colonne ne peut pas être vide">
          <input v-model="a.notNull" type="checkbox" /> NOT NULL
        </label>
        <label class="flex items-center gap-2" title="Deux lignes ne peuvent pas avoir la même valeur">
          <input v-model="a.unique" type="checkbox" /> UNIQUE
        </label>
      </template>
      <p v-else class="col-span-2 text-xs text-slate-500">Un identifiant est déjà NOT NULL et UNIQUE.</p>
      <label class="block" title="Texte ou nombre ; ou une fonction : CURRENT_TIMESTAMP, CURRENT_DATE">
        Valeur par défaut
        <input v-model="a.defaultValue" placeholder="ex : 0, actif, CURRENT_DATE" class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" />
      </label>
      <label class="block" title="Condition SQL qui doit toujours être vraie">
        CHECK
        <input v-model="a.check" placeholder="ex : prix >= 0" class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
      </label>
    </div>
    </div>
    <p v-if="!attributes.length" class="text-sm italic text-slate-400">Aucun attribut.</p>
    <button type="button" class="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-indigo-600 hover:bg-indigo-50" @click="add">
      <Plus :size="14" /> Ajouter un attribut
    </button>
  </div>
</template>
