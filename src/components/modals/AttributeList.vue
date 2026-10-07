<script setup lang="ts">
import { Plus, Trash2, KeyRound } from 'lucide-vue-next'
import { DATA_TYPES, type Attribute } from '../../types/schema'
import { newAttribute } from '../../stores/schemaStore'

const attributes = defineModel<Attribute[]>({ required: true })
defineProps<{ allowPk?: boolean }>()

const add = () => attributes.value.push(newAttribute())
const remove = (i: number) => attributes.value.splice(i, 1)
const hasSize = (a: Attribute) => a.type === 'VARCHAR' || a.type === 'DECIMAL'
</script>

<template>
  <div class="space-y-2">
    <div v-for="(a, i) in attributes" :key="a.id" class="flex items-center gap-2">
      <button
        v-if="allowPk"
        type="button"
        class="rounded p-1.5"
        :class="a.isPrimaryKey ? 'bg-amber-100 text-amber-700' : 'text-slate-300 hover:bg-slate-100'"
        :title="a.isPrimaryKey ? 'Clé primaire (identifiant)' : 'Définir comme identifiant'"
        @click="a.isPrimaryKey = !a.isPrimaryKey"
      >
        <KeyRound :size="16" />
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
      <button type="button" class="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Supprimer" @click="remove(i)">
        <Trash2 :size="16" />
      </button>
    </div>
    <p v-if="!attributes.length" class="text-sm italic text-slate-400">Aucun attribut.</p>
    <button type="button" class="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-indigo-600 hover:bg-indigo-50" @click="add">
      <Plus :size="14" /> Ajouter un attribut
    </button>
  </div>
</template>
