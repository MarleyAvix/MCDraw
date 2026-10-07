import { useVueFlow } from '@vue-flow/core'

/** Point du plan situé au centre de la zone visible, avec un léger décalage aléatoire. */
export function useSpawnPoint() {
  const { viewport, dimensions } = useVueFlow('mcdraw')
  return () => {
    const z = viewport.value.zoom || 1
    const jitter = () => (Math.random() - 0.5) * 80
    return {
      x: (dimensions.value.width / 2 - viewport.value.x) / z - 80 + jitter(),
      y: (dimensions.value.height / 2 - viewport.value.y) / z - 40 + jitter(),
    }
  }
}
