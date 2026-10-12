import type { SeqDocument } from './model'

/**
 * Identifiants des participants dans les langages d'export : lettres, chiffres et `_` uniquement (Mermaid et PlantUML
 * s'étranglent sur `-` et `.`), uniques même quand deux noms n'en font plus qu'un. Le nom d'origine devient le libellé.
 */
export function exportIds(doc: SeqDocument): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const p of doc.participants) {
    const base = p.name.replace(/[^\p{L}\p{N}_]/gu, '_')
    let id = base
    for (let n = 2; taken.has(id.toLowerCase()); n++) id = `${base}_${n}`
    taken.add(id.toLowerCase())
    out.set(p.name, id)
  }
  return out
}
