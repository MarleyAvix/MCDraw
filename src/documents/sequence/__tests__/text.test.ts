import { describe, expect, it } from 'vitest'
import { mergeSeq, parseSeqText, seqToText } from '../text'
import { sanitizeSeq, walkItems, type SeqDocument, type SeqItem } from '../model'
import { SEQUENCE_EXAMPLES } from '../sequenceStore'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const parse = (text: string) => parseSeqText(text, counter())
/** Le document sans identifiants, pour comparer deux lectures. */
const bare = (d: SeqDocument): unknown => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' ? undefined : v)))

describe('lecture du texte', () => {
  const SRC = `title Connexion
autonumber
actor Client as Utilisateur
database DB

Client ->> API: POST /login
API ->>+ DB: SELECT
DB -->>- API: ligne
API -) Mail: prévenir
Mail --) API: accusé
API -x Client: perdu
Note over Client, API: deux
Note right of DB: à droite
Note left of Client: à gauche`

  it('lit les déclarations, les flèches, les activations et les notes', () => {
    const { doc, errors } = parse(SRC)
    expect(errors).toEqual([])
    expect(doc.title).toBe('Connexion')
    expect(doc.autonumber).toBe(true)
    expect(doc.participants.map((p) => [p.name, p.kind, p.label])).toEqual([
      ['Client', 'actor', 'Utilisateur'],
      ['DB', 'database', undefined],
      ['API', 'participant', undefined],
      ['Mail', 'participant', undefined],
    ])
    const items = doc.items as any[]
    expect(items.map((i) => i.arrow ?? i.position)).toEqual(['sync', 'sync', 'reply', 'async', 'asyncReply', 'lost', 'over', 'right', 'left'])
    expect(items[1]).toMatchObject({ from: 'API', to: 'DB', activate: true })
    expect(items[2]).toMatchObject({ from: 'DB', to: 'API', deactivate: true })
    expect(items[6]).toMatchObject({ participants: ['Client', 'API'], text: 'deux' })
  })

  it('accepte les flèches courtes de Mermaid et les commentaires', () => {
    const { doc, errors } = parse('%% commentaire\n// autre\nA -> B: x\nB --> A: y')
    expect(errors).toEqual([])
    expect((doc.items as any[]).map((i) => i.arrow)).toEqual(['sync', 'reply'])
  })

  it('lit les blocs imbriqués et leurs sections, quelle que soit l’indentation', () => {
    const { doc, errors } = parse('alt cas A\nA ->> B: 1\nelse cas B\nloop pour chaque\nA ->> B: 2\nend\nend\nopt\nA ->> B: 3\nend')
    expect(errors).toEqual([])
    const [alt, opt] = doc.items as any[]
    expect(alt.type).toBe('alt')
    expect(alt.sections.map((s: any) => s.label)).toEqual(['cas A', 'cas B'])
    expect(alt.sections[1].items[0]).toMatchObject({ kind: 'block', type: 'loop' })
    expect(opt.sections[0].items).toHaveLength(1)
  })

  it('accepte les trois familles de sections', () => {
    const { errors } = parse('par a\nA ->> B: 1\nand b\nA ->> B: 2\nend\ncritical c\nA ->> B: 1\noption d\nA ->> B: 2\nend')
    expect(errors).toEqual([])
  })

  it('les noms avec tiret ou point restent lisibles, sans confondre le tiret et la flèche', () => {
    const { doc, errors } = parse('Web-App ->> DB.1: x\na-xray -x B: y')
    expect(errors).toEqual([])
    expect(doc.participants.map((p) => p.name)).toEqual(['Web-App', 'DB.1', 'a-xray', 'B'])
    expect((doc.items[1] as any).arrow).toBe('lost')
  })

  it('décode les retours à la ligne et les entités Mermaid', () => {
    const { doc } = parse('A ->> B: ligne 1<br/>ligne 2 #59; fin')
    expect((doc.items[0] as any).text).toBe('ligne 1\nligne 2 ; fin')
  })

  it('un participant déclaré après son premier usage prend sa déclaration', () => {
    const { doc, errors } = parse('A ->> B: x\nactor A as Alice')
    expect(errors).toEqual([])
    expect(doc.participants[0]).toMatchObject({ name: 'A', kind: 'actor', label: 'Alice' })
  })

  it('« activate » et « deactivate » s’appliquent au message qui les précède', () => {
    const { doc, errors } = parse('A ->> B: x\nactivate B\nB -->> A: y\ndeactivate B')
    expect(errors).toEqual([])
    expect(doc.items[0]).toMatchObject({ activate: true })
    expect(doc.items[1]).toMatchObject({ deactivate: true })
  })

  it('signale chaque erreur avec sa ligne', () => {
    const msgs = (t: string) => parse(t).errors.map((e) => `${e.line}:${e.message}`)
    expect(msgs('alt x\nA ->> B: 1')[0]).toMatch(/^1:.*n'est pas fermé/)
    expect(msgs('end')[0]).toMatch(/ne ferme aucun bloc/)
    expect(msgs('else x')[0]).toMatch(/dans un bloc/)
    expect(msgs('opt\nelse x\nend')[0]).toMatch(/pas de section/)
    expect(msgs('alt\nand x\nend')[0]).toMatch(/« else »/)
    expect(msgs('n’importe quoi')[0]).toMatch(/Ligne non reconnue/)
    expect(msgs('participant end')[0]).toMatch(/invalide/)
    expect(msgs('participant A\nparticipant A')[0]).toMatch(/déjà déclaré/)
    expect(msgs('activate A')[0]).toMatch(/participant connu/)
    expect(msgs('A ->> B: x\nactivate A')[0]).toMatch(/doit suivre un message/)
    expect(msgs('Note over A,B,C: x')[0]).toMatch(/un ou deux/)
    expect(msgs('rect rgb(1,2,3)')[0]).toMatch(/pas géré/)
  })
})

describe('écriture du texte', () => {
  it('fait l’aller-retour pour chaque modèle de départ', () => {
    for (const ex of SEQUENCE_EXAMPLES) {
      const first = parse(ex.text)
      expect(first.errors, ex.label).toEqual([])
      const again = parse(seqToText(first.doc))
      expect(again.errors, ex.label).toEqual([])
      expect(bare(again.doc), ex.label).toEqual(bare(first.doc))
    }
  })

  it('écrit les retours à la ligne en <br/> et relit la même chose', () => {
    const first = parse('A ->> B: a<br>b')
    expect(seqToText(first.doc)).toContain('A ->> B: a<br/>b')
    expect(bare(parse(seqToText(first.doc)).doc)).toEqual(bare(first.doc))
  })
})

describe('fusion avec le document existant', () => {
  it('les éléments inchangés gardent leur identifiant, même si un autre change', () => {
    const old = parse('A ->> B: 1\nalt x\nA ->> B: 2\nend\nA ->> B: 3').doc
    let n = 0
    const fresh = parseSeqText('A ->> B: 1\nalt x\nA ->> B: deux\nend\nA ->> B: 3', () => `new${++n}`).doc
    const merged = mergeSeq(old, fresh)
    const [m1, alt, m3] = merged.items as SeqItem[]
    const [o1, oalt, o3] = old.items
    expect([m1.id, alt.id, m3.id]).toEqual([o1.id, oalt.id, o3.id])
    const inner: string[] = []
    walkItems(merged.items, ({ item, block }) => block && inner.push(item.id))
    expect(inner[0]).toMatch(/^new/) // le message modifié est neuf
  })
})

describe('validation d’une source externe', () => {
  const make = (raw: unknown) => sanitizeSeq(raw, counter())
  it('refuse une structure inutilisable', () => {
    expect(() => make(null)).toThrow(/invalide/)
    expect(() => make({ items: [] })).toThrow(/invalide/)
  })
  it('écarte les éléments incomplets, crée les participants cités et régénère les identifiants en double', () => {
    const d = make({
      participants: [{ name: 'A' }, { name: 'A' }, { name: 'mauvais nom' }, { name: 'B', kind: 'actor', label: 'Bob' }],
      items: [
        { id: 'x', kind: 'message', from: 'A', to: 'C', text: 'ok' },
        { id: 'x', kind: 'message', from: 'A', to: 'inconnu nom' },
        { kind: 'note', position: 'over', participants: ['B', 'B'], text: 'n' },
        { kind: 'block', type: 'opt', sections: [{ items: [{ kind: 'message', from: 'B', to: 'A', arrow: 'zzz' }] }, { items: [] }] },
        { kind: 'block', type: 'nope', sections: [] },
      ],
    })
    expect(d.participants.map((p) => p.name)).toEqual(['A', 'B', 'C'])
    expect(d.items).toHaveLength(3)
    const all: string[] = []
    walkItems(d.items, ({ item }) => all.push(item.id))
    expect(new Set(all).size).toBe(all.length)
    expect((d.items[1] as any).participants).toEqual(['B'])
    expect((d.items[2] as any).sections).toHaveLength(1) // « opt » n'a qu'une section
    expect((d.items[2] as any).sections[0].items[0].arrow).toBe('sync')
  })
})
