<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { CARDINALITIES, REF_ACTIONS, type Attribute, type Cardinality, type RefAction } from '../../types/schema'
import BaseModal from './BaseModal.vue'
import AttributeList from './AttributeList.vue'

const store = useSchemaStore()
const relation = computed(() => store.relations.find((r) => r.id === store.editingRelationId))

const name = ref(relation.value?.name ?? '')
const attributes = ref<Attribute[]>(relation.value?.attributes.map((a) => ({ ...a })) ?? [])

// Les pattes (cardinalités, rôles) sont modifiées en direct dans le store.
const legs = computed(() =>
  store.links
    .filter((l) => l.relationId === relation.value?.id)
    .map((l) => ({ link: l, entity: store.entities.find((e) => e.id === l.entityId) })),
)

// Clés étrangères produites par chaque patte : les actions référentielles se règlent sur la patte de l'entité référencée.
const fkLegs = computed(() =>
  legs.value.flatMap(({ link, entity }) =>
    store.mld.tables.flatMap((t) =>
      t.foreignKeys.filter((fk) => fk.linkId === link.id).map((fk) => ({ link, entity, table: t.name, cols: fk.columns.join(', ') })),
    ),
  ),
)
const setAction = (id: string, key: 'onDelete' | 'onUpdate', e: Event) =>
  store.updateLink(id, { [key]: ((e.target as HTMLSelectElement).value || undefined) as RefAction | undefined })

const close = () => (store.editingRelationId = null)
function save() {
  if (relation.value) store.updateRelation(relation.value.id, { name: name.value.trim(), attributes: attributes.value })
  close()
}
function remove() {
  if (relation.value) store.removeNode(relation.value.id)
}
</script>

<template>
  <BaseModal v-if="relation" title="Modifier l'association" wide @close="close">
    <label class="mb-4 block text-sm font-medium">
      Nom de l'association
      <input v-model="name" autofocus class="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" @keydown.enter="save" />
    </label>

    <h3 class="mb-2 text-sm font-medium">Cardinalités</h3>
    <div class="mb-5 space-y-2">
      <div v-for="{ link, entity } in legs" :key="link.id" class="flex items-center gap-2">
        <span class="w-36 truncate text-sm font-semibold uppercase">{{ entity?.name }}</span>
        <div class="inline-flex overflow-hidden rounded border border-slate-300">
          <button
            v-for="c in CARDINALITIES"
            :key="c"
            type="button"
            class="px-2.5 py-1 text-sm"
            :class="link.cardinality === c ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'"
            @click="store.updateLink(link.id, { cardinality: c as Cardinality })"
          >
            {{ c }}
          </button>
        </div>
        <label
          v-if="link.cardinality === '1,1' && legs.length === 2"
          class="flex shrink-0 items-center gap-1 text-xs"
          title="Identifiant relatif : la clé de l'autre entité entre dans la clé de celle-ci (entité faible)"
        >
          <input type="checkbox" :checked="!!link.identifying" @change="store.updateLink(link.id, { identifying: ($event.target as HTMLInputElement).checked })" />
          CIF
        </label>
        <input
          :value="link.role ?? ''"
          placeholder="rôle (optionnel)"
          class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          @input="store.updateLink(link.id, { role: ($event.target as HTMLInputElement).value || undefined })"
        />
        <button class="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Supprimer la patte" @click="store.removeLink(link.id)">
          <Trash2 :size="16" />
        </button>
      </div>
      <p v-if="!legs.length" class="text-sm italic text-slate-400">Reliez cette association à des entités en tirant un trait depuis un de ses points.</p>
    </div>

    <template v-if="fkLegs.length">
      <h3 class="mb-1 text-sm font-medium">Actions référentielles <span class="font-normal text-slate-400">— effet sur la clé étrangère quand l'entité référencée est supprimée / modifiée</span></h3>
      <div class="mb-5 space-y-2">
        <div v-for="f in fkLegs" :key="f.link.id + f.table" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span class="min-w-0 flex-1 truncate" :title="`${f.table}(${f.cols}) → ${f.entity?.name}`">
            <span class="font-mono text-xs">{{ f.table }}.{{ f.cols }}</span> → <span class="font-semibold uppercase">{{ f.entity?.name }}</span>
          </span>
          <label class="flex items-center gap-1 text-xs">
            ON DELETE
            <select :value="f.link.onDelete ?? ''" class="rounded border border-slate-300 bg-surface px-1 py-1 text-sm" @change="setAction(f.link.id, 'onDelete', $event)">
              <option value="">par défaut</option>
              <option v-for="a in REF_ACTIONS" :key="a" :value="a">{{ a }}</option>
            </select>
          </label>
          <label class="flex items-center gap-1 text-xs">
            ON UPDATE
            <select :value="f.link.onUpdate ?? ''" class="rounded border border-slate-300 bg-surface px-1 py-1 text-sm" @change="setAction(f.link.id, 'onUpdate', $event)">
              <option value="">par défaut</option>
              <option v-for="a in REF_ACTIONS" :key="a" :value="a">{{ a }}</option>
            </select>
          </label>
        </div>
      </div>
    </template>

    <h3 class="mb-2 text-sm font-medium">Propriétés de l'association</h3>
    <AttributeList v-model="attributes" />

    <template #footer>
      <button class="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove">
        <Trash2 :size="14" /> Supprimer
      </button>
      <div class="flex gap-2">
        <button class="rounded px-3 py-1.5 text-sm hover:bg-slate-100" @click="close">Fermer</button>
        <button class="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
