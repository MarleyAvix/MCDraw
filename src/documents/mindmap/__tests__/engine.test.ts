import { describe, expect, it } from 'vitest'
import {
  hiddenIds,
  layoutMindmap,
  mergeMindmap,
  mindmapToMarkdown,
  mindmapToOpml,
  mindmapToText,
  parseMindmapText,
  sanitizeMindmap,
} from '../engine'

const counter = () => {
  let n = 0
  return () => `n${++n}`
}

const TEXT = `Projet -- le cœur
  Équipe
    Alice
    Bob
  Budget
  Planning`

const parse = (t = TEXT) => parseMindmapText(t, counter())
const by = (text: string) => Object.fromEntries(parse(text).schema.nodes.map((n) => [n.text, n]))

describe('saisie texte', () => {
  it('construit l’arbre d’après l’indentation, avec la note', () => {
    const { schema, errors } = parse()
    expect(errors).toEqual([])
    const n = by(TEXT)
    expect(schema.nodes).toHaveLength(6)
    expect(n['Projet'].parentId).toBeUndefined()
    expect(n['Projet'].note).toBe('le cœur')
    expect(n['Équipe'].parentId).toBe(n['Projet'].id)
    expect(n['Bob'].parentId).toBe(n['Équipe'].id)
  })

  it('aller-retour texte → arbre → texte', () => {
    expect(mindmapToText(parse().schema)).toBe(TEXT)
  })

  it('ignore les puces Markdown, les commentaires et les lignes vides', () => {
    const { schema, errors } = parse('// carte\n- Centre\n  - A\n\n  * B')
    expect(errors).toEqual([])
    expect(schema.nodes.map((n) => n.text)).toEqual(['Centre', 'A', 'B'])
  })

  it('signale une première ligne indentée et une note sans texte', () => {
    expect(parse('  A').errors).toEqual([{ line: 1, message: expect.stringContaining('indentée') }])
    expect(parse('A\n  -- seule').errors[0].line).toBe(2)
  })
})

describe('fusion', () => {
  it('garde l’identifiant et l’état replié d’une idée dont le chemin est inchangé', () => {
    const existing = parse().schema
    existing.nodes.find((n) => n.text === 'Équipe')!.collapsed = true
    const merged = mergeMindmap(existing, parseMindmapText(TEXT + '\n  Risques', counter()).schema)
    const equipe = merged.nodes.find((n) => n.text === 'Équipe')!
    expect(equipe.id).toBe(existing.nodes.find((n) => n.text === 'Équipe')!.id)
    expect(equipe.collapsed).toBe(true)
    expect(merged.nodes.find((n) => n.text === 'Bob')!.parentId).toBe(equipe.id)
    expect(merged.nodes).toHaveLength(7)
  })
})

describe('repli', () => {
  it('masque les descendants d’une idée repliée mais pas l’idée elle-même', () => {
    const { nodes } = parse().schema
    const equipe = nodes.find((n) => n.text === 'Équipe')!
    equipe.collapsed = true
    const hidden = hiddenIds(nodes)
    expect([...hidden].sort()).toEqual(nodes.filter((n) => n.text === 'Alice' || n.text === 'Bob').map((n) => n.id).sort())
  })
})

describe('mise en page', () => {
  const size = { w: 100, h: 40 }
  const gap = { x: 20, y: 10 }
  const lay = (text = TEXT) => {
    const { nodes } = parse(text).schema
    return { nodes, ...layoutMindmap(nodes, size, gap) }
  }

  it('répartit les branches des deux côtés de l’idée centrale, dans l’ordre', () => {
    const { nodes, pos, side } = lay()
    const id = (t: string) => nodes.find((n) => n.text === t)!.id
    expect(side.get(id('Projet'))).toBe('center')
    expect(side.get(id('Équipe'))).toBe('right')
    expect(side.get(id('Alice'))).toBe('right')
    expect(side.get(id('Planning'))).toBe('left')
    expect(pos.get(id('Équipe'))!.x).toBeGreaterThan(0)
    expect(pos.get(id('Planning'))!.x).toBeLessThan(0)
    expect(pos.get(id('Alice'))!.x).toBeGreaterThan(pos.get(id('Équipe'))!.x)
  })

  it('centre l’idée centrale en face de ses branches et ne superpose aucune idée', () => {
    const { nodes, pos } = lay()
    const rects = nodes.map((n) => pos.get(n.id)!)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const overlap = Math.abs(rects[i].x - rects[j].x) < size.w && Math.abs(rects[i].y - rects[j].y) < size.h
        expect(overlap).toBe(false)
      }
    const root = pos.get(nodes[0].id)!
    const ys = nodes.filter((n) => n.parentId === nodes[0].id).map((n) => pos.get(n.id)!.y)
    expect(root.y).toBeGreaterThanOrEqual(Math.min(...ys))
    expect(root.y).toBeLessThanOrEqual(Math.max(...ys))
  })

  it('numérote les branches et laisse l’idée centrale à -1', () => {
    const { nodes, branch } = lay()
    const id = (t: string) => nodes.find((n) => n.text === t)!.id
    expect(branch.get(id('Projet'))).toBe(-1)
    expect(branch.get(id('Équipe'))).toBe(0)
    expect(branch.get(id('Bob'))).toBe(0)
    expect(branch.get(id('Budget'))).toBe(1)
  })

  it('ne place pas les descendants d’une idée repliée et empile plusieurs idées centrales', () => {
    const { nodes } = parse('A\n  B\n    C\nD\n  E').schema
    nodes[1].collapsed = true
    const { pos } = layoutMindmap(nodes, size, gap)
    expect(pos.has(nodes[2].id)).toBe(false)
    expect(pos.get(nodes[3].id)!.y).toBeGreaterThan(pos.get(nodes[0].id)!.y)
  })

  it('gère une carte vide et une idée seule', () => {
    expect(layoutMindmap([], size, gap).pos.size).toBe(0)
    const { nodes } = parse('Seule').schema
    expect(layoutMindmap(nodes, size, gap).pos.get(nodes[0].id)).toEqual({ x: 0, y: 0 })
  })
})

describe('exports', () => {
  it('Markdown : liste imbriquée avec les notes', () => {
    expect(mindmapToMarkdown(parse().schema)).toBe('- Projet — le cœur\n  - Équipe\n    - Alice\n    - Bob\n  - Budget\n  - Planning')
  })

  it('OPML : plan imbriqué, caractères spéciaux échappés', () => {
    const xml = mindmapToOpml(parseMindmapText('R & D <1> -- "ok"\n  Fils', counter()).schema, 'Ma carte')
    expect(xml).toContain('<opml version="2.0">')
    expect(xml).toContain('<title>Ma carte</title>')
    expect(xml).toContain('<outline text="R &amp; D &lt;1&gt;" _note="&quot;ok&quot;">')
    expect(xml).toContain('<outline text="Fils"/>')
    expect(xml.match(/<\/outline>/g)).toHaveLength(1)
  })
})

describe('validation', () => {
  it('complète les champs, régénère les identifiants en double et coupe les cycles', () => {
    const s = sanitizeMindmap(
      { nodes: [{ id: 'a', text: 'A', parentId: 'b' }, { id: 'b', text: 'B', parentId: 'a' }, { id: 'a', text: 5, parentId: 'zzz', collapsed: true }, 'x'] },
      counter(),
    )
    expect(s.nodes).toHaveLength(3)
    expect(new Set(s.nodes.map((n) => n.id)).size).toBe(3)
    expect(s.nodes[2]).toMatchObject({ text: '5', collapsed: true })
    expect(s.nodes[2].parentId).toBeUndefined()
    expect(s.nodes.filter((n) => !n.parentId).length).toBeGreaterThanOrEqual(2)
  })

  it('refuse une structure sans liste d’idées', () => {
    expect(() => sanitizeMindmap({ pages: [] }, counter())).toThrow()
    expect(() => sanitizeMindmap(null, counter())).toThrow()
  })
})
