<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { INHERITANCE_STRATEGIES, type Attribute, type InheritanceStrategy } from '../../types/schema'
import BaseModal from './BaseModal.vue'
import AttributeList from './AttributeList.vue'

const store = useSchemaStore()
const entity = computed(() => store.entities.find((e) => e.id === store.editingEntityId))

// Copie de travail : validée uniquement à l'enregistrement.
const name = ref(entity.value?.name ?? '')
const attributes = ref<Attribute[]>(entity.value?.attributes.map((a) => ({ ...a })) ?? [])

const parentId = ref(entity.value?.parentId ?? '')
const strategy = ref<InheritanceStrategy>(entity.value?.inheritance ?? 'class')

// Parents possibles : toute entité sauf soi-même et ses descendants (pas de boucle).
const candidates = computed(() => {
  const self = entity.value
  if (!self) return []
  const banned = new Set([self.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const e of store.entities) {
      if (e.parentId && banned.has(e.parentId) && !banned.has(e.id)) {
        banned.add(e.id)
        grew = true
      }
    }
  }
  return store.entities.filter((e) => !banned.has(e.id))
})
const children = computed(() => (entity.value ? store.childrenOfEntity(entity.value.id) : []))
const rootName = computed(() => {
  const r = parentId.value && store.entities.find((e) => e.id === parentId.value)
  return r ? store.inheritanceRoot(r.id)?.name : undefined
})
const STRATEGY_INFO: Record<InheritanceStrategy, { label: string; help: string }> = {
  class: { label: 'Une table par classe', help: 'La mère et chaque fille ont leur table ; la clé de la fille est aussi une clé étrangère vers la mère.' },
  single: { label: 'Une seule table pour tout', help: 'Tout est regroupé dans la table de la mère : colonnes des filles facultatives + colonne « type ».' },
  concrete: { label: 'Une table par classe fille', help: "Seules les filles ont une table, qui recopie les attributs de la mère. Les associations de la mère sont dupliquées sur chaque fille." },
}

const close = () => (store.editingEntityId = null)
function save() {
  if (entity.value) {
    // Une entité fille n'a pas d'identifiant propre : il est hérité de sa mère.
    const attrs = parentId.value ? attributes.value.map((a) => ({ ...a, isPrimaryKey: false })) : attributes.value
    store.updateEntity(entity.value.id, { name: name.value.trim(), attributes: attrs })
    store.setParent(entity.value.id, parentId.value || undefined)
    if (!parentId.value && children.value.length) store.setInheritance(entity.value.id, strategy.value)
  }
  close()
}
function remove() {
  if (entity.value) store.removeNode(entity.value.id)
}
</script>

<template>
  <BaseModal v-if="entity" title="Modifier l'entité" wide @close="close">
    <label class="mb-4 block text-sm font-medium">
      Nom de l'entité
      <input v-model="name" autofocus class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" @keydown.enter="save" />
    </label>
    <fieldset class="mb-4 rounded border border-slate-200 p-3">
      <legend class="px-1 text-sm font-medium">Héritage (« est un »)</legend>
      <label class="block text-sm">
        Cette entité est un(e)…
        <select v-model="parentId" class="mt-1 w-full rounded border border-slate-300 bg-surface px-2 py-1.5">
          <option value="">— aucune (entité indépendante) —</option>
          <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name || '(sans nom)' }}</option>
        </select>
      </label>
      <p v-if="parentId" class="mt-2 text-xs text-slate-500">
        L'identifiant est hérité de la mère. Stratégie de traduction définie sur la classe racine{{ rootName ? ` « ${rootName} »` : '' }}.
      </p>
      <div v-else-if="children.length" class="mt-3">
        <p class="mb-1 text-sm font-medium">Stratégie de traduction en MLD</p>
        <label v-for="s in INHERITANCE_STRATEGIES" :key="s" class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input v-model="strategy" type="radio" name="inheritance" :value="s" class="mt-1" />
          <span>
            <span class="font-medium">{{ STRATEGY_INFO[s].label }}</span>
            <span class="block text-xs text-slate-500">{{ STRATEGY_INFO[s].help }}</span>
          </span>
        </label>
      </div>
    </fieldset>
    <h3 class="mb-2 text-sm font-medium">Attributs <span class="font-normal text-slate-400">— l'identifiant (souligné) identifie chaque occurrence de l'entité</span></h3>
    <AttributeList v-model="attributes" :allow-pk="!parentId" />
    <template #footer>
      <button class="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove">
        <Trash2 :size="14" /> Supprimer
      </button>
      <div class="flex gap-2">
        <button class="rounded px-3 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
