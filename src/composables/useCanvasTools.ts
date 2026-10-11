import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

/**
 * Deux outils communs à tous les canvas : « sélection » (glisser sur le fond trace un rectangle ; la vue se déplace à la
 * molette cliquée) et « main » (glisser sur le fond déplace la vue). Le zoom se fait toujours à la molette / au pincement.
 * Attention : avec `selection-key-code` à true, Vue Flow refuse la molette dès que `pan-on-drag` contient 0.
 *
 * Trackpad : un balayage horizontal déplace la vue (la molette verticale, elle, zoome ; le pincement aussi, via ctrlKey).
 */
export function useCanvasTools(flowId: string) {
  const tool = ref<'select' | 'pan'>('select')
  const { vueFlowRef, viewport, setViewport } = useVueFlow(flowId)

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    e.stopPropagation()
    const v = viewport.value
    setViewport({ x: v.x - e.deltaX, y: v.y, zoom: v.zoom }, { duration: 0 })
  }
  onMounted(() => vueFlowRef.value?.addEventListener('wheel', onWheel, { capture: true, passive: false }))
  onBeforeUnmount(() => vueFlowRef.value?.removeEventListener('wheel', onWheel, { capture: true }))

  return { tool }
}
