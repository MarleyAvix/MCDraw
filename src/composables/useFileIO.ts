import { nextTick } from 'vue'
import { getRectOfNodes, useVueFlow } from '@vue-flow/core'
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

const SVG_PROPS = ['stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill', 'opacity']

/**
 * html-to-image n'embarque pas les règles CSS appliquées aux éléments SVG (liens, flèches, pattes…) :
 * sans styles inline ils perdent leur trait. On les fige donc le temps de la capture ; renvoie la restauration.
 */
function inlineSvgStyles(root: HTMLElement) {
  const saved: [SVGElement, string | null][] = []
  root.querySelectorAll<SVGElement>('path, line, polygon, polyline, circle, ellipse, rect').forEach((n) => {
    if (n.closest('.vue-flow__background, .vue-flow__minimap')) return
    saved.push([n, n.getAttribute('style')])
    const cs = getComputedStyle(n)
    for (const p of SVG_PROPS) n.style.setProperty(p, cs.getPropertyValue(p))
  })
  return () => saved.forEach(([n, s]) => (s === null ? n.removeAttribute('style') : n.setAttribute('style', s)))
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
    const { vueFlowRef, getNodes, viewport, setViewport } = active()
    const el = vueFlowRef.value
    if (!el || !getNodes.value.length) return

    // On exporte le diagramme entier à l'échelle 1:1 (et non la fenêtre visible, réduite par fitView) :
    // on agrandit temporairement le conteneur aux dimensions du contenu, puis on restaure.
    const PAD = 40
    const r = getRectOfNodes(getNodes.value)
    const width = Math.ceil(r.width + PAD * 2)
    const height = Math.ceil(r.height + PAD * 2)
    const saved = { w: el.style.width, h: el.style.height, vp: { ...viewport.value } }
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.classList.add('exporting')
    const restoreSvg = inlineSvgStyles(el)
    try {
      await setViewport({ x: PAD - r.x, y: PAD - r.y, zoom: 1 }, { duration: 0 })
      await nextTick()
      await new Promise((res) => setTimeout(res, 150))
      // limite la taille du canvas (au-delà ~16 000 px le navigateur rend une image vide)
      const pixelRatio = Math.max(1, Math.min(3, 8000 / Math.max(width, height)))
      const opts = {
        backgroundColor: getComputedStyle(el).backgroundColor,
        pixelRatio,
        width,
        height,
        cacheBust: true,
        filter: (n: HTMLElement) => {
          const c = n.classList
          return !(c?.contains('vue-flow__controls') || c?.contains('vue-flow__minimap') || c?.contains('vue-flow__background'))
        },
      }
      const url = format === 'png' ? await toPng(el, opts) : await toSvg(el, opts)
      download(url, `${store.view}.${format}`)
    } catch {
      alert("L'export de l'image a échoué.")
    } finally {
      restoreSvg()
      el.classList.remove('exporting')
      el.style.width = saved.w
      el.style.height = saved.h
      await setViewport(saved.vp, { duration: 0 })
    }
  }

  return { exportJson, importJson, exportImage }
}
