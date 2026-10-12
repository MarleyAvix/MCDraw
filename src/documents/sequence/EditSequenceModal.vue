<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, Trash2, Unlink, X } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useSequenceStore } from './sequenceStore'
import {
  ARROWS,
  ARROW_LABEL,
  BLOCK_LABEL,
  BLOCK_TYPES,
  KIND_LABEL,
  PARTICIPANT_KINDS,
  SECTION_WORD,
  findItem,
  isValidName,
  walkItems,
  type Arrow,
  type BlockType,
  type NotePosition,
  type ParticipantKind,
} from './model'

// Une seule fenêtre pour tout ce qui s'édite : les réglages (`doc`), un participant (`p:Nom`), un message, une note ou un bloc.
// Les champs sont une copie de travail : rien ne change avant « Enregistrer ».
const store = useSequenceStore()
const key = store.editing ?? ''
const mode = key === 'doc' ? 'doc' : key.startsWith('p:') ? 'participant' : (findItem(store.doc, key)?.item.kind ?? 'none')
const item = mode === 'message' || mode === 'note' || mode === 'block' ? findItem(store.doc, key)!.item : undefined
const oldName = key.startsWith('p:') ? key.slice(2) : ''
const participant = store.doc.participants.find((p) => p.name === oldName)

// Réglages généraux
const title = ref(store.doc.title ?? '')
const autonumber = ref(!!store.doc.autonumber)

// Participant
const name = ref(participant?.name ?? '')
const label = ref(participant?.label ?? '')
const kind = ref<ParticipantKind>(participant?.kind ?? 'participant')

// Message
const msg = item?.kind === 'message' ? item : undefined
const from = ref(msg?.from ?? '')
const to = ref(msg?.to ?? '')
const arrow = ref<Arrow>(msg?.arrow ?? 'sync')
const text = ref(msg?.text ?? (item?.kind === 'note' ? item.text : ''))
const activate = ref(!!msg?.activate)
const deactivate = ref(!!msg?.deactivate)

// Note
const note = item?.kind === 'note' ? item : undefined
const position = ref<NotePosition>(note?.position ?? 'over')
const who = ref(note?.participants[0] ?? '')
const who2 = ref(note?.participants[1] ?? '')

// Bloc
const block = item?.kind === 'block' ? item : undefined
const blockType = ref<BlockType>(block?.type ?? 'alt')
const sections = ref((block?.sections ?? []).map((s) => ({ id: s.id as string | undefined, label: s.label ?? '' })))

const names = computed(() => store.doc.participants.map((p) => p.name))
const display = (n: string) => store.doc.participants.find((p) => p.name === n)?.label ?? n
const multi = computed(() => !!SECTION_WORD[blockType.value])
const contentCount = computed(() => {
  let n = 0
  if (block) walkItems(block.sections.flatMap((s) => s.items), () => n++)
  return n
})

const problems = computed(() => {
  const out: string[] = []
  if (mode === 'participant') {
    const n = name.value.trim()
    if (!isValidName(n)) out.push('Nom invalide : lettres, chiffres, _ . - ; sans espace ni mot réservé (alt, end, note…).')
    else if (names.value.some((x) => x !== oldName && x.toLowerCase() === n.toLowerCase())) out.push(`Le participant « ${n} » existe déjà.`)
  }
  if (mode === 'note' && position.value === 'over' && who2.value && who2.value === who.value) out.push('Choisissez deux participants différents, ou un seul.')
  return out
})

const close = () => (store.editing = null)
function save() {
  if (problems.value.length) return
  if (mode === 'doc') store.setMeta({ title: title.value, autonumber: autonumber.value })
  else if (mode === 'participant') {
    const n = name.value.trim()
    store.setParticipant(oldName, { name: n, ...(label.value.trim() && label.value.trim() !== n ? { label: label.value.trim() } : {}), kind: kind.value })
  } else if (msg) {
    store.setMessage({ ...msg, from: from.value, to: to.value, arrow: arrow.value, text: text.value.trim(), activate: activate.value || undefined, deactivate: deactivate.value || undefined })
  } else if (note) {
    const parts = position.value === 'over' && who2.value ? [who.value, who2.value] : [who.value]
    store.setNote({ ...note, position: position.value, participants: parts, text: text.value.trim() })
  } else if (block) store.setBlock(block.id, blockType.value, sections.value)
  close()
}
function remove() {
  if (mode === 'participant') {
    const n = store.usageOf([oldName])
    if (n && !confirm(`Supprimer « ${oldName} » retire aussi ${n} message(s) ou note(s) qui le citent. Continuer ? (Ctrl+Z pour annuler)`)) return
    store.removeParticipants([oldName])
  } else if (item) {
    if (block && contentCount.value && !confirm(`Supprimer ce bloc et ses ${contentCount.value} élément(s) ? (Ctrl+Z pour annuler)`)) return
    store.removeItems([item.id])
  }
  close()
}
const unwrap = () => {
  if (block) store.unwrapBlock(block.id)
  close()
}
const move = (dir: -1 | 1) => (mode === 'participant' ? store.moveParticipantBy(oldName, dir) : item && store.moveItemBy(item.id, dir))
const canMove = (dir: -1 | 1) => (mode === 'participant' ? store.canMoveParticipant(oldName, dir) : !!item && store.canMoveItem(item.id, dir))

const titles: Record<string, string> = { doc: 'Réglages du diagramme', participant: 'Modifier le participant', message: 'Modifier le message', note: 'Modifier la note', block: 'Modifier le bloc' }
const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
const iconBtn = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30'
</script>

<template>
  <BaseModal v-if="mode !== 'none'" :title="titles[mode]" @close="close">
    <!-- Réglages -->
    <template v-if="mode === 'doc'">
      <label class="block text-sm font-medium">
        Titre
        <input v-model="title" autofocus :class="field" placeholder="Connexion avec jeton" aria-label="Titre du diagramme" />
      </label>
      <label class="mt-4 inline-flex items-center gap-2 text-sm"><input v-model="autonumber" type="checkbox" /> Numéroter les messages</label>
    </template>

    <!-- Participant -->
    <template v-else-if="mode === 'participant'">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="text-sm font-medium">
          Nom
          <input v-model="name" autofocus :class="[field, 'font-mono']" placeholder="API" aria-label="Nom du participant" />
          <span class="mt-1 block text-xs font-normal text-slate-400">Utilisé dans le texte. Renommer met à jour les messages.</span>
        </label>
        <label class="text-sm font-medium">
          Libellé affiché
          <input v-model="label" :class="field" placeholder="Serveur web (facultatif)" aria-label="Libellé du participant" />
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Type
        <select v-model="kind" :class="field" aria-label="Type du participant">
          <option v-for="k in PARTICIPANT_KINDS" :key="k" :value="k">{{ KIND_LABEL[k] }}</option>
        </select>
      </label>
    </template>

    <!-- Message -->
    <template v-else-if="mode === 'message'">
      <div class="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <label class="text-sm font-medium">
          De
          <select v-model="from" :class="field" aria-label="Émetteur"><option v-for="n in names" :key="n" :value="n">{{ display(n) }}</option></select>
        </label>
        <label class="text-sm font-medium">
          Flèche
          <select v-model="arrow" :class="field" aria-label="Type de flèche"><option v-for="a in ARROWS" :key="a" :value="a">{{ ARROW_LABEL[a] }}</option></select>
        </label>
        <label class="text-sm font-medium">
          Vers
          <select v-model="to" :class="field" aria-label="Destinataire"><option v-for="n in names" :key="n" :value="n">{{ display(n) }}</option></select>
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Texte
        <textarea v-model="text" autofocus rows="2" :class="field" placeholder="POST /login" aria-label="Texte du message" />
      </label>
      <div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label class="inline-flex items-center gap-2" title="Une barre d'activation commence sur le destinataire"><input v-model="activate" type="checkbox" /> Active le destinataire</label>
        <label class="inline-flex items-center gap-2" title="La barre d'activation de l'émetteur se termine"><input v-model="deactivate" type="checkbox" /> Désactive l'émetteur</label>
      </div>
    </template>

    <!-- Note -->
    <template v-else-if="mode === 'note'">
      <div class="grid gap-4 sm:grid-cols-3">
        <label class="text-sm font-medium">
          Position
          <select v-model="position" :class="field" aria-label="Position de la note">
            <option value="over">Au-dessus</option>
            <option value="left">À gauche de</option>
            <option value="right">À droite de</option>
          </select>
        </label>
        <label class="text-sm font-medium">
          Participant
          <select v-model="who" :class="field" aria-label="Participant de la note"><option v-for="n in names" :key="n" :value="n">{{ display(n) }}</option></select>
        </label>
        <label v-if="position === 'over'" class="text-sm font-medium">
          Jusqu'à (facultatif)
          <select v-model="who2" :class="field" aria-label="Second participant de la note"><option value="">—</option><option v-for="n in names" :key="n" :value="n">{{ display(n) }}</option></select>
        </label>
      </div>
      <label class="mt-4 block text-sm font-medium">
        Texte
        <textarea v-model="text" autofocus rows="3" :class="field" aria-label="Texte de la note" />
      </label>
    </template>

    <!-- Bloc -->
    <template v-else-if="mode === 'block'">
      <label class="block text-sm font-medium">
        Type de bloc
        <select v-model="blockType" :class="field" aria-label="Type de bloc"><option v-for="t in BLOCK_TYPES" :key="t" :value="t">{{ BLOCK_LABEL[t] }}</option></select>
      </label>
      <section class="mt-4">
        <h3 class="text-sm font-semibold">{{ multi ? 'Sections' : 'Libellé' }}</h3>
        <div v-for="(s, i) in multi ? sections : sections.slice(0, 1)" :key="s.id ?? `n${i}`" class="mt-2 flex items-center gap-2">
          <code class="w-16 shrink-0 text-xs text-slate-500">{{ i === 0 ? blockType : SECTION_WORD[blockType] }}</code>
          <input v-model="s.label" :autofocus="i === 0" class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" :placeholder="i === 0 ? 'condition ou titre (facultatif)' : 'libellé (facultatif)'" :aria-label="`Libellé de la section ${i + 1}`" />
          <button v-if="i > 0" :class="iconBtn" title="Retirer cette section (son contenu rejoint la précédente)" aria-label="Retirer la section" @click="sections.splice(i, 1)"><X :size="15" /></button>
        </div>
        <button v-if="multi" class="mt-3 inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="sections.push({ id: undefined, label: '' })">
          <Plus :size="12" /> Section « {{ SECTION_WORD[blockType] }} »
        </button>
        <p v-if="!multi && sections.length > 1" class="mt-2 text-xs text-amber-700">Ce type n'a qu'une section : les autres sont fusionnées dans la première.</p>
      </section>
    </template>

    <ul v-if="problems.length" class="mt-4 space-y-0.5 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
      <li v-for="p in problems" :key="p">{{ p }}</li>
    </ul>

    <template #footer>
      <div class="flex items-center gap-1">
        <button v-if="mode !== 'doc'" class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove"><Trash2 :size="15" /> Supprimer</button>
        <button v-if="mode === 'block'" class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" title="Retire le bloc et garde son contenu" @click="unwrap"><Unlink :size="15" /> Dissoudre</button>
        <template v-if="mode === 'participant'">
          <button :class="iconBtn" title="Placer avant (à gauche)" aria-label="Déplacer à gauche" :disabled="!canMove(-1)" @click="move(-1)"><ArrowLeft :size="16" /></button>
          <button :class="iconBtn" title="Placer après (à droite)" aria-label="Déplacer à droite" :disabled="!canMove(1)" @click="move(1)"><ArrowRight :size="16" /></button>
        </template>
        <template v-else-if="mode !== 'doc'">
          <button :class="iconBtn" title="Monter" aria-label="Monter l'élément" :disabled="!canMove(-1)" @click="move(-1)"><ArrowUp :size="16" /></button>
          <button :class="iconBtn" title="Descendre" aria-label="Descendre l'élément" :disabled="!canMove(1)" @click="move(1)"><ArrowDown :size="16" /></button>
        </template>
      </div>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="problems.length > 0" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
