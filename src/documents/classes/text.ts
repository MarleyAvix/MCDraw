/**
 * Saisie texte d'un diagramme de classes, dans la syntaxe de Mermaid (`classDiagram`) : on peut y coller un diagramme existant.
 * `parseClassText` lit le texte (avec ses erreurs ligne par ligne), `classesToText` fait le chemin inverse.
 */
import { KIND_STEREOTYPE, REL_TOKEN, isValidName, type ClassBox, type ClassDocument, type ClassKind, type ParseError, type RelType, type Relation } from './model'

const NAME = '[\\p{L}_][\\p{L}\\p{N}_]*'
/** Symbole → (type, le symbole est-il du côté du premier nom ?). Le plus long d'abord pour que `<|--` ne soit pas pris pour `<--`. */
const TOKENS: { token: string; type: RelType; markerFirst: boolean }[] = (Object.entries(REL_TOKEN) as [RelType, { left: string; right?: string }][])
  .flatMap(([type, t]) => [{ token: t.left, type, markerFirst: true }, ...(t.right ? [{ token: t.right, type, markerFirst: false }] : [])])
  .sort((a, b) => b.token.length - a.token.length)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const REL = new RegExp(`^(${NAME})\\s+(?:"([^"]*)"\\s+)?(${TOKENS.map((t) => esc(t.token)).join('|')})\\s+(?:"([^"]*)"\\s+)?(${NAME})\\s*(?::\\s*(.*))?$`, 'u')
const STEREO = /^<<\s*(\p{L}+)\s*>>$/u
const KIND_BY_WORD: Record<string, ClassKind> = { abstract: 'abstract', interface: 'interface', enumeration: 'enum', enum: 'enum', service: 'class', entity: 'class' }

const isMethod = (line: string) => line.includes('(')

export function parseClassText(text: string): { doc: ClassDocument; errors: ParseError[] } {
  const doc: ClassDocument = { classes: [], relations: [] }
  const errors: ParseError[] = []
  const byName = new Map<string, ClassBox>()
  const ensure = (name: string): ClassBox => {
    let c = byName.get(name)
    if (!c) {
      c = { name, kind: 'class', attributes: [], methods: [] }
      byName.set(name, c)
      doc.classes.push(c)
    }
    return c
  }
  const addMember = (c: ClassBox, line: string) => (isMethod(line) ? c.methods : c.attributes).push(line)

  let open: ClassBox | null = null
  const all = text.split(/\r?\n/)
  all.forEach((raw, i) => {
    const n = i + 1
    const body = raw.trim()
    if (!body || body.startsWith('%%') || body.startsWith('//') || body === '---') return
    const err = (message: string) => void errors.push({ line: n, message })

    if (open) {
      if (body === '}') {
        open = null
        return
      }
      const st = body.match(STEREO)
      if (st) {
        const kind = KIND_BY_WORD[st[1].toLowerCase()]
        if (kind) open.kind = kind
        else err(`Stéréotype inconnu « ${st[1]} » (abstract, interface, enumeration).`)
        return
      }
      addMember(open, body)
      return
    }

    if (/^classDiagram\b/i.test(body) || /^direction\s/i.test(body)) return
    if (/^title:/i.test(body)) {
      doc.title = body.slice(6).trim() // en-tête de titre d'un export Mermaid
      return
    }
    const title = body.match(/^title\s+(.+)$/i)
    if (title) {
      doc.title = title[1].trim()
      return
    }

    const cls = body.match(new RegExp(`^class\\s+(${NAME})\\s*(<<[^>]*>>)?\\s*(\\{)?\\s*$`, 'u'))
    if (cls) {
      if (!isValidName(cls[1])) return err(`« ${cls[1]} » n'est pas un nom de classe valide.`)
      const c = ensure(cls[1])
      if (cls[2]) {
        const kind = KIND_BY_WORD[cls[2].match(STEREO)?.[1].toLowerCase() ?? '']
        if (kind) c.kind = kind
      }
      if (cls[3]) open = c
      return
    }

    const stereo = body.match(new RegExp(`^<<\\s*(\\p{L}+)\\s*>>\\s+(${NAME})$`, 'u'))
    if (stereo) {
      const kind = KIND_BY_WORD[stereo[1].toLowerCase()]
      if (!kind) return err(`Stéréotype inconnu « ${stereo[1]} » (abstract, interface, enumeration).`)
      ensure(stereo[2]).kind = kind
      return
    }

    const rel = body.match(REL)
    if (rel) {
      const [, a, am, token, bm, b, label] = rel
      const t = TOKENS.find((x) => x.token === token)!
      // Le symbole désigne le `to` : le premier nom s'il est de son côté, sinon le second.
      const [to, toMult, from, fromMult] = t.markerFirst ? [a, am, b, bm] : [b, bm, a, am]
      ensure(a)
      ensure(b)
      const r: Relation = { from, to, type: t.type }
      if (label?.trim()) r.label = label.trim()
      if (fromMult?.trim()) r.fromMult = fromMult.trim()
      if (toMult?.trim()) r.toMult = toMult.trim()
      doc.relations.push(r)
      return
    }

    const member = body.match(new RegExp(`^(${NAME})\\s*:\\s*(.+)$`, 'u'))
    if (member) {
      addMember(ensure(member[1]), member[2].trim())
      return
    }

    err(`Ligne non reconnue : « ${body.length > 40 ? `${body.slice(0, 40)}…` : body} ».`)
  })
  const unclosed = open as ClassBox | null
  if (unclosed) errors.push({ line: all.length, message: `Accolade fermante « } » manquante pour la classe ${unclosed.name}.` })
  return { doc, errors }
}

/** Écrit le document dans la syntaxe de `parseClassText`. */
export function classesToText(doc: ClassDocument): string {
  const out: string[] = ['classDiagram']
  if (doc.title) out.push(`title ${doc.title.replace(/\n/g, ' ')}`)
  for (const c of doc.classes) {
    const stereo = KIND_STEREOTYPE[c.kind]
    if (!c.attributes.length && !c.methods.length) {
      out.push(`class ${c.name}`)
      if (stereo) out.push(`<<${stereo}>> ${c.name}`)
      continue
    }
    out.push(`class ${c.name} {`)
    if (stereo) out.push(`  <<${stereo}>>`)
    for (const l of [...c.attributes, ...c.methods]) out.push(`  ${l}`)
    out.push('}')
  }
  for (const r of doc.relations) {
    const tok = REL_TOKEN[r.type].left
    // Forme « symbole à gauche » : `to` d'abord, puis `from`.
    const parts = [r.to, ...(r.toMult ? [`"${r.toMult}"`] : []), tok, ...(r.fromMult ? [`"${r.fromMult}"`] : []), r.from]
    out.push(parts.join(' ') + (r.label ? ` : ${r.label}` : ''))
  }
  return `${out.join('\n')}\n`
}
