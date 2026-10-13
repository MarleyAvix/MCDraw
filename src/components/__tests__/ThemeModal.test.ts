// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ThemeModal from '../panels/ThemeModal.vue'
import { useAppearance, useAppearanceApplier } from '../../composables/useAppearance'
import { useDocumentStore } from '../../core/documentStore'
import { registerDocuments } from '../../documents'

// La modale est téléportée dans <body> : on interroge le document, pas le wrapper.
const colors = () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="color"]')]
const buttonWith = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const click = (b: HTMLElement) => b.click()
async function setColor(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

/** Monte la fenêtre pour un type de document donné (les couleurs s'appliquent à la page comme dans l'application). */
function mountModal(typeId = 'mcd', pinia = createPinia()) {
  setActivePinia(pinia)
  registerDocuments()
  const store = useDocumentStore()
  store.select(typeId)
  useAppearanceApplier(() => store.activeId)
  return mount(ThemeModal, { attachTo: document.body, global: { plugins: [pinia] } })
}

describe('ThemeModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    for (const id of ['mcd', 'sitemap', 'api', 'sequence', 'mindmap']) useAppearance(id).reset()
  })

  it("applique une couleur d'entité et choisit un texte lisible", async () => {
    const w = mountModal()
    const entity = colors()[0]
    await setColor(entity, '#ffe000') // jaune vif → texte sombre
    const root = document.documentElement
    expect(root.style.getPropertyValue('--entity-bg')).toBe('#ffe000')
    expect(root.style.getPropertyValue('--entity-fg')).toBe('#1f2328')
    expect(root.classList.contains('themed-entity')).toBe(true)

    await setColor(entity, '#101040') // fond sombre → texte blanc
    expect(root.style.getPropertyValue('--entity-fg')).toBe('#ffffff')
    w.unmount()
  })

  it('« Tout réinitialiser » retire les couleurs personnalisées', async () => {
    const w = mountModal()
    await setColor(colors()[2], '#ff0000')
    expect(document.documentElement.style.getPropertyValue('--edge')).toBe('#ff0000')
    click(buttonWith('réinitialiser'))
    await nextTick()
    expect(document.documentElement.style.getPropertyValue('--edge')).toBe('')
    expect(document.documentElement.classList.contains('themed-entity')).toBe(false)
    w.unmount()
  })

  it('se ferme avec le bouton Fermer', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useDocumentStore()
    store.showThemeModal = true
    const w = mountModal('mcd', pinia)
    click(buttonWith('Fermer'))
    await nextTick()
    expect(store.showThemeModal).toBe(false)
    w.unmount()
  })

  it('propose les couleurs du type affiché, avec son vocabulaire', async () => {
    const labels = () => [...document.body.querySelectorAll('label span.font-medium')].map((e) => e.textContent)
    let w = mountModal('mcd')
    expect(labels()).toEqual(['Entités', 'Associations', 'Liens'])
    w.unmount()
    document.body.innerHTML = ''
    w = mountModal('sitemap')
    expect(labels()).toEqual(['Pages', 'Liens'])
    w.unmount()
    document.body.innerHTML = ''
    w = mountModal('sequence')
    expect(labels()).toEqual(['Participants', 'Notes', 'Flèches'])
    w.unmount()
  })

  it('chaque type garde ses couleurs : celles du MCD ne touchent pas le plan de site', async () => {
    const w = mountModal('mcd')
    await setColor(colors()[0], '#ff0000')
    expect(document.documentElement.style.getPropertyValue('--entity-bg')).toBe('#ff0000')
    w.unmount()
    document.body.innerHTML = ''
    const w2 = mountModal('sitemap')
    await nextTick()
    expect(document.documentElement.style.getPropertyValue('--entity-bg')).toBe('')
    w2.unmount()
  })

  it('la carte mentale n’a rien à personnaliser (une couleur par branche) : pas de bouton', async () => {
    const { getDocumentType } = await import('../../core/documentType')
    registerDocuments()
    expect(getDocumentType('mindmap')?.appearance ?? []).toEqual([])
    for (const id of ['mcd', 'sitemap', 'api', 'sequence']) expect(getDocumentType(id)?.appearance?.length, id).toBeGreaterThan(0)
  })
})
