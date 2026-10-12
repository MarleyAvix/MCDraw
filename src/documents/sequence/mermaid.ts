/** Export Mermaid : un bloc `sequenceDiagram` à coller dans un README GitHub, GitLab, Notion ou un wiki. */
import { ARROW_TOKEN, SECTION_WORD, type SeqDocument, type SeqItem } from './model'
import { exportIds } from './exportIds'

/** Texte sûr dans Mermaid : `;` et `#` ont un sens, les retours à la ligne passent par `<br/>`. */
const esc = (s: string) => s.replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;')).replace(/\r?\n/g, '<br/>')

export function seqToMermaid(doc: SeqDocument): string {
  const ids = exportIds(doc)
  const id = (name: string) => ids.get(name) ?? name
  const out: string[] = []
  if (doc.title) out.push('---', `title: ${doc.title.replace(/\n/g, ' ')}`, '---')
  out.push('sequenceDiagram')
  if (doc.autonumber) out.push('    autonumber')
  for (const p of doc.participants) {
    const label = p.label ?? p.name
    // Mermaid ne connaît que `participant` et `actor` : une base de données s'affiche comme un participant.
    out.push(`    ${p.kind === 'actor' ? 'actor' : 'participant'} ${id(p.name)}${label !== id(p.name) ? ` as ${esc(label)}` : ''}`)
  }

  const write = (items: SeqItem[], depth: number) => {
    const pad = '    '.repeat(depth + 1)
    for (const it of items) {
      if (it.kind === 'message') {
        const flag = it.activate ? '+' : it.deactivate ? '-' : ''
        out.push(`${pad}${id(it.from)}${ARROW_TOKEN[it.arrow]}${flag}${id(it.to)}: ${esc(it.text)}`.trimEnd())
      } else if (it.kind === 'note') {
        const where = it.position === 'over' ? `over ${it.participants.map(id).join(',')}` : `${it.position} of ${id(it.participants[0])}`
        out.push(`${pad}Note ${where}: ${esc(it.text)}`)
      } else {
        it.sections.forEach((s, i) => {
          const word = i === 0 ? it.type : SECTION_WORD[it.type]!
          out.push(`${pad}${word}${s.label ? ` ${esc(s.label)}` : ''}`)
          write(s.items, depth + 1)
        })
        out.push(`${pad}end`)
      }
    }
  }
  write(doc.items, 0)
  return `${out.join('\n')}\n`
}
