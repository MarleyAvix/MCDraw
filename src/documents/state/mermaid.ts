/** Export Mermaid : un bloc `stateDiagram-v2` à coller dans un README GitHub, GitLab, Notion ou un wiki. */
import { PSEUDO, isComposite, transitionLabel, type Container, type StateDocument } from './model'
import { exportIds } from './exportIds'

/** Texte sûr dans Mermaid : `;` et `#` ont un sens, les retours à la ligne passent par `<br/>`. */
const esc = (s: string) => s.replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;')).replace(/\r?\n/g, '<br/>')

export function stateToMermaid(doc: StateDocument): string {
  const ids = exportIds(doc)
  const id = (n: string) => (n === PSEUDO ? PSEUDO : (ids.get(n) ?? n))
  const out: string[] = []
  if (doc.title) out.push('---', `title: ${doc.title.replace(/\n/g, ' ')}`, '---')
  out.push('stateDiagram-v2')
  if (doc.direction === 'LR') out.push('    direction LR')

  const write = (c: Container, depth: number) => {
    const pad = '    '.repeat(depth + 1)
    for (const s of c.states) {
      const sid = id(s.name)
      if (s.label && s.label !== sid) out.push(`${pad}state "${esc(s.label).replace(/"/g, "'")}" as ${sid}`)
      if (s.kind !== 'state') out.push(`${pad}state ${sid} <<${s.kind}>>`)
      if (isComposite(s)) {
        out.push(`${pad}state ${sid} {`)
        write(s, depth + 1)
        out.push(`${pad}}`)
      } else if (!(s.label && s.label !== sid) && s.kind === 'state' && !(s.actions?.length) && !s.note && !c.transitions.some((t) => t.from === s.name || t.to === s.name)) {
        out.push(`${pad}${sid}`) // un état isolé n'existe dans Mermaid que s'il est cité
      }
      for (const a of s.actions ?? []) out.push(`${pad}${sid} : ${esc(a)}`)
      if (s.note) out.push(`${pad}note right of ${sid} : ${esc(s.note)}`)
    }
    for (const t of c.transitions) {
      const label = transitionLabel(t)
      out.push(`${pad}${id(t.from)} --> ${id(t.to)}${label ? ` : ${esc(label)}` : ''}`)
    }
  }
  write(doc, 0)
  return `${out.join('\n')}\n`
}
