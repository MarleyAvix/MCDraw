// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditEntityModal from '../modals/EditEntityModal.vue'
import { useSchemaStore } from '../../stores/schemaStore'

describe('EditEntityModal', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it("renomme l'entité à l'enregistrement seulement", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSchemaStore()
    const e = store.addEntity(0, 0)
    store.editingEntityId = e.id
    const w = mount(EditEntityModal, { attachTo: document.body, global: { plugins: [pinia] } })

    const input = document.body.querySelector<HTMLInputElement>('input')!
    input.value = 'Zorglub'
    input.dispatchEvent(new Event('input'))
    expect(store.entities.find((x) => x.id === e.id)!.name).not.toBe('Zorglub') // copie de travail : rien d'appliqué avant d'enregistrer

    const save = [...document.body.querySelectorAll('button')].find((b) => /enregistrer/i.test(b.textContent ?? ''))!
    save.click()
    await w.vm.$nextTick()
    expect(store.entities.find((x) => x.id === e.id)!.name).toBe('Zorglub')
    expect(store.editingEntityId).toBeNull()
    w.unmount()
  })
})
