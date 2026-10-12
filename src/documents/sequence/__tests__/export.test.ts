import { describe, expect, it } from 'vitest'
import { parseSeqText } from '../text'
import { layoutSequence } from '../layout'
import { seqToMermaid } from '../mermaid'
import { seqToPlantUml } from '../plantuml'
import { SEQUENCE_EXAMPLES } from '../sequenceStore'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const doc = (text: string) => parseSeqText(text, counter()).doc

describe('mise en page', () => {
  it('place les participants de gauche à droite, à l’intérieur de l’image', () => {
    const l = layoutSequence(doc('A ->> B: x\nB ->> C: y'))
    const xs = l.participants.map((p) => p.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(l.participants[0].x - l.participants[0].boxW / 2).toBeGreaterThanOrEqual(0)
    expect(l.width).toBeGreaterThan(xs[2])
  })

  it('un long texte écarte les participants, y compris sur plusieurs colonnes', () => {
    const short = layoutSequence(doc('A ->> B: ok\nB ->> C: ok'))
    const long = layoutSequence(doc('participant A\nparticipant B\nparticipant C\nA ->> C: ' + 'très long message '.repeat(6)))
    expect(long.participants[2].x - long.participants[0].x).toBeGreaterThan(short.participants[2].x - short.participants[0].x - 1)
    const gap = long.participants[2].x - long.participants[0].x
    expect(gap).toBeGreaterThan('très long message '.repeat(6).length * 6)
  })

  it('une note à gauche du premier participant décale tout vers la droite sans sortir de l’image', () => {
    const l = layoutSequence(doc('A ->> B: x\nNote left of A: une note plutôt large'))
    expect(l.notes[0].x).toBeGreaterThanOrEqual(0)
  })

  it('numérote les messages quand le diagramme est numéroté', () => {
    const l = layoutSequence(doc('autonumber\nA ->> B: 1\nB -->> A: 2'))
    expect(l.messages.map((m) => m.number)).toEqual([1, 2])
    expect(layoutSequence(doc('A ->> B: 1')).messages[0].number).toBeUndefined()
  })

  it('les lignes avancent vers le bas dans l’ordre du texte', () => {
    const l = layoutSequence(doc('A ->> B: 1\nNote over A: n\nB ->> A: 2'))
    expect(l.messages[0].y).toBeLessThan(l.notes[0].y + l.notes[0].h)
    expect(l.notes[0].y).toBeLessThan(l.messages[1].y)
  })

  it('crée une barre d’activation entre « + » et « - », et ferme les barres restées ouvertes', () => {
    const l = layoutSequence(doc('A ->>+ B: x\nB -->>- A: y\nA ->>+ B: z'))
    expect(l.activations).toHaveLength(2)
    const closed = l.activations.find((a) => a.y2 < l.lifelineBottom)!
    expect(closed.y1).toBe(l.messages[0].y)
    expect(closed.y2).toBe(l.messages[1].y)
    expect(l.activations.some((a) => a.y2 === l.lifelineBottom)).toBe(true)
  })

  it('une activation imbriquée se décale d’un niveau', () => {
    const l = layoutSequence(doc('A ->>+ B: 1\nA ->>+ B: 2\nB -->>- A: 3\nB -->>- A: 4'))
    expect(l.activations.map((a) => a.level).sort()).toEqual([0, 1])
  })

  it('un bloc entoure son contenu, un bloc imbriqué reste dans son parent', () => {
    const l = layoutSequence(doc('alt a\nA ->> B: 1\nloop b\nB ->> C: 2\nend\nelse c\nA ->> B: 3\nend'))
    const [outer, inner] = l.blocks
    expect(outer.type).toBe('alt')
    expect(inner.type).toBe('loop')
    expect(inner.x).toBeGreaterThan(outer.x)
    expect(inner.x + inner.w).toBeLessThan(outer.x + outer.w)
    expect(inner.y).toBeGreaterThan(outer.y)
    expect(inner.y + inner.h).toBeLessThan(outer.y + outer.h)
    expect(outer.sections).toHaveLength(1)
    expect(outer.sections[0].label).toBe('c')
    const m3 = l.messages[2]
    expect(m3.y).toBeGreaterThan(outer.sections[0].y)
  })

  it('un document vide ou sans participant donne une mise en page vide', () => {
    expect(layoutSequence(doc('')).participants).toEqual([])
  })

  it('chaque modèle de départ tient dans son image', () => {
    for (const ex of SEQUENCE_EXAMPLES) {
      const l = layoutSequence(doc(ex.text))
      for (const m of l.messages) expect(Math.min(m.x1, m.x2), ex.label).toBeGreaterThanOrEqual(0)
      for (const b of l.blocks) {
        expect(b.x, ex.label).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w, ex.label).toBeLessThanOrEqual(l.width)
        expect(b.y + b.h, ex.label).toBeLessThanOrEqual(l.lifelineBottom)
      }
      for (const n of l.notes) expect(n.x + n.w, ex.label).toBeLessThanOrEqual(l.width)
    }
  })
})

describe('export Mermaid', () => {
  const SRC = `title Connexion
autonumber
actor Client as Utilisateur
participant Web-App
database DB

Client ->> Web-App: POST /login; ok #1
Web-App ->>+ DB: SELECT
DB -->>- Web-App: ligne
alt valide
  Web-App -) Client: ok<br>suite
else non
  Web-App -x Client: ko
end
Note over Client, Web-App: texte
Note right of DB: à droite`
  const out = seqToMermaid(doc(SRC))

  it('commence par le titre en en-tête et la déclaration du diagramme', () => {
    expect(out.startsWith('---\ntitle: Connexion\n---\nsequenceDiagram\n')).toBe(true)
    expect(out).toContain('    autonumber')
  })

  it('déclare les participants avec un identifiant sûr et leur libellé', () => {
    expect(out).toContain('    actor Client as Utilisateur')
    expect(out).toContain('    participant Web_App as Web-App')
    expect(out).toContain('    participant DB')
  })

  it('écrit les messages, flèches, activations et échappements', () => {
    expect(out).toContain('    Client->>Web_App: POST /login#59; ok #35;1')
    expect(out).toContain('    Web_App->>+DB: SELECT')
    expect(out).toContain('    DB-->>-Web_App: ligne')
    expect(out).toContain('        Web_App-)Client: ok<br/>suite')
    expect(out).toContain('        Web_App-xClient: ko')
  })

  it('écrit les blocs indentés et fermés, et les notes', () => {
    expect(out).toContain('    alt valide\n')
    expect(out).toContain('    else non\n')
    expect(out).toContain('    end\n')
    expect(out).toContain('    Note over Client,Web_App: texte')
    expect(out).toContain('    Note right of DB: à droite')
  })

  it('chaque modèle de départ donne autant de « end » que de blocs', () => {
    for (const ex of SEQUENCE_EXAMPLES) {
      const text = seqToMermaid(doc(ex.text))
      const opens = (text.match(/^\s+(alt|opt|loop|par|critical|break)\b/gm) ?? []).length
      expect((text.match(/^\s+end$/gm) ?? []).length, ex.label).toBe(opens)
    }
  })
})

describe('export PlantUML', () => {
  const out = seqToPlantUml(
    doc('title Test\nautonumber\nactor C as Client\ndatabase DB\nC ->>+ DB: a<br>b\nDB -->>- C: r\nC -) DB: async\nC -x DB: perdu\npar x\nC ->> DB: 1\nand y\nC ->> DB: 2\nend\nNote left of C: gauche'),
  )

  it('encadre le diagramme et déclare les participants entre guillemets', () => {
    expect(out.startsWith('@startuml\ntitle Test\nautonumber\n')).toBe(true)
    expect(out.trimEnd().endsWith('@enduml')).toBe(true)
    expect(out).toContain('actor "Client" as C')
    expect(out).toContain('database "DB" as DB')
  })

  it('traduit les flèches, les activations et les retours à la ligne', () => {
    expect(out).toContain('C -> DB ++ : a\\nb')
    expect(out).toContain('DB --> C -- : r')
    expect(out).toContain('C ->> DB : async')
    expect(out).toContain('C ->x DB : perdu')
  })

  it('sépare toutes les sections par « else », même pour un « par »', () => {
    expect(out).toContain('par x\n  C -> DB : 1\nelse y\n  C -> DB : 2\nend')
    expect(out).toContain('note left of C : gauche')
  })
})
