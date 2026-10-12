/**
 * Modèle d'un diagramme de séquence : des participants, puis une suite d'éléments (messages, notes, blocs `alt` / `loop`…).
 * Tout ici est pur (pas de Vue, pas de DOM). Le document est une donnée JSON : historique, sauvegarde, partage et exports
 * s'appuient dessus. Les participants sont désignés par leur nom (unique), les éléments par un identifiant.
 */

export type ParticipantKind = 'participant' | 'actor' | 'database'
export const PARTICIPANT_KINDS: ParticipantKind[] = ['participant', 'actor', 'database']
export const KIND_LABEL: Record<ParticipantKind, string> = { participant: 'Participant', actor: 'Acteur', database: 'Base de données' }

export interface Participant {
  /** Identifiant utilisé dans le texte et par les messages ; unique, sans espace. */
  name: string
  /** Texte affiché si différent du nom (`Serveur web`). */
  label?: string
  kind: ParticipantKind
}

/** Flèche d'un message : appel, retour (pointillés), asynchrone, asynchrone en pointillés, message perdu. */
export type Arrow = 'sync' | 'reply' | 'async' | 'asyncReply' | 'lost'
export const ARROWS: Arrow[] = ['sync', 'reply', 'async', 'asyncReply', 'lost']
export const ARROW_LABEL: Record<Arrow, string> = { sync: 'Appel', reply: 'Retour', async: 'Asynchrone', asyncReply: 'Retour asynchrone', lost: 'Perdu (échec)' }
/** Écriture de chaque flèche dans la saisie texte (celle de Mermaid). */
export const ARROW_TOKEN: Record<Arrow, string> = { sync: '->>', reply: '-->>', async: '-)', asyncReply: '--)', lost: '-x' }

export interface SeqMessage {
  id: string
  kind: 'message'
  from: string
  to: string
  text: string
  arrow: Arrow
  /** Active le destinataire : une barre d'activation commence. */
  activate?: boolean
  /** Désactive l'émetteur : sa barre d'activation se termine. */
  deactivate?: boolean
}

export type NotePosition = 'left' | 'right' | 'over'
export interface SeqNote {
  id: string
  kind: 'note'
  position: NotePosition
  /** Un participant, ou deux (`over A, B`). */
  participants: string[]
  text: string
}

export type BlockType = 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break'
export const BLOCK_TYPES: BlockType[] = ['alt', 'opt', 'loop', 'par', 'critical', 'break']
export const BLOCK_LABEL: Record<BlockType, string> = {
  alt: 'alt — alternative (si / sinon)',
  opt: 'opt — facultatif',
  loop: 'loop — répétition',
  par: 'par — en parallèle',
  critical: 'critical — section critique',
  break: 'break — interruption',
}
/** Mot qui ouvre une section supplémentaire d'un bloc (`else` d'un `alt`…) ; absent : le bloc n'a qu'une section. */
export const SECTION_WORD: Partial<Record<BlockType, string>> = { alt: 'else', par: 'and', critical: 'option' }

export interface BlockSection {
  id: string
  /** Condition ou titre ; pour la première section, c'est le libellé du bloc. */
  label?: string
  items: SeqItem[]
}
export interface SeqBlock {
  id: string
  kind: 'block'
  type: BlockType
  sections: BlockSection[]
}

export type SeqItem = SeqMessage | SeqNote | SeqBlock

export interface SeqDocument {
  title?: string
  autonumber?: boolean
  participants: Participant[]
  items: SeqItem[]
}

export interface ParseError {
  line: number
  message: string
}

export const emptySeq = (): SeqDocument => ({ participants: [], items: [] })

// --- Noms ------------------------------------------------------------------------

/** Mots que la saisie texte réserve : ils ne peuvent pas servir de nom de participant. */
export const RESERVED = new Set([
  'participant', 'actor', 'database', 'title', 'autonumber', 'note', 'activate', 'deactivate', 'end', 'as',
  'alt', 'else', 'opt', 'loop', 'par', 'and', 'critical', 'option', 'break', 'rect', 'box', 'create', 'destroy', 'link', 'links', 'over', 'left', 'right',
])
const NAME = /^[\p{L}_][\p{L}\p{N}_.-]*$/u
export const isValidName = (name: string) => NAME.test(name) && !name.endsWith('-') && !RESERVED.has(name.toLowerCase())

/** Nom valide dérivé d'un libellé libre (`Serveur web` → `Serveur_web`) ; vide si rien n'est exploitable. */
export function nameFrom(label: string): string {
  const n = label.trim().replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^[^\p{L}_]+/u, '').replace(/[-_.]+$/g, '')
  return n && !RESERVED.has(n.toLowerCase()) ? n : ''
}

// --- Parcours ----------------------------------------------------------------------

export interface Located {
  item: SeqItem
  /** Liste qui contient l'élément et sa position. */
  list: SeqItem[]
  index: number
  /** Bloc et section qui le contiennent ; absents à la racine. */
  block?: SeqBlock
  section?: BlockSection
}

/** Tous les éléments, dans l'ordre d'affichage, blocs avant leur contenu. */
export function walkItems(items: SeqItem[], visit: (loc: Located) => void, block?: SeqBlock, section?: BlockSection) {
  items.forEach((item, index) => {
    visit({ item, list: items, index, block, section })
    if (item.kind === 'block') for (const s of item.sections) walkItems(s.items, visit, item, s)
  })
}

export function findItem(doc: SeqDocument, id: string): Located | undefined {
  let found: Located | undefined
  walkItems(doc.items, (loc) => {
    if (!found && loc.item.id === id) found = loc
  })
  return found
}

/** Section d'un bloc par son identifiant (les sections ne sont pas des éléments). */
export function findSection(doc: SeqDocument, id: string): { block: SeqBlock; section: BlockSection } | undefined {
  let found: { block: SeqBlock; section: BlockSection } | undefined
  walkItems(doc.items, ({ item }) => {
    if (item.kind === 'block' && !found) {
      const section = item.sections.find((s) => s.id === id)
      if (section) found = { block: item, section }
    }
  })
  return found
}

/** Participants cités par un élément ou, pour un bloc, par tout son contenu. */
export function participantsOf(item: SeqItem): string[] {
  if (item.kind === 'message') return [item.from, item.to]
  if (item.kind === 'note') return item.participants
  return item.sections.flatMap((s) => s.items.flatMap(participantsOf))
}

export const blockLabel = (b: SeqBlock) => b.sections[0]?.label ?? ''

/** Texte d'un élément pour la recherche et les libellés. */
export function itemLabel(item: SeqItem): string {
  if (item.kind === 'message') return `${item.from} → ${item.to}${item.text ? ` : ${item.text.replace(/\n/g, ' ')}` : ''}`
  if (item.kind === 'note') return `Note : ${item.text.replace(/\n/g, ' ')}`
  return `${item.type}${blockLabel(item) ? ` ${blockLabel(item)}` : ''}`
}

// --- Validation d'une source externe -------------------------------------------

const MAX_DEPTH = 12
const MAX_ITEMS = 5000
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const records = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : [])
const optStr = (v: unknown) => str(v).trim() || undefined

/**
 * Valide un document venu de l'extérieur (fichier, lien, sauvegarde) : participants uniques et bien nommés, éléments
 * incomplets écartés, participants manquants créés, identifiants régénérés s'ils manquent ou se répètent.
 * Lève une Error si la structure est inutilisable.
 */
export function sanitizeSeq(raw: unknown, makeId: () => string): SeqDocument {
  if (!isRecord(raw) || !Array.isArray(raw.items) || !Array.isArray(raw.participants)) throw new Error('Fichier invalide : participants ou éléments manquants.')

  const used = new Set<string>()
  const idOf = (v: unknown) => {
    let id = typeof v === 'string' && v && !used.has(v) ? v : makeId()
    while (used.has(id)) id = makeId()
    used.add(id)
    return id
  }

  const participants: Participant[] = []
  const known = new Map<string, Participant>()
  const ensure = (name: string): string | null => {
    if (!isValidName(name)) return null
    const have = [...known.keys()].find((k) => k.toLowerCase() === name.toLowerCase())
    if (have) return have
    const p: Participant = { name, kind: 'participant' }
    known.set(name, p)
    participants.push(p)
    return name
  }

  for (const r of records(raw.participants)) {
    const name = str(r.name).trim()
    if (!isValidName(name) || known.has(name)) continue
    const p: Participant = { name, ...(optStr(r.label) && optStr(r.label) !== name ? { label: optStr(r.label) } : {}), kind: PARTICIPANT_KINDS.includes(r.kind as ParticipantKind) ? (r.kind as ParticipantKind) : 'participant' }
    known.set(name, p)
    participants.push(p)
  }

  let count = 0
  const readItems = (list: unknown, depth: number): SeqItem[] => {
    const out: SeqItem[] = []
    for (const r of records(list)) {
      if (++count > MAX_ITEMS) break
      if (r.kind === 'message') {
        const from = ensure(str(r.from).trim())
        const to = ensure(str(r.to).trim())
        if (!from || !to) continue
        const arrow = ARROWS.includes(r.arrow as Arrow) ? (r.arrow as Arrow) : 'sync'
        out.push({
          id: idOf(r.id), kind: 'message', from, to, text: str(r.text).trim(), arrow,
          ...(r.activate === true ? { activate: true } : {}),
          ...(r.deactivate === true ? { deactivate: true } : {}),
        })
      } else if (r.kind === 'note') {
        const position: NotePosition = r.position === 'left' || r.position === 'right' ? r.position : 'over'
        const names = (Array.isArray(r.participants) ? r.participants : []).map((p) => ensure(str(p).trim())).filter((p): p is string => !!p)
        const parts = position === 'over' ? [...new Set(names)].slice(0, 2) : names.slice(0, 1)
        if (!parts.length) continue
        out.push({ id: idOf(r.id), kind: 'note', position, participants: parts, text: str(r.text).trim() })
      } else if (r.kind === 'block' && depth < MAX_DEPTH) {
        const type = BLOCK_TYPES.includes(r.type as BlockType) ? (r.type as BlockType) : null
        if (!type) continue
        const sections = records(r.sections).slice(0, SECTION_WORD[type] ? 50 : 1).map((s) => ({ id: idOf(s.id), ...(optStr(s.label) ? { label: optStr(s.label) } : {}), items: readItems(s.items, depth + 1) }))
        if (!sections.length) sections.push({ id: idOf(undefined), items: [] })
        out.push({ id: idOf(r.id), kind: 'block', type, sections })
      }
    }
    return out
  }
  const items = readItems(raw.items, 0)

  return { ...(optStr(raw.title) ? { title: optStr(raw.title) } : {}), ...(raw.autonumber === true ? { autonumber: true } : {}), participants, items }
}
