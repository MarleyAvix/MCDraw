<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, Trash2, Unlink } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useStateStore } from './stateStore'
import { KIND_LABEL, PSEUDO, STATE_KINDS, findState, findTransition, isComposite, isValidName, walkStates, type Direction, type StateKind } from './model'

// Une seule fenêtre pour tout ce qui s'édite : les réglages (`doc`), un état (`s:Nom`) ou une transition.
// Les champs sont une copie de travail : rien ne change avant « Enregistrer ».
const store = useStateStore()
const key = store.editing ?? ''
const mode = key === 'doc' ? 'doc' : key.startsWith('s:') ? (findState(store.doc, key.slice(2)) ? 'state' : 'none') : findTransition(store.doc, key) ? 'transition' : 'none'
const oldName = key.startsWith('s:') ? key.slice(2) : ''
const loc = mode === 'state' ? findState(store.doc, oldName)! : undefined
const found = mode === 'transition' ? findTransition(store.doc, key)! : undefined

// Réglages généraux
const title = ref(store.doc.title ?? '')
const direction = ref<Direction>(store.doc.direction ?? 'TB')

// État
const name = ref(loc?.state.name ?? '')
const label = ref(loc?.state.label ?? '')
const kind = ref<StateKind>(loc?.state.kind ?? 'state')
const composite = ref(!!loc && isComposite(loc.state))
const actions = ref((loc?.state.actions ?? []).join('\n'))
const note = ref(loc?.state.note ?? '')
const inside = computed(() => (loc && isComposite(loc.state) ? loc.state.states.length : 0))

// Transition
const from = ref(found?.t.from ?? '')
const to = ref(found?.t.to ?? '')
const event = ref(found?.t.event ?? '')
const guard = ref(found?.t.guard ?? '')
const action = ref(found?.t.action ?? '')
const siblings = computed(() => (found ? found.container.states : []))
const display = (n: string) => siblings.value.find((s) => s.name === n)?.label ?? n

const problems = computed(() => {
  const out: string[] = []
  if (mode === 'state') {
    const n = name.value.trim()
    let clash = false
    walkStates(store.doc, ({ state }) => {
      if (state.name !== oldName && state.name.toLowerCase() === n.toLowerCase()) clash = true
    })
    if (!isValidName(n)) out.push('Nom invalide : lettres, chiffres, _ . - ; sans espace ni mot réservé (state, note, title…).')
    else if (clash) out.push(`L'état « ${n} » existe déjà.`)
  }
  if (mode === 'transition' && from.value === PSEUDO && to.value === PSEUDO) out.push('Une transition relie deux états : « début » et « fin » ne peuvent pas se suivre.')
  return out
})

const close = () => (store.editing = null)
function save() {
  if (problems.value.length) return
  if (mode === 'doc') store.setMeta({ title: title.value, direction: direction.value })
  else if (mode === 'state') {
    if (loc && isComposite(loc.state) && inside.value && !(composite.value && kind.value === 'state') && !confirm(`Cet état contient ${inside.value} état(s) : ils seront supprimés. Continuer ? (Ctrl+Z pour annuler)`)) return
    store.setState(oldName, {
      name: name.value.trim(),
      label: label.value.trim(),
      kind: kind.value,
      actions: actions.value.split('\n').map((a) => a.trim()).filter(Boolean),
      note: note.value.trim(),
      composite: composite.value,
    })
  } else if (found) {
    const clean = (v: string) => v.trim() || undefined
    store.setTransition({ id: found.t.id, from: from.value, to: to.value, event: clean(event.value), guard: clean(guard.value), action: clean(action.value) })
  }
  close()
}
function remove() {
  if (mode === 'state') {
    const n = store.usageOf([oldName])
    if (n && !confirm(`Supprimer « ${oldName} » retire aussi ${n} élément(s) (états contenus, transitions). Continuer ? (Ctrl+Z pour annuler)`)) return
    store.removeStates([oldName])
  } else if (found) store.removeTransitions([found.t.id])
  close()
}
function ungroup() {
  const lost = store.ungroupLoss(oldName)
  if (lost && !confirm(`Dissoudre « ${oldName} » retire ${lost} transition(s) qui le touchent ou qui partent de son état initial / vers son état final. Continuer ? (Ctrl+Z pour annuler)`)) return
  store.ungroup(oldName)
  close()
}
const move = (dir: -1 | 1) => store.moveStateBy(oldName, dir)

const titles: Record<string, string> = { doc: 'Réglages du diagramme', state: 'Modifier l’état', transition: 'Modifier la transition' }
const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
const iconBtn = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30'
</script>

<template>
  <BaseModal v-if="mode !== 'none'" :title="titles[mode]" @close="close">
    <!-- Réglages -->
    <template v-if="mode === 'doc'">
      <label class="block text-sm font-medium">
        Titre
        <input v-model="title" autofocus :class="field" placeholder="Cycle de vie d'une commande" aria-label="Titre du diagramme" />
      </label>
      <label class="mt-4 block text-sm font-medium">
        Sens de lecture
        <select v-model="direction" :class="field" aria-label="Sens de lecture">
          <option value="TB">De haut en bas</option>
          <option value="LR">De gauche à droite</option>
        </select>
      </label>
    </template>

    <!-- État -->
    <template v-else-if="mode === 'state'">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          Nom
          <input v-model="name" autofocus :class="[field, 'font-mono']" placeholder="Brouillon" aria-label="Nom de l’état" />
          <span class="mt-1 block text-xs font-normal text-slate-400">Utilisé dans le texte. Renommer met à jour les transitions.</span>
        </label>
        <label class="text-sm font-medium">
          Libellé affiché
          <input v-model="label" :class="field" placeholder="En attente de paiement (facultatif)" aria-label="Libellé de l’état" />
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Type
        <select v-model="kind" :class="field" aria-label="Type de l’état"><option v-for="k in STATE_KINDS" :key="k" :value="k">{{ KIND_LABEL[k] }}</option></select>
      </label>
      <template v-if="kind === 'state'">
        <label class="mt-4 inline-flex items-center gap-2 text-sm" title="Un état composite contient d'autres états, avec leur propre début et leur propre fin">
          <input v-model="composite" type="checkbox" /> État composite (contient d'autres états)
        </label>
        <label class="mt-4 block text-sm font-medium">
          Actions (une par ligne)
          <textarea v-model="actions" rows="3" :class="[field, 'font-mono text-xs']" placeholder="entrée / initialiser&#10;do / surveiller&#10;sortie / nettoyer" aria-label="Actions de l’état" />
        </label>
        <label class="mt-4 block text-sm font-medium">
          Note
          <textarea v-model="note" rows="2" :class="field" placeholder="Commentaire affiché dans l'état (facultatif)" aria-label="Note de l’état" />
        </label>
      </template>
    </template>

    <!-- Transition -->
    <template v-else-if="mode === 'transition'">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          De
          <select v-model="from" :class="field" aria-label="État de départ">
            <option :value="PSEUDO">● Début (état initial)</option>
            <option v-for="s in siblings" :key="s.name" :value="s.name">{{ display(s.name) }}</option>
          </select>
        </label>
        <label class="text-sm font-medium">
          Vers
          <select v-model="to" :class="field" aria-label="État d’arrivée">
            <option v-for="s in siblings" :key="s.name" :value="s.name">{{ display(s.name) }}</option>
            <option :value="PSEUDO">◉ Fin (état final)</option>
          </select>
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Événement
        <input v-model="event" autofocus :class="field" placeholder="payer" aria-label="Événement déclencheur" />
      </label>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          Garde (condition)
          <input v-model="guard" :class="field" placeholder="panier non vide" aria-label="Condition de la transition" />
        </label>
        <label class="text-sm font-medium">
          Action
          <input v-model="action" :class="field" placeholder="réserver le stock" aria-label="Action de la transition" />
        </label>
      </div>
      <p class="mt-3 text-xs text-slate-400">S'écrit : <code>événement [garde] / action</code> — tout est facultatif.</p>
    </template>

    <ul v-if="problems.length" class="mt-4 space-y-0.5 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
      <li v-for="p in problems" :key="p">{{ p }}</li>
    </ul>

    <template #footer>
      <div class="flex items-center gap-1">
        <button v-if="mode !== 'doc'" class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove"><Trash2 :size="15" /> Supprimer</button>
        <button v-if="mode === 'state' && loc && isComposite(loc.state)" class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" title="Retire l'état composite et garde les états qu'il contient" @click="ungroup"><Unlink :size="15" /> Dissoudre</button>
        <template v-if="mode === 'state'">
          <button :class="iconBtn" title="Placer avant" aria-label="Déplacer avant" :disabled="!store.canMoveState(oldName, -1)" @click="move(-1)"><ArrowUp :size="16" /></button>
          <button :class="iconBtn" title="Placer après" aria-label="Déplacer après" :disabled="!store.canMoveState(oldName, 1)" @click="move(1)"><ArrowDown :size="16" /></button>
        </template>
      </div>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="problems.length > 0" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
