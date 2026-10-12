/** Export PlantUML : un fichier `.puml` pour PlantUML, Confluence, IntelliJ ou le serveur en ligne. */
import type { Arrow, SeqDocument, SeqItem } from './model'
import { exportIds } from './exportIds'

const ARROW: Record<Arrow, string> = { sync: '->', reply: '-->', async: '->>', asyncReply: '-->>', lost: '->x' }
const KEYWORD = { participant: 'participant', actor: 'actor', database: 'database' } as const
/** Texte sur une ligne : PlantUML écrit un retour à la ligne `\n` (deux caractères). */
const one = (s: string) => s.replace(/\r?\n/g, '\\n')
const quote = (s: string) => `"${s.replace(/"/g, "'").replace(/\r?\n/g, ' ')}"`

export function seqToPlantUml(doc: SeqDocument): string {
  const ids = exportIds(doc)
  const id = (name: string) => ids.get(name) ?? name
  const out: string[] = ['@startuml']
  if (doc.title) out.push(`title ${one(doc.title)}`)
  if (doc.autonumber) out.push('autonumber')
  for (const p of doc.participants) out.push(`${KEYWORD[p.kind]} ${quote(p.label ?? p.name)} as ${id(p.name)}`)

  const write = (items: SeqItem[], depth: number) => {
    const pad = '  '.repeat(depth)
    for (const it of items) {
      if (it.kind === 'message') {
        const flag = it.activate ? ' ++' : it.deactivate ? ' --' : ''
        out.push(`${pad}${id(it.from)} ${ARROW[it.arrow]} ${id(it.to)}${flag}${it.text ? ` : ${one(it.text)}` : ''}`)
      } else if (it.kind === 'note') {
        const where = it.position === 'over' ? `over ${it.participants.map(id).join(', ')}` : `${it.position} of ${id(it.participants[0])}`
        out.push(`${pad}note ${where} : ${one(it.text)}`)
      } else {
        // PlantUML sépare toutes les sections par `else` (y compris `par` et `critical`).
        it.sections.forEach((s, i) => {
          out.push(`${pad}${i === 0 ? it.type : 'else'}${s.label ? ` ${one(s.label)}` : ''}`)
          write(s.items, depth + 1)
        })
        out.push(`${pad}end`)
      }
    }
  }
  write(doc.items, 0)
  out.push('@enduml')
  return `${out.join('\n')}\n`
}
