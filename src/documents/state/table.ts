/** Tableau des transitions : une ligne par état, une colonne par événement. Les cases vides sont les cas non traités. */
import { PSEUDO, stateLabel, walkStates, walkTransitions, type StateDocument, type Transition } from './model'

export const AUTO = '(automatique)'

export interface TableRow {
  name: string
  label: string
  depth: number
  /** Une cellule par événement : ce que la transition fait (`Cible [garde] / action`). */
  cells: string[][]
}
export interface TransitionTable {
  events: string[]
  rows: TableRow[]
}

const target = (t: Transition) => `${t.to === PSEUDO ? '◉ fin' : t.to}${t.guard ? ` [${t.guard}]` : ''}${t.action ? ` / ${t.action}` : ''}`

export function transitionTable(doc: StateDocument): TransitionTable {
  const all: Transition[] = []
  walkTransitions(doc, ({ t }) => all.push(t))
  const events: string[] = []
  for (const t of all) {
    const e = t.event ?? AUTO
    if (!events.includes(e)) events.push(e)
  }
  // La colonne des transitions sans événement passe en dernier.
  events.sort((a, b) => Number(a === AUTO) - Number(b === AUTO))

  const rows: TableRow[] = []
  const row = (name: string, label: string, depth: number) => {
    rows.push({ name, label, depth, cells: events.map((e) => all.filter((t) => t.from === name && (t.event ?? AUTO) === e).map(target)) })
  }
  if (all.some((t) => t.from === PSEUDO)) row(PSEUDO, '● début', 0)
  walkStates(doc, ({ state, depth }) => {
    if (state.kind === 'choice' || state.kind === 'fork' || state.kind === 'join') return
    row(state.name, stateLabel(state), depth)
  })
  return { events, rows }
}

const csvCell = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function tableToCsv(t: TransitionTable): string {
  const lines = [['État', ...t.events].map(csvCell).join(',')]
  for (const r of t.rows) lines.push([`${'  '.repeat(r.depth)}${r.label}`, ...r.cells.map((c) => c.join(' | '))].map(csvCell).join(','))
  return `${lines.join('\n')}\n`
}

export function tableToMarkdown(t: TransitionTable): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  const lines = [`| État | ${t.events.map(cell).join(' | ')} |`, `| --- | ${t.events.map(() => '---').join(' | ')} |`]
  for (const r of t.rows) lines.push(`| ${'· '.repeat(r.depth)}${cell(r.label)} | ${r.cells.map((c) => cell(c.join('<br>')) || '—').join(' | ')} |`)
  return `${lines.join('\n')}\n`
}
