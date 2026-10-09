<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, useVueFlow, type EdgeProps } from '@vue-flow/core'
import { exitToward, floatingLine, shapeOf, type Pt } from '../../composables/edgeGeometry'
import { maxOf, minOf, umlMultiplicity, type DiagramEdge, type DiagramStyle } from '../../engine/meriseToDiagram'
import type { Cardinality } from '../../types/schema'

type Data = DiagramEdge & { style: DiagramStyle }

const props = defineProps<EdgeProps<Data>>()
const { findNode } = useVueFlow()

interface End {
  pt: Pt
  /** Vecteur unitaire du trait vers le nœud de cette extrémité. */
  dir: Pt
  card?: Cardinality
  role?: string
  /** Boucle : côté (-1 gauche, 1 droite) vers lequel écrire les textes, hors de la boucle. */
  out?: -1 | 1
}

const SHIFT = 18
const loopHeight = (index: number) => 40 + index * 24
const d = computed(() => props.data!)

/** Boucle d'une association réflexive : sort et rentre par le haut de l'entité. */
function loop(node: Parameters<typeof shapeOf>[0], index: number) {
  const s = shapeOf(node)
  const top = s.center.y - s.h / 2
  const x1 = s.center.x - s.w * 0.3
  const x2 = s.center.x + s.w * 0.3
  const y = top - loopHeight(index)
  return { top, x1, x2, y, cx: s.center.x }
}

const geo = computed(() => {
  const data = d.value
  const shift = (data.index - (data.count - 1) / 2) * SHIFT
  const own = { source: props.sourceNode, target: props.targetNode }

  if (data.variant === 'classLink') {
    // Classe d'association : pointillés vers le milieu du trait de l'association (ou de sa boucle).
    const a = findNode(data.anchor![0])
    const b = findNode(data.anchor![1])
    if (!a || !b) return null
    let mid: Pt
    if (a.id === b.id) {
      const l = loop(a, data.index)
      mid = { x: l.cx, y: l.y }
    } else {
      const line = floatingLine(a, b, shift)
      mid = { x: (line.source.x + line.target.x) / 2, y: (line.source.y + line.target.y) / 2 }
    }
    const start = exitToward(own.source, mid)
    return { path: `M ${start.x},${start.y} L ${mid.x},${mid.y}`, mid, ends: [] as End[] }
  }

  if (props.source === props.target) {
    const l = loop(own.source, data.index)
    const down = { x: 0, y: 1 }
    return {
      path: `M ${l.x1},${l.top} L ${l.x1},${l.y} L ${l.x2},${l.y} L ${l.x2},${l.top}`,
      mid: { x: l.cx, y: l.y },
      ends: [
        { pt: { x: l.x1, y: l.top }, dir: down, card: data.sourceEnd, role: data.sourceRole, out: -1 as const },
        { pt: { x: l.x2, y: l.top }, dir: down, card: data.targetEnd, role: data.targetRole, out: 1 as const },
      ] as End[],
    }
  }

  const line = floatingLine(own.source, own.target, data.variant === 'inheritance' ? 0 : shift)
  return {
    path: `M ${line.source.x},${line.source.y} L ${line.target.x},${line.target.y}`,
    mid: { x: (line.source.x + line.target.x) / 2, y: (line.source.y + line.target.y) / 2 },
    normal: line.normal,
    line,
    ends: [
      { pt: line.source, dir: { x: -line.dir.x, y: -line.dir.y }, card: data.sourceEnd, role: data.sourceRole },
      { pt: line.target, dir: line.dir, card: data.targetEnd, role: data.targetRole },
    ] as End[],
  }
})

const angle = (v: Pt) => (Math.atan2(v.y, v.x) * 180) / Math.PI

/** Texte posé le long du trait, près d'une extrémité : au-dessus du trait (`side` 1) ou en dessous (`side` -1). */
function near(e: End, side: 1 | -1, dist: number) {
  if (e.out) {
    const y = e.pt.y - (side === 1 && dist < 30 ? 12 : 30)
    return `translate(-50%, -50%) translate(${e.pt.x + e.out * 22}px, ${y}px)`
  }
  let n = { x: -e.dir.y, y: e.dir.x }
  if (n.y > 0 || (n.y === 0 && n.x < 0)) n = { x: -n.x, y: -n.y }
  const x = e.pt.x - e.dir.x * dist + n.x * 13 * side
  const y = e.pt.y - e.dir.y * dist + n.y * 13 * side
  return `translate(-50%, -50%) translate(${x}px, ${y}px)`
}

const isErd = computed(() => d.value.style === 'erd')
const dashed = computed(() => (d.value.variant === 'classLink' ? { strokeDasharray: '6 5', strokeWidth: 1.5 } : {}))
// Flèche creuse de spécialisation, posée sur la classe mère.
const arrow = computed(() => {
  const l = geo.value && 'line' in geo.value ? geo.value.line : null
  return l ? `translate(${l.target.x} ${l.target.y}) rotate(${angle(l.dir)})` : ''
})
</script>

<template>
  <template v-if="geo">
    <BaseEdge :id="id" :path="geo.path" :style="{ strokeWidth: 2, ...dashed, ...style }" />

    <!-- Pattes de corbeau : pied (n) ou barre (1), puis barre (min 1) ou cercle (min 0), vers l'extérieur de l'entité -->
    <template v-if="isErd">
      <g
        v-for="(e, i) in geo.ends"
        :key="i"
        :transform="`translate(${e.pt.x} ${e.pt.y}) rotate(${angle(e.dir)})`"
        class="edge-mark pointer-events-none text-slate-700"
        stroke="currentColor"
        stroke-width="2"
        fill="none"
      >
        <template v-if="e.card">
          <path v-if="maxOf(e.card) === 'n'" d="M-14,0 L0,-8 M-14,0 L0,8" />
          <path v-else d="M-9,-8 L-9,8" />
          <path v-if="minOf(e.card) === '1'" d="M-19,-8 L-19,8" />
          <circle v-else cx="-23" cy="0" r="4" fill="var(--color-surface, white)" />
        </template>
      </g>
    </template>

    <polygon
      v-if="data?.variant === 'inheritance'"
      points="0,0 -16,-9 -16,9"
      :transform="arrow"
      fill="var(--color-surface, white)"
      stroke="currentColor"
      stroke-width="2"
      class="edge-mark pointer-events-none text-slate-700"
    />

    <EdgeLabelRenderer>
      <div
        v-if="data?.label"
        class="nodrag nopan pointer-events-none absolute rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-xs font-semibold"
        :style="{ transform: `translate(-50%, -50%) translate(${geo.mid.x}px, ${geo.mid.y}px)` }"
      >
        {{ data.label }}
      </div>
      <template v-for="(e, i) in geo.ends" :key="i">
        <!-- UML : multiplicité près de l'entité, rôle de l'autre côté du trait -->
        <div
          v-if="!isErd && e.card"
          class="nodrag nopan pointer-events-none absolute whitespace-nowrap text-xs font-semibold text-slate-700"
          :style="{ transform: near(e, 1, 22) }"
        >
          {{ umlMultiplicity(e.card) }}
        </div>
        <div
          v-if="e.role"
          class="nodrag nopan pointer-events-none absolute whitespace-nowrap text-xs italic text-slate-500"
          :style="{ transform: near(e, isErd ? 1 : -1, isErd ? 40 : 22) }"
        >
          {{ e.role }}
        </div>
      </template>
    </EdgeLabelRenderer>
  </template>
</template>
