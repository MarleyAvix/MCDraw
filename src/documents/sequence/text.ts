/**
 * Saisie textuelle d'un diagramme de séquence, volontairement proche de Mermaid (on peut y coller un `sequenceDiagram`) :
 *
 *   title Connexion
 *   autonumber
 *
 *   actor Client as Utilisateur
 *   participant API
 *   database DB
 *
 *   Client ->> API: POST /login
 *   API ->>+ DB: SELECT utilisateur
 *   DB -->>- API: ligne
 *   alt identifiants valides
 *     API -->> Client: 200 jetons
 *   else échec
 *     API -->> Client: 401
 *   end
 *   Note over Client, API: le jeton expire après 15 min
 *
 * Flèches : `->>` appel, `-->>` retour (pointillés), `-)` asynchrone, `--)` asynchrone en pointillés, `-x` perdu ;
 * `->` et `-->` sont acceptées comme `->>` et `-->>`. Après la flèche, `+` active le destinataire et `-` désactive l'émetteur.
 * Blocs : `alt` / `else`, `opt`, `loop`, `par` / `and`, `critical` / `option`, `break`, tous fermés par `end`
 * (l'indentation n'est que de la mise en forme). Un participant non déclaré est créé à sa première apparition.
 * Commentaires : `%%` ou `//` en début de ligne. `<br>` dans un texte fait un retour à la ligne.
 */
import {
  ARROW_TOKEN,
  BLOCK_TYPES,
  SECTION_WORD,
  blockLabel,
  isValidName,
  type Arrow,
  type BlockSection,
  type BlockType,
  type NotePosition,
  type ParseError,
  type Participant,
  type ParticipantKind,
  type SeqBlock,
  type SeqDocument,
  type SeqItem,
  type SeqMessage,
} from './model'

/** Flèches reconnues, de la plus longue à la plus courte (une flèche courte est le début d'une longue). */
const ARROW_PARSE: [string, Arrow][] = [
  ['-->>', 'reply'],
  ['--)', 'asyncReply'],
  ['--x', 'lost'],
  ['->>', 'sync'],
  ['-->', 'reply'],
  ['-)', 'async'],
  ['-x', 'lost'],
  ['->', 'sync'],
]

/** Texte d'un message tel qu'il est saisi → texte du modèle (`<br>` et entités Mermaid décodés). */
const decode = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).trim()
/** Texte du modèle → une ligne de saisie. */
const encode = (s: string) => s.replace(/\r?\n/g, '<br/>')

const unquote = (s: string) => {
  const t = s.trim()
  return t.length > 1 && /^(["']).*\1$/.test(t) ? t.slice(1, -1).trim() : t
}

interface MessageLine {
  from: string
  to: string
  arrow: Arrow
  activate: boolean
  deactivate: boolean
  text: string
}

/** Lit `A ->>+ B: texte`. Les noms peuvent contenir un tiret : on essaie chaque flèche possible jusqu'à trouver deux noms valides. */
function readMessage(body: string): MessageLine | null {
  const colon = body.indexOf(':')
  const head = colon < 0 ? body : body.slice(0, colon)
  const text = colon < 0 ? '' : body.slice(colon + 1)
  for (let i = 1; i < head.length; i++) {
    if (head[i] !== '-') continue
    for (const [token, arrow] of ARROW_PARSE) {
      if (!head.startsWith(token, i)) continue
      const from = head.slice(0, i).trim()
      let rest = head.slice(i + token.length)
      let activate = false
      let deactivate = false
      const flag = /^\s*([+-])/.exec(rest)
      if (flag) {
        if (flag[1] === '+') activate = true
        else deactivate = true
        rest = rest.slice(flag[0].length)
      }
      const to = rest.trim()
      if (isValidName(from) && isValidName(to)) return { from, to, arrow, activate, deactivate, text: decode(text) }
    }
  }
  return null
}

export function parseSeqText(text: string, makeId: () => string): { doc: SeqDocument; errors: ParseError[] } {
  const doc: SeqDocument = { participants: [], items: [] }
  const errors: ParseError[] = []
  const implicit = new Set<string>()
  const byName = new Map<string, Participant>()
  interface Frame {
    block: SeqBlock
    line: number
  }
  const stack: Frame[] = []
  /** Liste où s'ajoute le prochain élément : la dernière section du bloc ouvert, ou la racine. */
  const current = (): SeqItem[] => (stack.length ? stack[stack.length - 1].block.sections.at(-1)!.items : doc.items)

  const ensure = (name: string, line: number): boolean => {
    const have = [...byName.keys()].find((k) => k.toLowerCase() === name.toLowerCase())
    if (have) return true
    if (!isValidName(name)) {
      errors.push({ line, message: `Nom de participant invalide : « ${name} » (lettres, chiffres, _ . - ; sans espace ni mot réservé).` })
      return false
    }
    const p: Participant = { name, kind: 'participant' }
    byName.set(name, p)
    doc.participants.push(p)
    implicit.add(name)
    return true
  }
  const canon = (name: string) => [...byName.keys()].find((k) => k.toLowerCase() === name.toLowerCase()) ?? name

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const body = raw.trim()
    if (!body || body.startsWith('%%') || body.startsWith('//') || body === '---') return // `---` : l'en-tête de titre d'un export Mermaid
    const fail = (message: string) => void errors.push({ line, message })
    // Un mot-clé est suivi d'un espace, d'un « : » ou de la fin de ligne : `actor-1 ->> B` n'est pas une déclaration.
    const word = /^[A-Za-z]+(?=\s|:|$)/.exec(body)?.[0].toLowerCase() ?? ''
    const after = body.slice(word.length).trim()
    // Un mot-clé n'en est un que s'il n'est pas suivi d'une flèche (`end -> X` est un message d'un participant nommé « end »… refusé plus loin).
    const isMessage = readMessage(body) !== null && !(['title', 'note', 'participant', 'actor', 'database'] as string[]).includes(word)

    if (!isMessage && word === 'sequencediagram') return // l'en-tête d'un diagramme Mermaid collé tel quel
    if (!isMessage && word === 'title') {
      const t = after.replace(/^:\s*/, '')
      if (!t) return fail('« title » demande un texte.')
      doc.title = t
      return
    }
    if (!isMessage && word === 'autonumber') {
      doc.autonumber = true
      return
    }
    if (word === 'participant' || word === 'actor' || word === 'database') {
      const m = /^(\S+)(?:\s+as\s+(.+))?$/i.exec(after)
      if (!m) return fail(`« ${word} » demande un nom : « ${word} API » ou « ${word} API as Serveur web ».`)
      const name = unquote(m[1])
      if (!isValidName(name)) return fail(`Nom de participant invalide : « ${name} » (lettres, chiffres, _ . - ; sans espace ni mot réservé).`)
      const label = m[2] ? unquote(m[2]) : ''
      const existing = byName.get(canon(name))
      if (existing && !implicit.has(existing.name)) return fail(`Le participant « ${name} » est déjà déclaré.`)
      const kind = word as ParticipantKind
      if (existing) {
        existing.kind = kind
        if (label && label !== existing.name) existing.label = label
        implicit.delete(existing.name)
      } else {
        const p: Participant = { name, kind, ...(label && label !== name ? { label } : {}) }
        byName.set(name, p)
        doc.participants.push(p)
      }
      return
    }
    if (word === 'note') {
      const m = /^note\s+(left\s+of|right\s+of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(body)
      if (!m) return fail('Note attendue : « Note over A, B: texte », « Note right of A: texte » ou « Note left of A: texte ».')
      const position = m[1].toLowerCase().startsWith('left') ? 'left' : m[1].toLowerCase().startsWith('right') ? 'right' : 'over'
      const names = m[2].split(',').map((n) => n.trim()).filter(Boolean)
      if (position !== 'over' && names.length !== 1) return fail('Une note à gauche ou à droite concerne un seul participant.')
      if (names.length < 1 || names.length > 2) return fail('Une note concerne un ou deux participants.')
      if (!names.every((n) => ensure(n, line))) return
      current().push({ id: makeId(), kind: 'note', position: position as NotePosition, participants: [...new Set(names.map(canon))], text: decode(m[3]) })
      return
    }
    if (!isMessage && (BLOCK_TYPES as string[]).includes(word)) {
      const block: SeqBlock = { id: makeId(), kind: 'block', type: word as BlockType, sections: [{ id: makeId(), ...(after ? { label: after } : {}), items: [] }] }
      current().push(block)
      stack.push({ block, line })
      return
    }
    if (!isMessage && ['else', 'and', 'option'].includes(word)) {
      const top = stack.at(-1)
      if (!top) return fail(`« ${word} » doit se trouver dans un bloc.`)
      if (SECTION_WORD[top.block.type] !== word) {
        return fail(top.block.type in SECTION_WORD ? `Dans un « ${top.block.type} », la section suivante s'écrit « ${SECTION_WORD[top.block.type]} ».` : `Un « ${top.block.type} » n'a pas de section « ${word} ».`)
      }
      const section: BlockSection = { id: makeId(), ...(after ? { label: after } : {}), items: [] }
      top.block.sections.push(section)
      return
    }
    if (!isMessage && word === 'end' && !after) {
      if (!stack.length) return fail('« end » ne ferme aucun bloc.')
      stack.pop()
      return
    }
    if (!isMessage && (word === 'activate' || word === 'deactivate')) {
      const name = canon(unquote(after))
      const last = current().at(-1)
      if (!after || !byName.has(name)) return fail(`« ${word} » demande un participant connu.`)
      if (word === 'activate' && last?.kind === 'message' && last.to === name) last.activate = true
      else if (word === 'deactivate' && last?.kind === 'message' && last.from === name) last.deactivate = true
      else fail(`« ${word} ${name} » doit suivre un message ${word === 'activate' ? `vers ${name}` : `envoyé par ${name}`} (ou s'écrire avec + / - après la flèche).`)
      return
    }
    if (!isMessage && ['rect', 'box', 'create', 'destroy', 'link', 'links'].includes(word)) return fail(`« ${word} » n'est pas géré.`)

    const msg = readMessage(body)
    if (!msg) return fail('Ligne non reconnue : message « A ->> B: texte », note, bloc (alt, opt, loop, par, critical, break) ou « participant ».')
    if (!ensure(msg.from, line) || !ensure(msg.to, line)) return
    const message: SeqMessage = {
      id: makeId(), kind: 'message', from: canon(msg.from), to: canon(msg.to), text: msg.text, arrow: msg.arrow,
      ...(msg.activate ? { activate: true } : {}),
      ...(msg.deactivate ? { deactivate: true } : {}),
    }
    current().push(message)
  })

  for (const f of stack) errors.push({ line: f.line, message: `Le bloc « ${f.block.type} » n'est pas fermé : ajoutez « end ».` })
  return { doc, errors }
}

// --- Écriture ------------------------------------------------------------------

function writeItems(items: SeqItem[], depth: number, out: string[]) {
  const pad = '  '.repeat(depth)
  for (const item of items) {
    if (item.kind === 'message') {
      const flag = item.activate ? '+' : item.deactivate ? '-' : ''
      out.push(`${pad}${item.from} ${ARROW_TOKEN[item.arrow]}${flag} ${item.to}${item.text ? `: ${encode(item.text)}` : ''}`)
    } else if (item.kind === 'note') {
      const where = item.position === 'over' ? `over ${item.participants.join(', ')}` : `${item.position} of ${item.participants[0]}`
      out.push(`${pad}Note ${where}: ${encode(item.text)}`)
    } else {
      item.sections.forEach((s, i) => {
        const word = i === 0 ? item.type : SECTION_WORD[item.type]!
        out.push(`${pad}${word}${s.label ? ` ${s.label}` : ''}`)
        writeItems(s.items, depth + 1, out)
      })
      out.push(`${pad}end`)
    }
  }
}

export function seqToText(doc: SeqDocument): string {
  const blocks: string[][] = []
  const head: string[] = []
  if (doc.title) head.push(`title ${doc.title}`)
  if (doc.autonumber) head.push('autonumber')
  if (head.length) blocks.push(head)
  if (doc.participants.length) blocks.push(doc.participants.map((p) => `${p.kind} ${p.name}${p.label ? ` as ${p.label}` : ''}`))
  if (doc.items.length) {
    const body: string[] = []
    writeItems(doc.items, 0, body)
    blocks.push(body)
  }
  return blocks.map((b) => b.join('\n')).join('\n\n')
}

// --- Fusion --------------------------------------------------------------------

/**
 * Réapplique un texte sur un document existant : un élément inchangé (même message, même note, même bloc) garde son
 * identifiant, donc sa sélection, à travers les saisies. Les éléments identiques sont appariés dans l'ordre.
 */
export function mergeSeq(existing: SeqDocument, fresh: SeqDocument): SeqDocument {
  const key = (it: SeqItem) =>
    it.kind === 'message' ? `m|${it.from}|${it.to}|${it.arrow}|${it.text}` : it.kind === 'note' ? `n|${it.position}|${it.participants.join(',')}|${it.text}` : `b|${it.type}|${blockLabel(it)}`
  const pool = new Map<string, SeqItem[]>()
  const collect = (items: SeqItem[]) => {
    for (const it of items) {
      pool.set(key(it), [...(pool.get(key(it)) ?? []), it])
      if (it.kind === 'block') it.sections.forEach((s) => collect(s.items))
    }
  }
  collect(existing.items)

  const reuse = (items: SeqItem[]): SeqItem[] =>
    items.map((it) => {
      const old = pool.get(key(it))?.shift()
      if (it.kind !== 'block') return old ? { ...it, id: old.id } : it
      const oldBlock = old?.kind === 'block' ? old : undefined
      return {
        ...it,
        id: old?.id ?? it.id,
        sections: it.sections.map((s, i) => ({ ...s, id: oldBlock?.sections[i]?.id ?? s.id, items: reuse(s.items) })),
      }
    })
  return { ...fresh, items: reuse(fresh.items) }
}
