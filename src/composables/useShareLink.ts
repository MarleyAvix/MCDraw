import { nextTick, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useSchemaStore } from '../stores/schemaStore'
import { decodeShare, readShareHash } from '../engine/shareLink'

/**
 * Ouvre un schéma partagé (`#share=…`) au chargement et quand le fragment change.
 * Le MCD en cours est remplacé (annulable par Ctrl+Z) ; le fragment est ensuite retiré de l'URL
 * pour qu'un rechargement ne réécrase pas le travail qui suit.
 */
export function useShareLink() {
  const store = useSchemaStore()
  const mcd = useVueFlow('mcdraw')

  async function openFromHash() {
    const payload = readShareHash(location.hash)
    if (!payload) return
    history.replaceState(null, '', location.pathname + location.search)
    try {
      store.importSchema(await decodeShare(payload))
      store.view = 'mcd'
      await nextTick()
      setTimeout(() => mcd.fitView({ padding: 0.2 }), 50)
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
