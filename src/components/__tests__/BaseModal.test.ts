// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseModal from '../modals/BaseModal.vue'

describe('BaseModal', () => {
  it("affiche le titre et le contenu, avec les attributs d'accessibilité", () => {
    const w = mount(BaseModal, { props: { title: 'Mon titre' }, slots: { default: '<p>contenu</p>' }, attachTo: document.body })
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Mon titre')
    expect(dialog.textContent).toContain('contenu')
    w.unmount()
  })

  it('émet « close » avec Échap', () => {
    const w = mount(BaseModal, { props: { title: 'T' }, attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it("retire son écouteur clavier au démontage", () => {
    const w = mount(BaseModal, { props: { title: 'T' }, attachTo: document.body })
    w.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeUndefined()
  })
})
