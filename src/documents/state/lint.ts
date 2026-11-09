/**
 * Remarques de conception d'un diagramme d'états : ce qui rend le comportement indéfini ou inatteignable.
 * Chaque remarque désigne un état (`s:Nom`) ou une transition (son identifiant) pour pouvoir y aller d'un clic.
 */
import { PSEUDO, isComposite, type Container, type StateDocument, type StateNode } from './model'

export type Severity = 'error' | 'warning'
export interface StateIssue {
  severity: Severity
  rule: string
  message: string
  /** Élément concerné : `s:Nom` ou identifiant de transition. */
  key: string
}

export function lintState(doc: StateDocument): StateIssue[] {
  const issues: StateIssue[] = []
  const add = (severity: Severity, rule: string, message: string, key: string) => void issues.push({ severity, rule, message, key })

  const visit = (c: Container, owner: StateNode | undefined, exitsInherited: boolean) => {
    const where = owner ? ` (dans « ${owner.name} »)` : ''
    const starts = c.transitions.filter((t) => t.from === PSEUDO)
    const hasEnd = c.transitions.some((t) => t.to === PSEUDO)

    if (!c.states.length) {
      if (owner) add('warning', 'empty-composite', `Le bloc « ${owner.name} » ne contient aucun état.`, `s:${owner.name}`)
    } else if (!starts.length) {
      add(
        'warning',
        'no-initial',
        owner ? `Le bloc « ${owner.name} » n'a pas d'état initial : ajoutez « [*] --> État ».` : 'Aucun état initial : ajoutez « [*] --> État ».',
        owner ? `s:${owner.name}` : `s:${c.states[0].name}`,
      )
    }
    if (starts.filter((t) => !t.guard).length > 1) add('warning', 'many-initial', `Plusieurs transitions initiales sans condition${where} : l'état de départ est ambigu.`, starts[1].id)

    // Accessibilité depuis l'état initial (seulement s'il y en a un).
    if (starts.length) {
      const seen = new Set<string>()
      const queue = starts.map((t) => t.to).filter((n) => n !== PSEUDO)
      while (queue.length) {
        const n = queue.pop()!
        if (seen.has(n)) continue
        seen.add(n)
        for (const t of c.transitions) if (t.from === n && t.to !== PSEUDO) queue.push(t.to)
      }
      for (const s of c.states) if (!seen.has(s.name)) add('warning', 'unreachable', `« ${s.name} » est inaccessible depuis l'état initial${where}.`, `s:${s.name}`)
    }

    for (const s of c.states) {
      const out = c.transitions.filter((t) => t.from === s.name)
      const into = c.transitions.filter((t) => t.to === s.name)
      if (s.kind === 'choice') {
        if (!out.length) add('error', 'choice-no-exit', `Le choix « ${s.name} » n'a aucune sortie.`, `s:${s.name}`)
        else if (out.length === 1) add('warning', 'choice-one-exit', `Le choix « ${s.name} » n'a qu'une sortie : ce n'est pas un choix.`, `s:${s.name}`)
        else if (out.some((t) => !t.guard)) add('warning', 'choice-guards', `Les sorties du choix « ${s.name} » ont besoin d'une condition [garde].`, out.find((t) => !t.guard)!.id)
        if (!into.length) add('warning', 'choice-no-entry', `Le choix « ${s.name} » n'est atteint par aucune transition.`, `s:${s.name}`)
      } else if (!out.length && hasEnd && !exitsInherited && !isComposite(s) && (s.kind === 'state' || s.kind === 'join')) {
        add('warning', 'dead-end', `« ${s.name} » n'a aucune transition sortante alors que le diagramme a un état final${where}.`, `s:${s.name}`)
      }
    }

    // Doublons, puis ambiguïtés : un même événement depuis un même état doit se départager par des gardes différentes.
    const exact = new Set<string>()
    const groups = new Map<string, typeof c.transitions>()
    for (const t of c.transitions) {
      const exactKey = [t.from, t.to, t.event ?? '', t.guard ?? '', t.action ?? ''].join('|')
      if (exact.has(exactKey)) {
        add('warning', 'duplicate', `Transition en double : « ${t.from} → ${t.to} »${t.event ? ` sur « ${t.event} »` : ''}.`, t.id)
        continue
      }
      exact.add(exactKey)
      if (t.from === PSEUDO || c.states.find((s) => s.name === t.from)?.kind === 'choice') continue
      const key = `${t.from}|${t.event ?? ''}`
      groups.set(key, [...(groups.get(key) ?? []), t])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const guards = group.map((t) => t.guard ?? '')
      if (new Set(guards).size < guards.length) {
        const t = group[0]
        add(
          'error',
          'ambiguous',
          t.event
            ? `Depuis « ${t.from} », l'événement « ${t.event} » mène à plusieurs états sans condition qui les départage.`
            : `Depuis « ${t.from} », plusieurs transitions automatiques n'ont pas de condition distincte.`,
          group[1].id,
        )
      }
    }

    for (const s of c.states) if (isComposite(s)) visit(s, s, exitsInherited || c.transitions.some((t) => t.from === s.name))
  }
  visit(doc, undefined, false)
  return issues
}
