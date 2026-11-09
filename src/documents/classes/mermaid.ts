/** Export Mermaid : un bloc `classDiagram` à coller dans un README GitHub, GitLab, Notion ou un wiki. */
import { KIND_STEREOTYPE, REL_TOKEN, type ClassDocument } from './model'

/** Une accolade dans un membre fermerait le bloc de la classe : on la retire. */
const member = (s: string) => s.replace(/[{}]/g, '')

export function classesToMermaid(doc: ClassDocument): string {
  const out: string[] = []
  if (doc.title) out.push('---', `title: ${doc.title.replace(/\n/g, ' ')}`, '---')
  out.push('classDiagram')
  for (const c of doc.classes) {
    const stereo = KIND_STEREOTYPE[c.kind]
    out.push(`    class ${c.name} {`)
    if (stereo) out.push(`        <<${stereo}>>`)
    for (const l of [...c.attributes, ...c.methods]) out.push(`        ${member(l)}`)
    out.push('    }')
  }
  for (const r of doc.relations) {
    const parts = [r.to, ...(r.toMult ? [`"${r.toMult}"`] : []), REL_TOKEN[r.type].left, ...(r.fromMult ? [`"${r.fromMult}"`] : []), r.from]
    out.push(`    ${parts.join(' ')}${r.label ? ` : ${r.label.replace(/\n/g, ' ')}` : ''}`)
  }
  return `${out.join('\n')}\n`
}
