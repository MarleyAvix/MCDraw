// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSequenceStore, participantKey } from '../sequenceStore'
import { parseSeqText, seqToText } from '../text'
import type { SeqBlock, SeqMessage } from '../model'

const counter = () => {
  let n = 0
  return () => `t${++n}`
}

let s: ReturnType<typeof useSequenceStore>
/** Remplace le document par ce texte (les identifiants sont prévisibles : t1, t2…). */
const set = (text: string) => {
  s.load(parseSeqText(text, counter()).doc)
  s.selection = []
}
const text = () => seqToText(s.schema)

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  s = useSequenceStore()
})

describe('ajout d’éléments', () => {
  it('un premier message crée deux participants et ouvre la fenêtre d’édition', () => {
    s.reset()
    const m = s.addMessage()
    expect(s.participants.map((p) => p.name)).toEqual(['Client', 'Serveur'])
    expect(m).toMatchObject({ from: 'Client', to: 'Serveur', arrow: 'sync' })
    expect(s.editing).toBe(m.id)
    expect(s.selection).toEqual([m.id])
  })

  it('après un appel, le message suivant est son retour (et inversement)', () => {
    set('A ->> B: appel')
    s.selection = ['t1']
    const retour = s.addMessage()
    expect(retour).toMatchObject({ from: 'B', to: 'A', arrow: 'reply' })
    const encore = s.addMessage()
    expect(encore).toMatchObject({ from: 'A', to: 'B', arrow: 'sync' })
    expect(s.doc.items.map((i) => i.id)).toEqual(['t1', retour.id, encore.id])
  })

  it('un message s’insère juste après la sélection, et dans le bloc s’il est sélectionné', () => {
    set('A ->> B: un\nB ->> A: deux\nalt x\nend')
    s.selection = ['t1']
    const m = s.addMessage()
    expect(s.doc.items.map((i) => i.id).slice(0, 3)).toEqual(['t1', m.id, 't2'])
    const block = s.doc.items.find((i) => i.kind === 'block') as SeqBlock
    s.selection = [block.id]
    const inside = s.addMessage()
    expect(block.sections[0].items.map((i) => i.id)).toEqual([inside.id])
  })

  it('un participant s’ajoute après le participant sélectionné, avec un nom unique', () => {
    set('A ->> B: x')
    s.selection = [participantKey('A')]
    const p = s.addParticipant()
    expect(s.participants.map((x) => x.name)).toEqual(['A', p.name, 'B'])
    expect(s.addParticipant().name).not.toBe(p.name)
  })

  it('une note se pose sur le destinataire du message sélectionné', () => {
    set('A ->> B: x')
    s.selection = ['t1']
    expect(s.addNote()).toMatchObject({ position: 'over', participants: ['B'] })
  })
})

describe('blocs', () => {
  it('un bloc enveloppe les éléments contigus sélectionnés', () => {
    set('A ->> B: 1\nA ->> B: 2\nA ->> B: 3')
    s.selection = ['t1', 't2']
    const b = s.addBlock('loop')
    expect(s.doc.items.map((i) => i.kind)).toEqual(['block', 'message'])
    expect(b.sections[0].items.map((i) => i.id)).toEqual(['t1', 't2'])
    expect(b.type).toBe('loop')
  })

  it('des éléments non contigus ne sont pas enveloppés : un bloc vide est ajouté', () => {
    set('A ->> B: 1\nA ->> B: 2\nA ->> B: 3')
    s.selection = ['t1', 't3']
    const b = s.addBlock()
    expect(b.sections[0].items).toEqual([])
    expect(s.doc.items).toHaveLength(4)
  })

  it('changer de type vers un bloc à section unique fusionne les sections ; retirer une section verse son contenu dans la précédente', () => {
    set('alt a\nA ->> B: 1\nelse b\nA ->> B: 2\nelse c\nA ->> B: 3\nend')
    const block = s.doc.items[0] as SeqBlock
    const [s1, s2] = block.sections
    s.setBlock(block.id, 'alt', [{ id: s1.id, label: 'a' }, { id: s2.id, label: 'b' }])
    expect((s.doc.items[0] as SeqBlock).sections.map((x) => x.items.length)).toEqual([1, 2])
    s.setBlock(block.id, 'opt', [{ id: s1.id, label: 'a' }])
    const opt = s.doc.items[0] as SeqBlock
    expect(opt.type).toBe('opt')
    expect(opt.sections).toHaveLength(1)
    expect(opt.sections[0].items).toHaveLength(3)
  })

  it('dissoudre un bloc garde son contenu à sa place', () => {
    set('A ->> B: 0\nalt a\nA ->> B: 1\nelse b\nA ->> B: 2\nend\nA ->> B: 3')
    s.unwrapBlock((s.doc.items[1] as SeqBlock).id)
    expect(s.doc.items.map((i) => (i as SeqMessage).text)).toEqual(['0', '1', '2', '3'])
  })
})

describe('participants', () => {
  it('renommer met à jour les messages, les notes et la sélection', () => {
    set('A ->> B: x\nNote over A, B: n')
    s.selection = [participantKey('A')]
    s.setParticipant('A', { name: 'Client', kind: 'actor' })
    expect(text()).toContain('Client ->> B: x')
    expect(text()).toContain('Note over Client, B: n')
    expect(s.selection).toEqual([participantKey('Client')])
  })

  it('supprimer un participant retire ses messages et notes, même dans un bloc', () => {
    set('A ->> B: 1\nA ->> C: 2\nalt x\nC ->> B: 3\nB ->> A: 4\nend\nNote over C: n')
    expect(s.usageOf(['C'])).toBe(3)
    s.removeParticipants(['C'])
    expect(s.participants.map((p) => p.name)).toEqual(['A', 'B'])
    expect(text()).toContain('B ->> A: 4')
    expect(text()).not.toMatch(/: 2|: 3|Note/)
  })

  it('l’ordre des participants se change, bornes comprises', () => {
    set('A ->> B: x\nB ->> C: y')
    expect(s.canMoveParticipant('A', -1)).toBe(false)
    expect(s.canMoveParticipant('C', 1)).toBe(false)
    s.moveParticipantBy('A', 1)
    expect(s.participants.map((p) => p.name)).toEqual(['B', 'A', 'C'])
  })
})

describe('déplacement, suppression, copie', () => {
  it('Monter / Descendre échange l’élément avec son voisin dans sa liste, sans sortir du bloc', () => {
    set('A ->> B: 1\nalt a\nA ->> B: 2\nA ->> B: 3\nend')
    expect(s.canMoveItem('t1', -1)).toBe(false)
    s.moveItemBy('t1', 1)
    expect(s.doc.items.map((i) => i.kind)).toEqual(['block', 'message'])
    const block = s.doc.items[0] as SeqBlock
    const [a, b] = block.sections[0].items
    expect(s.canMoveItem(b.id, 1)).toBe(false)
    s.moveItemBy(b.id, -1)
    expect(block.sections[0].items.map((i) => i.id)).toEqual([b.id, a.id])
  })

  it('supprimer la sélection retire éléments et participants, et nettoie la sélection', () => {
    set('A ->> B: 1\nB ->> C: 2\nA ->> B: 3')
    s.selection = ['t1', participantKey('C')]
    s.removeSelection()
    expect(text()).toBe('participant A\nparticipant B\n\nA ->> B: 3')
    expect(s.selection).toEqual([])
  })

  it('dupliquer insère des copies neuves après la sélection ; copier / coller aussi', () => {
    set('A ->> B: 1\nalt a\nB ->> A: 2\nend')
    s.selection = ['t1', (s.doc.items[1] as SeqBlock).id]
    s.duplicate()
    expect(s.doc.items).toHaveLength(4)
    const ids = new Set<string>()
    const walk = (items: typeof s.doc.items) => items.forEach((i) => (ids.add(i.id), i.kind === 'block' && i.sections.forEach((x) => (ids.add(x.id), walk(x.items)))))
    walk(s.doc.items)
    expect(ids.size).toBe(8) // (message, bloc, section, message intérieur) × 2 : aucun identifiant en double
    s.selection = ['t1']
    expect(s.copy()).toBe(true)
    expect(s.paste()).toBe(true)
    expect(s.doc.items).toHaveLength(5)
  })
})

describe('recherche, chargement, historique', () => {
  it('indexe participants, messages, notes et blocs', () => {
    set('A ->> B: bonjour\nalt cas\nNote over A: attention\nend')
    const kinds = s.searchIndex().map((h) => h.kind)
    expect(kinds).toEqual(['participant', 'participant', 'message', 'block', 'note'])
    expect(s.searchIndex().find((h) => h.kind === 'note')?.context).toContain('alt')
  })

  it('un document importé est validé, un document invalide est refusé', () => {
    expect(() => s.importSchema({ nimporte: 'quoi' })).toThrow()
    s.importSchema({ participants: [{ name: 'X' }], items: [{ kind: 'message', from: 'X', to: 'Y', text: 'hi' }] })
    expect(s.participants.map((p) => p.name)).toEqual(['X', 'Y'])
  })

  it('les réglages généraux se modifient', () => {
    s.setMeta({ title: '  Mon titre ', autonumber: true })
    expect(s.doc.title).toBe('Mon titre')
    expect(s.doc.autonumber).toBe(true)
    s.setMeta({ title: '', autonumber: false })
    expect(s.doc.title).toBeUndefined()
    expect(s.doc.autonumber).toBeUndefined()
  })
})
