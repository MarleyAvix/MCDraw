/** Export PlantUML : un fichier `.puml` pour les outils qui ne lisent pas Mermaid. */
import { PSEUDO, isComposite, transitionLabel, type Container, type StateDocument } from './model'
import { exportIds } from './exportIds'

const one = (s: string) => s.replace(/\r?\n/g, '\n')

export function stateToPlantUml(doc: StateDocument): string {
  const ids = exportIds(doc)
  const id = (n: string) => (n === PSEUDO ? PSEUDO : (ids.get(n) ?? n))
  const out: string[] = ['@startuml']
  if (doc.title) out.push(`title ${doc.title.replace(/\n/g, ' ')}`)
  if (doc.direction === 'LR') out.push('left to right direction')

  const write = (c: Container, depth: number) => {
    const pad = '  '.repeat(depth)
    for (const s of c.states) {
      const sid = id(s.name)
      const label = s.label && s.label !== sid ? `state "${one(s.label).replace(/"/g, "'")}" as ${sid}` : `state ${sid}`
      const kind = s.kind !== 'state' ? ` <<${s.kind}>>` : ''
      if (isComposite(s)) {
        out.push(`${pad}${label} {`)
        write(s, depth + 1)
        out.push(`${pad}}`)
      } else out.push(`${pad}${label}${kind}`)
      for (const a of s.actions ?? []) out.push(`${pad}${sid} : ${one(a)}`)
      if (s.note) out.push(`${pad}note right of ${sid} : ${one(s.note)}`)
    }
    for (const t of c.transitions) {
      const label = transitionLabel(t)
      out.push(`${pad}${id(t.from)} --> ${id(t.to)}${label ? ` : ${one(label)}` : ''}`)
    }
  }
  write(doc, 0)
  out.push('@enduml')
  return `${out.join('\n')}\n`
}
