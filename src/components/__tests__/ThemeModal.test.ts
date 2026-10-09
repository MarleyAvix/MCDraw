// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ThemeModal from '../panels/ThemeModal.vue'
import { useAppearance } from '../../composables/useAppearance'
import { useSchemaStore } from '../../stores/schemaStore'

// La modale est téléportée dans <body> : on interroge le document, pas le wrapper.
const colors = () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="color"]')]
const buttonWith = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const click = (b: HTMLElement) => b.click()
async function setColor(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

const mountModal = (pinia = createPinia()) => mount(ThemeModal, { attachTo: document.body, global: { plugins: [pinia] } })

describe('ThemeModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useAppearance().reset()
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
    const store = useSchemaStore()
    store.showThemeModal = true
    const w = mountModal(pinia)
    click(buttonWith('Fermer'))
    await nextTick()
    expect(store.showThemeModal).toBe(false)
    w.unmount()
  })
})
