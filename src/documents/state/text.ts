/**
 * Saisie textuelle d'un diagramme d'états, volontairement proche de Mermaid (`stateDiagram-v2` collé tel quel fonctionne) :
 *
 *   title Cycle d'une commande
 *   direction LR
 *
 *   state Panier
 *   state "Paiement en cours" as Paiement
 *   state Contrôle <<choice>>
 *   state Livraison {
 *     state Préparation
 *     [*] --> Préparation
 *   }
 *
 *   [*] --> Panier
 *   Panier : entrée / calculer le total
 *   Panier --> Paiement : payer [panier non vide] / réserver le stock
 *   Livrée --> [*]
 *   note right of Panier : texte
 *
 * Une transition s'écrit `A --> B : événement [garde] / action` (chaque partie est facultative) ; `[*]` est l'état initial
 * (à gauche) ou final (à droite) du bloc. Un état peut être déclaré (`state`) ou apparaître directement dans une transition :
 * il est alors créé dans le bloc courant. Une ligne `Nom : texte` ajoute une ligne d'action sous le nom de l'état.
 * Commentaires : `%%` ou `//` en début de ligne. `<br>` dans un texte fait un retour à la ligne.
 */
import {
  PSEUDO,
  STATE_KINDS,
  isComposite,
  isValidName,
  type Container,
  type Direction,
  type ParseError,
  type StateDocument,
  type StateKind,
  type StateNode,
  type Transition,
} from './model'

/** Texte saisi → texte du modèle (`<br>` et entités Mermaid décodés). */
const decode = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).trim()
/** Texte du modèle → une ligne de saisie. */
const encode = (s: string) => s.replace(/\r?\n/g, '<br/>')

/** `événement [garde] / action` → ses trois parties. */
export function parseLabel(label: string): Pick<Transition, 'event' | 'guard' | 'action'> {
  const m = /^\s*([^[/]*?)\s*(?:\[([^\]]*)\])?\s*(?:\/\s*([\s\S]*))?$/.exec(label)
  const part = (v: string | undefined) => (v ? decode(v) : '')
  const [event, guard, action] = [part(m?.[1]), part(m?.[2]), part(m?.[3])]
  return { ...(event ? { event } : {}), ...(guard ? { guard } : {}), ...(action ? { action } : {}) }
}

/** `événement [garde] / action` : la partie qui suit « : » dans une transition saisie. */
const writeLabel = (t: Pick<Transition, 'event' | 'guard' | 'action'>) => encode([t.event, t.guard ? `[${t.guard}]` : '', t.action ? `/ ${t.action}` : ''].filter(Boolean).join(' '))

export function parseStateText(text: string, makeId: () => string): { doc: StateDocument; errors: ParseError[] } {
  const doc: StateDocument = { states: [], transitions: [] }
  const errors: ParseError[] = []
  /** Blocs ouverts : la racine, puis chaque composite en cours. */
  const stack: { owner?: StateNode; container: Container; line: number }[] = [{ container: doc, line: 0 }]
  const top = () => stack[stack.length - 1]
  /** Tous les états connus, par nom en minuscules : le bloc qui les contient et s'ils ont été créés par une simple référence. */
  const known = new Map<string, { state: StateNode; container: Container; implicit: boolean }>()
  /** Note multi-ligne en cours de lecture (jusqu'à « end note »). */
  const pending: { note: { name: string; lines: string[]; line: number } | null } = { note: null }

  /** Trouve ou crée l'état `name` dans le bloc courant ; `null` (et une erreur) s'il est interdit ou vit dans un autre bloc. */
  const ensure = (name: string, line: number): StateNode | null => {
    const have = known.get(name.toLowerCase())
    if (have) {
      if (have.container !== top().container) {
        errors.push({ line, message: `L'état « ${have.state.name} » appartient à un autre bloc : une transition relie des états du même bloc.` })
        return null
      }
      return have.state
    }
    if (!isValidName(name)) {
      errors.push({ line, message: `Nom d'état invalide : « ${name} » (lettres, chiffres, _ . - ; sans espace ni mot réservé).` })
      return null
    }
    const state: StateNode = { name, kind: 'state' }
    top().container.states.push(state)
    known.set(name.toLowerCase(), { state, container: top().container, implicit: true })
    return state
  }

  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = i + 1
    const body = raw.trim()
    const fail = (message: string) => void errors.push({ line, message })

    if (pending.note) {
      if (/^end\s+note$/i.test(body)) {
        const target = known.get(pending.note.name.toLowerCase())
        if (target) target.state.note = pending.note.lines.join('\n').trim() || undefined
        pending.note = null
      } else pending.note.lines.push(body)
      return
    }
    if (!body || body.startsWith('%%') || body.startsWith('//') || body === '---') return

    const word = /^[A-Za-z][A-Za-z0-9-]*(?=\s|:|$)/.exec(body)?.[0].toLowerCase() ?? ''
    const arrow = body.indexOf('-->')

    if (arrow < 0 && (word === 'statediagram' || word === 'statediagram-v2')) return // l'en-tête d'un diagramme Mermaid collé tel quel
    if (arrow < 0 && word === 'title') {
      const t = body.slice(5).trim().replace(/^:\s*/, '')
      if (!t) return fail('« title » demande un texte.')
      doc.title = t
      return
    }
    if (arrow < 0 && word === 'direction') {
      const d = body.slice(9).trim().toUpperCase()
      if (!['TB', 'TD', 'LR', 'BT', 'RL'].includes(d)) return fail('« direction » attend TB (haut → bas) ou LR (gauche → droite).')
      if (stack.length === 1) doc.direction = (d === 'LR' || d === 'RL' ? 'LR' : 'TB') as Direction
      return
    }
    if (arrow < 0 && ['classdef', 'class', 'style', 'hide', 'scale', 'acctitle', 'accdescr', 'click', 'link'].includes(word)) return fail(`« ${word} » n'est pas géré.`)
    if (body === '--' || body === '---') return fail('Les régions parallèles (« -- ») ne sont pas gérées.')

    if (body === '}') {
      if (stack.length === 1) return fail('« } » ne ferme aucun bloc.')
      stack.pop()
      return
    }

    // state "Libellé" as Nom {   |   state Nom <<choice>>   |   state Nom
    if (arrow < 0 && word === 'state') {
      const m = /^state\s+(?:"([^"]*)"\s+as\s+(\S+?)|(\S+?))\s*(?:<<\s*(\w+)\s*>>)?\s*(\{)?\s*$/i.exec(body)
      if (!m) return fail('Déclaration attendue : « state Nom », « state "Libellé" as Nom », « state Nom <<choice>> » ou « state Nom { ».')
      const label = m[1] ? m[1].trim() : ''
      const name = m[2] ?? m[3]
      const kindWord = m[4]?.toLowerCase()
      if (kindWord && !(STATE_KINDS as string[]).includes(kindWord)) return fail(`Type « <<${m[4]}>> » inconnu : choice, fork ou join.`)
      const have = known.get(name.toLowerCase())
      if (have && !have.implicit) return fail(`L'état « ${name} » est déjà déclaré.`)
      const state = ensure(name, line)
      if (!state) return
      known.get(name.toLowerCase())!.implicit = false
      if (label && label !== name) state.label = label
      if (kindWord) state.kind = kindWord as StateKind
      if (m[5]) {
        if (state.kind !== 'state') return fail('Un état de choix, fork ou join ne peut pas contenir d\'autres états.')
        state.states ??= []
        state.transitions ??= []
        stack.push({ owner: state, container: state as Container, line })
      }
      return
    }

    // note right of Nom : texte   |   note left of Nom (… end note)
    if (arrow < 0 && word === 'note') {
      const m = /^note\s+(?:left|right)\s+of\s+(\S+?)\s*(?::\s*(.*))?$/i.exec(body)
      if (!m) return fail('Note attendue : « note right of Nom : texte ».')
      if (!ensure(m[1], line)) return
      if (m[2] === undefined) pending.note = { name: m[1], lines: [], line }
      else known.get(m[1].toLowerCase())!.state.note = decode(m[2]) || undefined
      return
    }

    // A --> B : événement [garde] / action
    if (arrow >= 0) {
      const from = body.slice(0, arrow).trim()
      const after = body.slice(arrow + 3)
      const m = /^\s*(\S+?)\s*(?::([\s\S]*))?$/.exec(after)
      const to = m?.[1] ?? ''
      if (!from || !to) return fail('Transition attendue : « A --> B : événement [garde] / action ».')
      if (from === PSEUDO && to === PSEUDO) return fail('Une transition relie deux états, pas deux « [*] ».')
      const a = from === PSEUDO ? PSEUDO : ensure(from, line)?.name
      const b = to === PSEUDO ? PSEUDO : ensure(to, line)?.name
      if (!a || !b) return
      top().container.transitions.push({ id: makeId(), from: a, to: b, ...parseLabel(m?.[2] ?? '') })
      return
    }

    // Nom : texte  (une ligne d'action sous le nom de l'état)
    const act = /^(\S+?)\s*:\s*([\s\S]+)$/.exec(body)
    if (act) {
      const state = ensure(act[1], line)
      if (!state) return
      state.actions = [...(state.actions ?? []), decode(act[2])]
      return
    }
    fail('Ligne non reconnue : transition « A --> B : événement », « state Nom », « Nom : action » ou « note right of Nom : texte ».')
  })

  if (pending.note) errors.push({ line: pending.note.line, message: 'La note n\'est pas fermée : ajoutez « end note ».' })
  for (const f of stack.slice(1)) errors.push({ line: f.line, message: `Le bloc « ${f.owner?.name} » n'est pas fermé : ajoutez « } ».` })
  return { doc, errors }
}

// --- Écriture ------------------------------------------------------------------

function writeContainer(c: Container, depth: number, out: string[]) {
  const pad = '  '.repeat(depth)
  for (const s of c.states) {
    const kind = s.kind !== 'state' ? ` <<${s.kind}>>` : ''
    const head = s.label ? `state "${s.label}" as ${s.name}` : `state ${s.name}`
    if (isComposite(s)) {
      out.push(`${pad}${head} {`)
      writeContainer(s, depth + 1, out)
      out.push(`${pad}}`)
    } else out.push(`${pad}${head}${kind}`)
  }
  const extras = c.states.flatMap((s) => (s.actions ?? []).map((a) => `${pad}${s.name} : ${encode(a)}`).concat(s.note ? [`${pad}note right of ${s.name} : ${encode(s.note)}`] : []))
  const flow = c.transitions.map((t) => {
    const label = writeLabel(t)
    return `${pad}${t.from} --> ${t.to}${label ? ` : ${label}` : ''}`
  })
  if (extras.length) out.push(...extras)
  if (flow.length) {
    if (c.states.length) out.push('')
    out.push(...flow)
  }
}

export function stateToText(doc: StateDocument): string {
  const blocks: string[][] = []
  const head: string[] = []
  if (doc.title) head.push(`title ${doc.title}`)
  if (doc.direction === 'LR') head.push('direction LR')
  if (head.length) blocks.push(head)
  const body: string[] = []
  writeContainer(doc, 0, body)
  if (body.length) blocks.push(body)
  return blocks.map((b) => b.join('\n')).join('\n\n')
}

// --- Fusion --------------------------------------------------------------------

/**
 * Réapplique un texte sur un document existant : une transition inchangée garde son identifiant, donc sa sélection, à
 * travers les saisies. Les transitions identiques d'un même bloc sont appariées dans l'ordre.
 */
export function mergeState(existing: StateDocument, fresh: StateDocument): StateDocument {
  const key = (owner: string, t: Transition) => `${owner}|${t.from}|${t.to}|${t.event ?? ''}|${t.guard ?? ''}|${t.action ?? ''}`
  const pool = new Map<string, string[]>()
  const collect = (c: Container, owner: string) => {
    for (const t of c.transitions) pool.set(key(owner, t), [...(pool.get(key(owner, t)) ?? []), t.id])
    for (const s of c.states) if (isComposite(s)) collect(s, s.name)
  }
  collect(existing, '')
  const reuse = (c: Container, owner: string) => {
    c.transitions = c.transitions.map((t) => ({ ...t, id: pool.get(key(owner, t))?.shift() ?? t.id }))
    for (const s of c.states) if (isComposite(s)) reuse(s, s.name)
  }
  const out: StateDocument = JSON.parse(JSON.stringify(fresh))
  reuse(out, '')
  return out
}
