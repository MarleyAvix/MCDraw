import { nextTick, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useActiveDocument } from '../core/useActiveDocument'
import { useDocumentStore } from '../core/documentStore'
import { getDocumentType } from '../core/documentType'
import { decodeShare, readShare } from '../engine/shareLink'

/**
 * Ouvre un schéma partagé (`#share=…`) au chargement et quand le fragment change.
 * Le document en cours est remplacé (annulable par Ctrl+Z) ; le fragment est ensuite retiré de l'URL
 * pour qu'un rechargement ne réécrase pas le travail qui suit.
 */
export function useShareLink() {
  const store = useDocumentStore()
  const { doc, editableView } = useActiveDocument()

  async function openFromHash() {
    const shared = readShare(location.hash)
    if (!shared) return
    history.replaceState(null, '', location.pathname + location.search)
    try {
      if (!getDocumentType(shared.type)) throw new Error('Ce lien de partage est invalide ou corrompu.')
      const data = await decodeShare(shared.payload)
      store.select(shared.type)
      doc.value.importRaw(data)
      doc.value.view.value = editableView.value.id
      await nextTick()
      setTimeout(() => useVueFlow(editableView.value.flowId).fitView({ padding: 0.2 }), 50)
    } catch (e) {
      alert(e instanceof Error && !e.message.startsWith('Fichier') ? e.message : 'Ce lien de partage est invalide ou corrompu.')
    }
  }

  onMounted(() => {
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
  })
  onUnmounted(() => window.removeEventListener('hashchange', openFromHash))
}
