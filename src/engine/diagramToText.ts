import { meriseToDiagram, umlMultiplicity, type Diagram, type DiagramEdge, type DiagramNode } from './meriseToDiagram'
import { uniqueName } from './naming'
import type { Cardinality, MeriseSchema } from '../types/schema'

export type DiagramLanguage = 'mermaid' | 'plantuml'
/** `erd` : pattes de corbeau ; `uml` : diagramme de classes. */
export type DiagramNotation = 'erd' | 'uml'

export interface DiagramTextOptions {
  language: DiagramLanguage
  notation: DiagramNotation
  /** Entoure le diagramme d'un bloc de code Markdown (```mermaid / ```plantuml), prêt à coller dans un README. */
  fence?: boolean
}

export const LANGUAGE_LABELS: Record<DiagramLanguage, string> = { mermaid: 'Mermaid', plantuml: 'PlantUML' }
export const NOTATION_LABELS: Record<DiagramNotation, string> = {
  erd: 'ERD — pattes de corbeau',
  uml: 'UML — diagramme de classes',
}

// Pattes de corbeau : symbole à gauche / à droite du trait (même syntaxe en Mermaid et en PlantUML).
const CROW_LEFT: Record<Cardinality, string> = { '0,1': '|o', '1,1': '||', '0,n': '}o', '1,n': '}|' }
const CROW_RIGHT: Record<Cardinality, string> = { '0,1': 'o|', '1,1': '||', '0,n': 'o{', '1,n': '|{' }

/** Identifiant sûr pour les deux langages : sans accents ni espaces. */
function ident(label: string, fallback: string): string {
  let s = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!s) s = fallback
  if (/^\d/.test(s)) s = `_${s}`
  return s
}

function nodeNames(d: Diagram): Map<string, string> {
  const used = new Set<string>()
  const names = new Map<string, string>()
  for (const n of d.nodes) {
    const name = uniqueName(ident(n.name, 'Sans_nom'), used)
    used.add(name)
    names.set(n.id, name)
  }
  return names
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').replace(/"/g, "'").trim()
const baseType = (t: string) => t.replace(/\(.*\)/, '')
const withPrefix = (lines: string[], prefix: string) => lines.map((l) => prefix + l)

function mermaidEr(d: Diagram, nm: Map<string, string>): string[] {
  const out = ['erDiagram']
  for (const n of d.nodes) {
    if (!n.attributes.length) {
      out.push(`  ${nm.get(n.id)}`)
      continue
    }
    out.push(`  ${nm.get(n.id)} {`)
    for (const a of n.attributes) {
      out.push(`    ${a.type.replace(/,/g, '_').replace(/\s+/g, '')} ${ident(a.name, 'attribut')}${a.isPrimaryKey ? ' PK' : ''}`)
    }
    out.push('  }')
  }
  for (const e of d.edges) {
    const [s, t] = [nm.get(e.source), nm.get(e.target)]
    if (e.variant === 'inheritance') {
      out.push(`  ${t} ||--o| ${s} : "est un"`)
    } else if (e.variant !== 'classLink') {
      out.push(`  ${s} ${CROW_LEFT[e.sourceEnd ?? '1,1']}--${CROW_RIGHT[e.targetEnd ?? '1,1']} ${t} : "${oneLine(e.label ?? '')}"`)
    }
  }
  return out
}

/** Multiplicité d'une extrémité, précédée du rôle éventuel : `"parent 0..*"`. */
function umlEnd(card: Cardinality | undefined, role: string | undefined): string {
  const text = [role ? oneLine(role) : '', card ? umlMultiplicity(card) : ''].filter(Boolean).join(' ')
  return text ? ` "${text}"` : ''
}

function umlAssociation(e: DiagramEdge, s: string, t: string): string {
  return `${s}${umlEnd(e.sourceEnd, e.sourceRole)} --${umlEnd(e.targetEnd, e.targetRole)} ${t}${e.label ? ` : ${oneLine(e.label)}` : ''}`
}

function mermaidClass(d: Diagram, nm: Map<string, string>): string[] {
  const out = ['classDiagram']
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  for (const n of d.nodes) {
    const notes = [n.kind === 'entity' ? '' : '<<association>>', n.weak ? '<<weak>>' : ''].filter(Boolean)
    const members = n.attributes.map((a) => `+${baseType(a.type)} ${ident(a.name, 'attribut')}${a.isPrimaryKey ? ' PK' : ''}`)
    if (!notes.length && !members.length) {
      out.push(`  class ${nm.get(n.id)}`)
      continue
    }
    out.push(`  class ${nm.get(n.id)} {`, ...withPrefix([...notes, ...members], '    '), '  }')
  }
  for (const e of d.edges) {
    const [s, t] = [nm.get(e.source), nm.get(e.target)]
    if (e.variant === 'inheritance') out.push(`  ${t} <|-- ${s}`)
    else if (e.variant === 'classLink') {
      // Mermaid ne sait pas accrocher une classe d'association à un trait : lien pointillé vers chaque extrémité.
      for (const id of e.anchor ?? [e.target]) out.push(`  ${s} .. ${nm.get(id)}`)
    } else out.push(`  ${umlAssociation(e, s!, t!)}`)
  }
  if (byId.size === 0) out.push('  %% Schéma vide')
  return out
}

function pumlHeader(n: DiagramNode, keyword: string, name: string): string {
  const alias = n.name.trim() && n.name.trim() !== name ? `"${oneLine(n.name)}" as ${name}` : name
  return `${keyword} ${alias}${n.weak ? ' <<weak>>' : ''}`
}

function plantUmlEr(d: Diagram, nm: Map<string, string>): string[] {
  const out = ['@startuml', 'hide circle']
  for (const n of d.nodes) {
    const head = pumlHeader(n, 'entity', nm.get(n.id)!)
    if (!n.attributes.length) {
      out.push(head)
      continue
    }
    const pk = n.attributes.filter((a) => a.isPrimaryKey)
    const others = n.attributes.filter((a) => !a.isPrimaryKey)
    out.push(
      `${head} {`,
      ...withPrefix(pk.map((a) => `* ${ident(a.name, 'attribut')} : ${a.type} <<PK>>`), '  '),
      ...(pk.length && others.length ? ['  --'] : []),
      ...withPrefix(others.map((a) => `${ident(a.name, 'attribut')} : ${a.type}`), '  '),
      '}',
    )
  }
  for (const e of d.edges) {
    const [s, t] = [nm.get(e.source), nm.get(e.target)]
    if (e.variant === 'inheritance') out.push(`${t} ||--o| ${s} : est un`)
    else if (e.variant !== 'classLink') {
      out.push(`${s} ${CROW_LEFT[e.sourceEnd ?? '1,1']}--${CROW_RIGHT[e.targetEnd ?? '1,1']} ${t}${e.label ? ` : ${oneLine(e.label)}` : ''}`)
    }
  }
  out.push('@enduml')
  return out
}

function plantUmlClass(d: Diagram, nm: Map<string, string>): string[] {
  const out = ['@startuml', 'hide circle']
  for (const n of d.nodes) {
    const name = nm.get(n.id)!
    if (n.kind === 'diamond') {
      out.push(`diamond ${name}`)
      continue
    }
    const head = pumlHeader(n, 'class', name)
    if (!n.attributes.length) {
      out.push(head)
      continue
    }
    out.push(
      `${head} {`,
      ...withPrefix(n.attributes.map((a) => `+${ident(a.name, 'attribut')} : ${a.type}${a.isPrimaryKey ? ' <<PK>>' : ''}`), '  '),
      '}',
    )
  }
  for (const e of d.edges) {
    const [s, t] = [nm.get(e.source), nm.get(e.target)]
    if (e.variant === 'inheritance') out.push(`${t} <|-- ${s}`)
    else if (e.variant === 'classLink') out.push(`(${(e.anchor ?? []).map((id) => nm.get(id)).join(', ')}) .. ${s}`)
    else out.push(umlAssociation(e, s!, t!))
  }
  out.push('@enduml')
  return out
}

/** Texte Mermaid ou PlantUML décrivant le MCD (vue ERD ou UML), à coller dans un README ou un wiki. */
export function diagramToText(schema: MeriseSchema, { language, notation, fence = false }: DiagramTextOptions): string {
  const diagram = meriseToDiagram(schema, notation)
  const names = nodeNames(diagram)
  const lines =
    language === 'mermaid'
      ? notation === 'erd' ? mermaidEr(diagram, names) : mermaidClass(diagram, names)
      : notation === 'erd' ? plantUmlEr(diagram, names) : plantUmlClass(diagram, names)
  const text = lines.join('\n')
  return fence ? `\`\`\`${language}\n${text}\n\`\`\`` : text
}
