import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { toPng, toSvg } from 'html-to-image'
import { useSchemaStore } from '../stores/schemaStore'

function download(href: string, filename: string) {
  const a = Object.assign(document.createElement('a'), { href, download: filename })
  a.click()
}

/** Télécharge un texte ; l'URL n'est libérée qu'après coup (révoquée trop tôt, certains navigateurs annulent le téléchargement). */
export function downloadBlob(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  download(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Export / import du projet (JSON) et export du canvas en image (PNG / SVG). */
export function useFileIO() {
  const store = useSchemaStore()
  const mcd = useVueFlow('mcdraw')
  const mld = useVueFlow('mld')
  const erd = useVueFlow('erd')
  const uml = useVueFlow('uml')
  const active = () => ({ mcd, mld, erd, uml })[store.view]

  const exportJson = () => downloadBlob(JSON.stringify(store.schema, null, 2), 'application/json', 'mcdraw.json')

  async function importJson(file: File) {
    try {
      store.importSchema(JSON.parse(await file.text()))
      await nextTick()
      setTimeout(() => active().fitView({ padding: 0.2 }), 50)
    } catch (e) {
      alert(e instanceof Error && e.message.startsWith('Fichier') ? e.message : 'Impossible de lire ce fichier JSON.')
    }
  }

  async function exportImage(format: 'png' | 'svg') {
    const { vueFlowRef, fitView } = active()
    const el = vueFlowRef.value
    if (!el) return
    await fitView({ padding: 0.1, duration: 0 })
    await nextTick()
    await new Promise((r) => setTimeout(r, 120))
    const bg = getComputedStyle(el).backgroundColor
    const opts = {
      backgroundColor: bg,
      pixelRatio: 2,
      filter: (n: HTMLElement) => !n.classList?.contains('vue-flow__controls'),
    }
    try {
      const url = format === 'png' ? await toPng(el, opts) : await toSvg(el, opts)
      download(url, `${store.view}.${format}`)
    } catch {
      alert("L'export de l'image a échoué.")
    }
  }

  return { exportJson, importJson, exportImage }
}
