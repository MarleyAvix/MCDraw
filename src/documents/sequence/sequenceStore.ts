import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useHistory } from '../../composables/useHistory'
import { usePersistence } from '../../composables/usePersistence'
import { layoutSequence } from './layout'
import {
  SECTION_WORD,
  emptySeq,
  findItem,
  itemLabel,
  sanitizeSeq,
  walkItems,
  type BlockType,
  type Located,
  type Participant,
  type SeqBlock,
  type SeqDocument,
  type SeqItem,
  type SeqMessage,
  type SeqNote,
} from './model'
import { parseSeqText } from './text'

const STORAGE_KEY = 'mcdraw:sequence:v1'
const uid = () => Math.random().toString(36).slice(2, 10)
/** Copie profonde d'une donnée JSON, y compris un objet réactif (`structuredClone` les refuse). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** Sélection d'un participant : son nom précédé de `p:` (les éléments sont désignés par leur identifiant). */
export const participantKey = (name: string) => `p:${name}`
const isParticipantKey = (k: string) => k.startsWith('p:')

export interface SequenceExample {
  id: string
  label: string
  description: string
  text: string
}

export const SEQUENCE_EXAMPLES: SequenceExample[] = [
  {
    id: 'connexion',
    label: 'Connexion avec jeton',
    description: 'Formulaire, API, base de données, alternative succès / échec.',
    text: `title Connexion avec jeton
autonumber

actor Client as Utilisateur
participant Web as Application web
participant API
database DB as Base de données

Client ->> Web: Saisit e-mail et mot de passe
Web ->>+ API: POST /auth/login
API ->>+ DB: SELECT utilisateur par e-mail
DB -->>- API: utilisateur
alt mot de passe valide
  API -->>- Web: 200 jetons
  Web -->> Client: Affiche l'accueil
else identifiants incorrects
  API -->>- Web: 401
  Web -->> Client: Message d'erreur
end
Note over Web, API: Le jeton expire après 15 minutes`,
  },
  {
    id: 'commande',
    label: 'Passage de commande',
    description: 'Stock, paiement, notifications en parallèle, bloc facultatif.',
    text: `title Passage de commande
autonumber

actor Client
participant Boutique
participant Paiement
participant Stock
participant Mail as Service e-mail

Client ->> Boutique: Valide le panier
Boutique ->>+ Stock: Réserver les articles
Stock -->>- Boutique: Réservation confirmée
opt code promo saisi
  Boutique ->> Boutique: Calculer la remise
end
Boutique ->>+ Paiement: Débiter la carte
alt paiement accepté
  Paiement -->>- Boutique: 200 accepté
  par notifications
    Boutique -) Mail: Envoyer la confirmation
  and mise à jour
    Boutique -) Stock: Décrémenter le stock
  end
  Boutique -->> Client: Commande confirmée
else paiement refusé
  Paiement -->>- Boutique: 402 refusé
  Boutique ->> Stock: Libérer la réservation
  Boutique -->> Client: Paiement refusé
end`,
  },
  {
    id: 'synchronisation',
    label: 'Synchronisation avec reprise',
    description: 'Boucle, interruption, section critique et message perdu.',
    text: `title Synchronisation avec reprise
participant App
participant API
database Cache as Cache local

loop toutes les 30 secondes
  App ->> API: GET /changes?since=...
  alt nouveautés
    API -->> App: 200 liste
    App ->> Cache: Enregistrer
  else rien de nouveau
    API -->> App: 304
  end
end
break connexion perdue
  App -x API: Requête sans réponse
  Note right of App: Passe en mode hors ligne
end
critical écriture sûre
  App ->> Cache: Verrouiller
  App ->> API: PUT /items/42
option conflit
  API -->> App: 409
  App ->> App: Fusionner les versions
end`,
  },
]

type Clip = SeqItem[]

/** Copie d'un élément (et de son contenu) avec des identifiants neufs. */
function recopy(item: SeqItem): SeqItem {
  const c = clone(item)
  c.id = uid()
  if (c.kind === 'block') {
    for (const s of c.sections) {
      s.id = uid()
      s.items = s.items.map(recopy)
    }
  }
  return c
}

export const useSequenceStore = defineStore('sequence', () => {
  const doc = ref<SeqDocument>(emptySeq())
  const selection = ref<string[]>([])
  /** Élément ou participant en cours d'édition (`p:Nom`), `doc` pour les réglages généraux. */
  const editing = ref<string | null>(null)
  /** Fenêtre « Depuis l'API » ouverte. */
  const showApiModal = ref(false)
  const showTextPanel = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
  const highlightId = ref<string | null>(null)
  const view = ref('diagram')
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let clipboard: Clip | null = null

  const schema = computed<SeqDocument>(() => doc.value)
  const layout = computed(() => layoutSequence(doc.value))
  const participants = computed(() => doc.value.participants)

  // --- Recherche de l'élément sélectionné ---------------------------------------------
  const selectedItems = computed(() => selection.value.filter((k) => !isParticipantKey(k)).map((id) => findItem(doc.value, id)).filter((l): l is Located => !!l))
  const selectedParticipant = computed(() => selection.value.find(isParticipantKey)?.slice(2))

  function flash(id: string) {
    clearTimeout(highlightTimer)
    highlightId.value = id
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

  /** Où s'insère le prochain élément : à la fin du bloc sélectionné, après l'élément sélectionné, sinon à la fin. */
  function insertionPoint(): { list: SeqItem[]; index: number } {
    const sel = selectedItems.value.at(-1)
    if (!sel) return { list: doc.value.items, index: doc.value.items.length }
    if (sel.item.kind === 'block') {
      const last = sel.item.sections.at(-1)!
      return { list: last.items, index: last.items.length }
    }
    return { list: sel.list, index: sel.index + 1 }
  }

  function insert(item: SeqItem) {
    const { list, index } = insertionPoint()
    list.splice(index, 0, item)
    selection.value = [item.id]
    editing.value = item.id
  }

  // --- Participants ------------------------------------------------------------------
  function uniqueName(base: string) {
    const taken = new Set(doc.value.participants.map((p) => p.name.toLowerCase()))
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}${n}`
    return name
  }

  function addParticipant(): Participant {
    const p: Participant = { name: uniqueName('Participant'), kind: 'participant' }
    const after = selectedParticipant.value ? doc.value.participants.findIndex((x) => x.name === selectedParticipant.value) : -1
    doc.value.participants.splice(after < 0 ? doc.value.participants.length : after + 1, 0, p)
    selection.value = [participantKey(p.name)]
    editing.value = participantKey(p.name)
    return p
  }

  /** Renomme / modifie un participant ; un renommage met à jour tous les messages et notes qui le citent. */
  function setParticipant(oldName: string, next: Participant) {
    const i = doc.value.participants.findIndex((p) => p.name === oldName)
    if (i < 0) return
    doc.value.participants[i] = next
    if (oldName !== next.name) {
      walkItems(doc.value.items, ({ item }) => {
        if (item.kind === 'message') {
          if (item.from === oldName) item.from = next.name
          if (item.to === oldName) item.to = next.name
        } else if (item.kind === 'note') item.participants = item.participants.map((p) => (p === oldName ? next.name : p))
      })
      selection.value = selection.value.map((k) => (k === participantKey(oldName) ? participantKey(next.name) : k))
    }
  }

  /** Nombre d'éléments qui disparaîtraient avec ces participants. */
  function usageOf(names: string[]): number {
    const gone = new Set(names)
    let n = 0
    walkItems(doc.value.items, ({ item }) => {
      if (item.kind === 'message' && (gone.has(item.from) || gone.has(item.to))) n++
      else if (item.kind === 'note' && item.participants.some((p) => gone.has(p))) n++
    })
    return n
  }

  function removeParticipants(names: string[]) {
    const gone = new Set(names)
    doc.value.participants = doc.value.participants.filter((p) => !gone.has(p.name))
    const strip = (items: SeqItem[]): SeqItem[] =>
      items.filter((it) => {
        if (it.kind === 'message') return !gone.has(it.from) && !gone.has(it.to)
        if (it.kind === 'note') return !it.participants.some((p) => gone.has(p))
        for (const s of it.sections) s.items = strip(s.items)
        return true
      })
    doc.value.items = strip(doc.value.items)
    selection.value = selection.value.filter((k) => !(isParticipantKey(k) && gone.has(k.slice(2))))
    if (editing.value && isParticipantKey(editing.value) && gone.has(editing.value.slice(2))) editing.value = null
  }

  function moveParticipantBy(name: string, dir: -1 | 1): boolean {
    const list = doc.value.participants
    const i = list.findIndex((p) => p.name === name)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return false
    ;[list[i], list[j]] = [list[j], list[i]]
    return true
  }
  const canMoveParticipant = (name: string | undefined, dir: -1 | 1) => {
    const i = doc.value.participants.findIndex((p) => p.name === name)
    return i >= 0 && i + dir >= 0 && i + dir < doc.value.participants.length
  }

  // --- Messages, notes, blocs ---------------------------------------------------------
  /** Garantit au moins deux participants (un message en demande deux) et renvoie les deux premiers noms utiles. */
  function ensureParticipants(): void {
    const list = doc.value.participants
    if (list.length === 0) list.push({ name: 'Client', kind: 'actor' }, { name: 'Serveur', kind: 'participant' })
    else if (list.length === 1) list.push({ name: uniqueName('Serveur'), kind: 'participant' })
  }

  function addMessage(): SeqMessage {
    ensureParticipants()
    const [first, second] = doc.value.participants
    const prev = selectedItems.value.at(-1)?.item
    let m: SeqMessage = { id: uid(), kind: 'message', from: first.name, to: second.name, text: '', arrow: 'sync' }
    if (prev?.kind === 'message') {
      // Après un appel, on propose naturellement son retour ; après un retour, l'appelant reprend la main. Le sens s'inverse chaque fois.
      const isCall = prev.arrow === 'sync' || prev.arrow === 'async'
      m = { ...m, from: prev.to, to: prev.from, arrow: isCall ? (prev.arrow === 'async' ? 'asyncReply' : 'reply') : 'sync' }
    } else if (selectedParticipant.value) {
      const i = doc.value.participants.findIndex((p) => p.name === selectedParticipant.value)
      m = { ...m, from: selectedParticipant.value, to: doc.value.participants[(i + 1) % doc.value.participants.length].name }
    }
    insert(m)
    return m
  }

  function addNote(): SeqNote {
    ensureParticipants()
    const prev = selectedItems.value.at(-1)?.item
    const on = prev?.kind === 'message' ? prev.to : (selectedParticipant.value ?? doc.value.participants[0].name)
    const note: SeqNote = { id: uid(), kind: 'note', position: 'over', participants: [on], text: 'Note' }
    insert(note)
    return note
  }

  /**
   * Nouveau bloc. Si des éléments voisins sont sélectionnés, le bloc les enveloppe ; sinon il est vide, à la suite de la sélection.
   */
  function addBlock(type: BlockType = 'alt'): SeqBlock {
    const sel = selectedItems.value
    const block: SeqBlock = { id: uid(), kind: 'block', type, sections: [{ id: uid(), items: [] }] }
    const lists = new Set(sel.map((l) => l.list))
    if (sel.length && lists.size === 1) {
      const { list } = sel[0]
      const idx = sel.map((l) => list.indexOf(l.item)).sort((a, b) => a - b)
      const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
      if (contiguous) {
        block.sections[0].items = list.splice(idx[0], idx.length)
        list.splice(idx[0], 0, block)
        selection.value = [block.id]
        editing.value = block.id
        return block
      }
    }
    insert(block)
    return block
  }

  function setMessage(next: SeqMessage) {
    const loc = findItem(doc.value, next.id)
    if (loc) loc.list[loc.index] = next
  }
  function setNote(next: SeqNote) {
    const loc = findItem(doc.value, next.id)
    if (loc) loc.list[loc.index] = next
  }

  /**
   * Change le type d'un bloc et les libellés de ses sections. `labels` donne un libellé par section conservée (par identifiant) ;
   * une section retirée verse son contenu dans la précédente, et un type sans sections multiples fusionne tout dans la première.
   */
  function setBlock(id: string, type: BlockType, sections: { id?: string; label: string }[]) {
    const loc = findItem(doc.value, id)
    if (loc?.item.kind !== 'block') return
    const block = loc.item
    const wanted = SECTION_WORD[type] ? sections : sections.slice(0, 1)
    const old = new Map(block.sections.map((s) => [s.id, s]))
    const kept: SeqBlock['sections'] = wanted.map((w) => {
      const from = w.id ? old.get(w.id) : undefined
      return { id: from?.id ?? uid(), ...(w.label.trim() ? { label: w.label.trim() } : {}), items: from?.items ?? [] }
    })
    if (!kept.length) kept.push({ id: uid(), items: [] })
    const keptIds = new Set(kept.map((s) => s.id))
    // Le contenu des sections retirées rejoint la section qui les précédait.
    let target = kept[0]
    for (const s of block.sections) {
      if (keptIds.has(s.id)) target = kept.find((k) => k.id === s.id)!
      else target.items.push(...s.items)
    }
    block.type = type
    block.sections = kept
  }

  /** Retire le bloc mais garde son contenu, à sa place. */
  function unwrapBlock(id: string) {
    const loc = findItem(doc.value, id)
    if (loc?.item.kind !== 'block') return
    loc.list.splice(loc.index, 1, ...loc.item.sections.flatMap((s) => s.items))
    selection.value = selection.value.filter((k) => k !== id)
    if (editing.value === id) editing.value = null
  }

  function setMeta(meta: { title?: string; autonumber?: boolean }) {
    const t = meta.title?.trim()
    if (t) doc.value.title = t
    else delete doc.value.title
    if (meta.autonumber) doc.value.autonumber = true
    else delete doc.value.autonumber
  }

  function removeItems(ids: string[]) {
    for (const id of ids) {
      const loc = findItem(doc.value, id)
      if (loc) loc.list.splice(loc.index, 1)
    }
    selection.value = selection.value.filter((k) => !ids.includes(k) && (isParticipantKey(k) || !!findItem(doc.value, k)))
    if (editing.value && !isParticipantKey(editing.value) && editing.value !== 'doc' && !findItem(doc.value, editing.value)) editing.value = null
  }

  /** Supprime la sélection : éléments et participants (ceux-ci entraînent les messages qui les citent). */
  function removeSelection() {
    const items = selection.value.filter((k) => !isParticipantKey(k))
    const names = selection.value.filter(isParticipantKey).map((k) => k.slice(2))
    if (names.length) removeParticipants(names)
    if (items.length) removeItems(items)
  }

  function moveItemBy(id: string, dir: -1 | 1): boolean {
    const loc = findItem(doc.value, id)
    if (!loc) return false
    const j = loc.index + dir
    if (j < 0 || j >= loc.list.length) return false
    ;[loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]]
    return true
  }
  const canMoveItem = (id: string | undefined, dir: -1 | 1) => {
    const loc = id ? findItem(doc.value, id) : undefined
    return !!loc && loc.index + dir >= 0 && loc.index + dir < loc.list.length
  }

  // --- Copier / coller / dupliquer ---------------------------------------------------
  /** Éléments sélectionnés dont aucun ancêtre n'est sélectionné, dans l'ordre d'affichage. */
  function topItems(): SeqItem[] {
    const ids = new Set(selection.value.filter((k) => !isParticipantKey(k)))
    const out: SeqItem[] = []
    const visit = (items: SeqItem[]) => {
      for (const it of items) {
        if (ids.has(it.id)) out.push(it)
        else if (it.kind === 'block') for (const s of it.sections) visit(s.items)
      }
    }
    visit(doc.value.items)
    return out
  }

  function copy(): boolean {
    const items = topItems()
    clipboard = items.length ? items.map((i) => clone(i)) : null
    return !!clipboard
  }

  function paste(): boolean {
    if (!clipboard) return false
    const fresh = clipboard.map(recopy)
    const { list, index } = insertionPoint()
    list.splice(index, 0, ...fresh)
    selection.value = fresh.map((i) => i.id)
    return true
  }

  function duplicate() {
    const items = topItems()
    if (!items.length) return
    const last = findItem(doc.value, items.at(-1)!.id)!
    const fresh = items.map((i) => recopy(clone(i)))
    last.list.splice(last.index + 1, 0, ...fresh)
    selection.value = fresh.map((i) => i.id)
  }

  function selectAll() {
    const ids: string[] = []
    walkItems(doc.value.items, ({ item }) => ids.push(item.id))
    selection.value = ids
  }

  // --- Recherche -------------------------------------------------------------------
  function searchIndex() {
    const out: { key: string; nodeId: string; label: string; context: string; kind: 'message' | 'participant' | 'note' | 'block' }[] = []
    for (const p of doc.value.participants) out.push({ key: participantKey(p.name), nodeId: participantKey(p.name), label: p.label ?? p.name, context: p.label ? p.name : 'Participant', kind: 'participant' })
    walkItems(doc.value.items, ({ item, block }) => {
      out.push({ key: item.id, nodeId: item.id, label: itemLabel(item), context: block ? `Dans « ${block.type} »` : item.kind === 'message' ? 'Message' : item.kind === 'note' ? 'Note' : 'Bloc', kind: item.kind })
    })
    return out
  }

  // --- Chargement ----------------------------------------------------------------
  function load(s: SeqDocument) {
    doc.value = s
    const alive = new Set<string>(s.participants.map((p) => participantKey(p.name)))
    walkItems(s.items, ({ item }) => alive.add(item.id))
    selection.value = selection.value.filter((k) => alive.has(k))
    if (editing.value && editing.value !== 'doc' && !alive.has(editing.value)) editing.value = null
  }

  const importSchema = (raw: unknown) => load(sanitizeSeq(raw, uid))
  const reset = () => load(emptySeq())
  function loadExample(id: string) {
    const ex = SEQUENCE_EXAMPLES.find((e) => e.id === id)
    if (ex) load(parseSeqText(ex.text, uid).doc)
  }

  // --- Sauvegarde locale et historique ------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(sanitizeSeq(JSON.parse(raw), uid))
    else loadExample(SEQUENCE_EXAMPLES[0].id)
  } catch {
    loadExample(SEQUENCE_EXAMPLES[0].id)
  }
  usePersistence(schema, STORAGE_KEY)
  const { undo, redo, canUndo, canRedo } = useHistory({ state: schema, load })

  return {
    doc, selection, editing, showApiModal, showTextPanel, highlightId, view,
    schema, layout, participants, selectedItems, selectedParticipant,
    flash, addParticipant, setParticipant, usageOf, removeParticipants, moveParticipantBy, canMoveParticipant,
    addMessage, addNote, addBlock, setMessage, setNote, setBlock, unwrapBlock, setMeta, removeItems, removeSelection, moveItemBy, canMoveItem,
    copy, paste, duplicate, selectAll, searchIndex, load, importSchema, reset, loadExample,
    undo, redo, canUndo, canRedo,
  }
})
