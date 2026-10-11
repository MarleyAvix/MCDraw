// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { documentTypes, getDocumentType } from '../documentType'
import { useDocumentStore } from '../documentStore'
import { registerDocuments } from '../../documents'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  registerDocuments()
})

describe('registre des types de document', () => {
  it('enregistre le MCD en premier (type ouvert par défaut) puis le sitemap', () => {
    expect(documentTypes().map((t) => t.id)).toEqual(['mcd', 'sitemap'])
    expect(getDocumentType('inconnu')).toBeUndefined()
  })

  it('chaque type est cohérent : vues, identifiants uniques, une vue éditable', () => {
    for (const t of documentTypes()) {
      expect(t.views.length).toBeGreaterThan(0)
      expect(t.views.some((v) => v.editable)).toBe(true)
      for (const list of [t.views, t.panels, t.modals, t.actions, t.headerActions]) {
        const ids = list.map((x) => x.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
      const flows = t.views.map((v) => v.flowId)
      expect(new Set(flows).size).toBe(flows.length)
      for (const a of t.actions) for (const v of a.views ?? []) expect(t.views.map((x) => x.id)).toContain(v)
      for (const ex of t.examples) expect(t.exampleGroups.map((g) => g.category)).toContain(ex.category)
    }
  })

  it('le nom des types ne se confond pas avec celui des vues (onglets accessibles distincts)', () => {
    const types = documentTypes()
    const views = types.flatMap((t) => t.views.map((v) => v.label.toLowerCase()))
    for (const t of types) expect(views).not.toContain(t.label.toLowerCase())
  })

  it.each([
    ['mcd', 'mcd', { entities: [], relations: [], links: [] }],
    ['sitemap', 'tree', { pages: [] }],
  ])('%s : l’API de document est complète', async (id, viewId, empty) => {
    const doc = getDocumentType(id)!.useDocument()
    expect(doc.view.value).toBe(viewId)
    expect(doc.searchIndex(viewId).length).toBeGreaterThan(0) // un exemple est chargé au premier lancement
    doc.reset()
    await nextTick() // l'historique enregistre au tick suivant
    expect(doc.schema.value).toEqual(empty)
    expect(() => doc.importRaw('pas un schéma')).toThrow()
    doc.selectAll()
    expect(doc.selection.value).toEqual([])
    expect(doc.searchIndex(viewId)).toEqual([])
    doc.undo()
    expect(doc.schema.value).not.toEqual(empty) // l'historique est branché
    doc.redo()
    expect(doc.schema.value).toEqual(empty)
  })
})

describe('documentStore', () => {
  it('ouvre le premier type par défaut et ignore un identifiant inconnu', () => {
    const s = useDocumentStore()
    expect(s.activeId).toBe('mcd')
    s.select('inconnu')
    expect(s.activeId).toBe('mcd')
    expect(s.active?.id).toBe('mcd')
  })

  it('retombe sur le premier type si la valeur mémorisée est périmée', () => {
    localStorage.setItem('mcdraw:document-type', 'disparu')
    setActivePinia(createPinia())
    expect(useDocumentStore().activeId).toBe('mcd')
  })
})
