<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { GripVertical, Plus, Underline, X } from 'lucide-vue-next'
import { DATA_TYPES, type Attribute, type DataType } from '../../types/schema'
import { constraintTags, sqlTypeOf } from '../../engine/meriseToMld'
import { useSchemaStore } from '../../stores/schemaStore'

const props = defineProps<{ nodeId: string; attributes: Attribute[]; kind: 'entity' | 'relation' }>()
const store = useSchemaStore()

const root = ref<HTMLElement>()
const editingId = ref<string | null>(null)
const draftName = ref('')
const draftType = ref<DataType>('VARCHAR')
// Attribut tout juste créé et pas encore modifié (nom par défaut).
const freshId = ref<string | null>(null)

const isEntity = () => props.kind === 'entity'

async function startEdit(a: Attribute) {
  editingId.value = a.id
  draftName.value = a.name
  draftType.value = a.type
  await nextTick()
  const focusInput = () => {
    const input = root.value?.querySelector<HTMLInputElement>('input[data-attr-edit]')
    if (!input || document.activeElement === input) return
    input.focus()
    input.select()
  }
  focusInput()
  // Un clic peut redonner le focus au nœud juste après : on réessaie une fois.
  setTimeout(focusInput, 60)
}

/** Valide l'édition en cours ; un attribut resté sans nom est supprimé. */
function commit() {
  const id = editingId.value
  if (!id) return
  editingId.value = null
  if (freshId.value === id) freshId.value = null
  const name = draftName.value.trim()
  if (!name) store.removeAttribute(props.nodeId, id)
  else store.updateAttribute(props.nodeId, id, { name, type: draftType.value })
}

function cancel() {
  const id = editingId.value
  const a = props.attributes.find((x) => x.id === id)
  editingId.value = null
  if (a && (!a.name.trim() || freshId.value === a.id)) store.removeAttribute(props.nodeId, a.id)
  freshId.value = null
}

async function addAndEdit() {
  commit()
  const a = store.addAttribute(props.nodeId)
  if (a) {
    freshId.value = a.id
    await startEdit(a)
  }
}

/** Entrée / Tab : valide, puis passe à la ligne suivante (ou en crée une en fin de liste). */
async function next(e: KeyboardEvent) {
  e.preventDefault()
  const idx = props.attributes.findIndex((a) => a.id === editingId.value)
  const name = draftName.value.trim()
  if (!name) return commit()
  // Entrée sur une ligne neuve non modifiée : on referme la saisie sans garder l'attribut.
  if (editingId.value === freshId.value && name === props.attributes[idx]?.name && e.key === 'Enter') return cancel()
  if (idx === props.attributes.length - 1) return addAndEdit()
  commit()
  const target = props.attributes[idx + 1]
  if (target && e.key === 'Tab') await startEdit(target)
}

function onBackspace(e: KeyboardEvent) {
  if (draftName.value === '') {
    e.preventDefault()
    commit() // nom vide → suppression
  }
}

// Le focus peut passer du champ nom au sélecteur de type sans clore l'édition.
function onFocusOut(e: FocusEvent, id: string) {
  if (editingId.value !== id) return // ligne déjà validée (ex. changement de ligne)
  const row = (e.currentTarget as HTMLElement) ?? null
  if (row && e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return
  commit()
}

// Réordonnancement par glisser-déposer (poignée à gauche de la ligne).
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)
function onDragStart(e: DragEvent, i: number) {
  dragFrom.value = i
  const row = (e.target as HTMLElement).closest('li')
  if (row && e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
    e.dataTransfer.setDragImage(row, 0, 0)
  }
}
function onDrop(i: number) {
  if (dragFrom.value !== null) store.moveAttribute(props.nodeId, dragFrom.value, i)
  dragFrom.value = dragOver.value = null
}
</script>

<template>
  <div ref="root">
    <ul>
      <li
        v-for="(a, i) in attributes"
        :key="a.id"
        class="group/row relative flex items-center gap-1.5 py-0.5"
        :class="dragOver === i && dragFrom !== null && dragFrom !== i ? 'border-t-2 border-indigo-600' : ''"
        @dragover.prevent="dragOver = i"
        @drop.prevent="onDrop(i)"
        @dragend="dragFrom = dragOver = null"
        @dblclick.stop="startEdit(a)"
      >
        <span
          v-if="editingId !== a.id"
          class="nodrag cursor-grab text-slate-400 opacity-0 group-hover/row:opacity-100"
          title="Glisser pour réordonner"
          draggable="true"
          @dragstart="onDragStart($event, i)"
        >
          <GripVertical :size="12" />
        </span>

        <!-- Mode édition -->
        <template v-if="editingId === a.id">
          <div class="nodrag flex flex-1 items-center gap-1" @focusout="onFocusOut($event, a.id)">
            <input
              v-model="draftName"
              data-attr-edit
              placeholder="nom_attribut"
              class="min-w-0 flex-1 rounded border border-indigo-600 bg-surface px-1 py-0.5 text-sm outline-none"
              @keydown.enter="next"
              @keydown.tab="next"
              @keydown.esc.stop="cancel"
              @keydown.backspace="onBackspace"
            />
            <select
              v-model="draftType"
              class="rounded border border-slate-300 bg-surface px-0.5 py-0.5 text-[10px]"
              @keydown.esc.stop="cancel"
            >
              <option v-for="t in DATA_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
        </template>

        <!-- Mode lecture -->
        <template v-else>
          <template v-if="isEntity()">
            <button
              class="nodrag shrink-0"
              :class="a.isPrimaryKey ? 'text-indigo-600 opacity-0 group-hover/row:opacity-100' : 'text-slate-400 opacity-0 hover:text-indigo-600 group-hover/row:opacity-100'"
              :title="a.isPrimaryKey ? 'Identifiant (souligné) — cliquer pour retirer' : 'Définir comme identifiant (souligné)'"
              @click.stop="store.updateAttribute(nodeId, a.id, { isPrimaryKey: !a.isPrimaryKey })"
            >
              <Underline :size="12" />
            </button>
          </template>
          <span
            class="flex-1"
            :class="a.isPrimaryKey ? 'font-semibold underline' : ''"
            title="Double-clic pour modifier"
          >
            {{ a.name || '…' }}
          </span>
          <span v-if="isEntity()" class="text-[10px] text-slate-400">{{ sqlTypeOf(a) }}{{ (a.notNull && !a.isPrimaryKey ? ' · NN' : '') + constraintTags({ unique: a.isPrimaryKey ? false : a.unique, defaultValue: a.defaultValue?.trim(), check: a.check?.trim() }) }}</span>
          <button
            class="nodrag shrink-0 text-slate-400 opacity-0 hover:text-red-600 group-hover/row:opacity-100"
            title="Supprimer l'attribut"
            @click.stop="store.removeAttribute(nodeId, a.id)"
          >
            <X :size="12" />
          </button>
        </template>
      </li>
    </ul>

    <p v-if="!attributes.length" class="py-0.5 text-xs italic text-slate-400">Aucun attribut</p>

    <div class="flex justify-center pt-1">
      <button
        class="nodrag flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-slate-500 opacity-50 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white hover:opacity-100 group-hover/node:opacity-100"
        title="Ajouter un attribut"
        @mousedown.stop
        @pointerdown.stop
        @click.stop="addAndEdit"
      >
        <Plus :size="12" />
      </button>
    </div>
  </div>
</template>
