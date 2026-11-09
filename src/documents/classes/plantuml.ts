/** Export PlantUML : un fichier `.puml` de diagramme de classes. */
import type { ClassDocument, ClassKind, RelType } from './model'

const KEYWORD: Record<ClassKind, string> = { class: 'class', abstract: 'abstract class', interface: 'interface', enum: 'enum' }
/** Flèche PlantUML où le symbole est du côté de `to` (écrit à gauche). */
const ARROW: Record<RelType, string> = { inheritance: '<|--', realization: '<|..', composition: '*--', aggregation: 'o--', association: '<--', dependency: '<..', link: '--' }

export function classesToPlantUml(doc: ClassDocument): string {
  const out: string[] = ['@startuml']
  if (doc.title) out.push(`title ${doc.title.replace(/\n/g, ' ')}`)
  for (const c of doc.classes) {
    out.push(`${KEYWORD[c.kind]} ${c.name} {`)
    for (const l of c.attributes) out.push(`  ${l}`)
    for (const l of c.methods) out.push(`  ${l}`)
    out.push('}')
  }
  for (const r of doc.relations) {
    const parts = [r.to, ...(r.toMult ? [`"${r.toMult}"`] : []), ARROW[r.type], ...(r.fromMult ? [`"${r.fromMult}"`] : []), r.from]
    out.push(`${parts.join(' ')}${r.label ? ` : ${r.label.replace(/\n/g, ' ')}` : ''}`)
  }
  out.push('@enduml')
  return `${out.join('\n')}\n`
}
