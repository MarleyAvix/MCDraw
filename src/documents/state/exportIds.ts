import { walkStates, type StateDocument } from './model'

/**
 * Identifiants des états dans les langages d'export : lettres, chiffres et `_` uniquement (Mermaid et PlantUML s'étranglent
 * sur `-` et `.`), uniques même quand deux noms n'en font plus qu'un. Le nom d'origine devient le libellé.
 */
export function exportIds(doc: StateDocument): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  walkStates(doc, ({ state }) => {
    const base = state.name.replace(/[^\p{L}\p{N}_]/gu, '_')
    let id = base
    for (let n = 2; taken.has(id.toLowerCase()); n++) id = `${base}_${n}`
    taken.add(id.toLowerCase())
    out.set(state.name, id)
  })
  return out
}
