// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HeaderToolbar from '../panels/HeaderToolbar.vue'
import { useSchemaStore } from '../../stores/schemaStore'

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const w = mount(HeaderToolbar, { attachTo: document.body, global: { plugins: [pinia] } })
  return { w, store: useSchemaStore() }
}
const button = (w: ReturnType<typeof setup>['w'], text: string) => w.findAll('button').find((b) => b.text().includes(text))!

describe('HeaderToolbar', () => {
  beforeEach(() => localStorage.clear())

  it('change de vue avec les onglets MCD / MLD / ERD / UML', async () => {
    const { w, store } = setup()
    for (const v of ['mld', 'erd', 'uml', 'mcd'] as const) {
      await w.findAll('[role="tab"]').find((t) => t.text().toLowerCase() === v)!.trigger('click')
      expect(store.view).toBe(v)
    }
    w.unmount()
  })

  it("le menu Fichier propose l'export PDF et les images", async () => {
    const { w } = setup()
    expect(w.text()).not.toContain('PDF')
    await button(w, 'Fichier').trigger('click')
    for (const label of ['Exporter le projet (JSON)', 'Image PNG', 'Image SVG', 'PDF / Imprimer']) expect(w.text()).toContain(label)
    w.unmount()
  })

  it('le bouton palette ouvre la modale du thème', async () => {
    const { w, store } = setup()
    await w.find('button[title="Couleurs du diagramme"]').trigger('click')
    expect(store.showThemeModal).toBe(true)
    w.unmount()
  })

  it("le menu Exemples n'existe que dans la vue MCD", async () => {
    const { w, store } = setup()
    expect(w.text()).toContain('Exemples')
    store.view = 'mld'
    await w.vm.$nextTick()
    expect(w.text()).not.toContain('Exemples')
    w.unmount()
  })
})
