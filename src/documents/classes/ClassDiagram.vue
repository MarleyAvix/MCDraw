<script setup lang="ts">
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useClassStore } from './classStore'
import { PAD, ROW_H, type LClass, type LText } from './layout'

const store = useClassStore()
const L = computed(() => store.layout)
const selected = computed(() => new Set(store.selection))
const flashed = (key: string) => store.highlightId === key

function pick(key: string, e: MouseEvent) {
  const additive = e.ctrlKey || e.metaKey || e.shiftKey
  const has = selected.value.has(key)
  store.selection = additive ? (has ? store.selection.filter((k) => k !== key) : [...store.selection, key]) : [key]
}
const edit = (key: string) => (store.editing = key)

// --- Déplacement à la main -------------------------------------------------------------
// Glisser une classe la pose où l'on veut (toutes les classes sélectionnées bougent ensemble) ; en dessous de 4 px, c'est un simple clic.
const { viewport } = useVueFlow('class-diagram')
interface Drag { sx: number; sy: number; origins: Record<string, { x: number; y: number }>; moved: boolean }
let drag: Drag | null = null
let justDragged = false

function down(c: LClass, e: PointerEvent) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
  if (!selected.value.has(c.key)) store.selection = [c.key]
  const origins: Drag['origins'] = {}
  for (const l of L.value.classes) if (selected.value.has(l.key)) origins[l.name] = { x: l.x, y: l.y }
  drag = { sx: e.clientX, sy: e.clientY, origins, moved: false }
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
}
function move(e: PointerEvent) {
  if (!drag) return
  const dx = e.clientX - drag.sx
  const dy = e.clientY - drag.sy
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  const zoom = viewport.value.zoom || 1
  store.moveClasses(Object.fromEntries(Object.entries(drag.origins).map(([n, o]) => [n, { x: o.x + dx / zoom, y: o.y + dy / zoom }])))
}
function up(e: PointerEvent) {
  if (!drag) return
  const el = e.currentTarget as Element
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  // Le clic qui suit un déplacement ne doit ni sélectionner autre chose ni ouvrir la fenêtre.
  if (drag.moved) {
    justDragged = true
    setTimeout(() => (justDragged = false), 0)
  }
  drag = null
}
function clickClass(key: string, e: MouseEvent) {
  if (!justDragged) pick(key, e)
}

const FILL = { fill: 'var(--entity-bg, var(--color-indigo-100))' }
const BODY = { fill: 'color-mix(in srgb, var(--entity-bg, var(--color-indigo-100)) 30%, var(--color-slate-50))' }
const HEAD_TEXT = { fill: 'var(--entity-fg, var(--text, var(--color-slate-800)))' }
const textAttrs = (t: LText) => ({ x: t.x, y: t.y, 'text-anchor': t.anchor })
const hollowFill = 'var(--color-slate-50)'
</script>

<template>
  <svg :width="L.width" :height="L.height" :viewBox="`0 0 ${L.width} ${L.height}`" class="font-sans" font-size="12" role="img" aria-label="Diagramme de classes">
    <text v-if="L.title" :x="L.title.x" :y="L.title.y" text-anchor="middle" font-size="16" font-weight="700" class="seq-text fill-slate-800">{{ L.title.text }}</text>

    <!-- Relations : sous les classes, pour que les traits ne les recouvrent pas -->
    <g v-for="r in L.relations" :key="r.key" :data-id="r.key" class="cursor-pointer" @click.stop="pick(r.key, $event)" @dblclick.stop="edit(r.key)">
      <path :d="r.d" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke" />
      <path v-if="selected.has(r.key) || flashed(r.key)" :d="r.d" fill="none" stroke-width="6" stroke-linecap="round" :class="flashed(r.key) ? 'class-flash-line' : 'class-sel-line'" />
      <path :d="r.d" fill="none" stroke-width="1.5" :stroke-dasharray="r.dashed ? '6 4' : undefined" class="seq-edge stroke-slate-700" />
      <path v-if="r.marker" :d="r.marker.d" stroke-width="1.5" stroke-linejoin="round" :fill="r.marker.fill === 'none' ? 'none' : r.marker.fill === 'hollow' ? hollowFill : undefined" :class="r.marker.fill === 'solid' ? 'seq-edge-fill fill-slate-700 stroke-slate-700' : 'seq-edge stroke-slate-700'" />
      <text v-if="r.label" v-bind="textAttrs(r.label)" class="seq-text fill-slate-700">{{ r.label.text }}</text>
      <text v-if="r.fromMult" v-bind="textAttrs(r.fromMult)" font-size="11" class="seq-text fill-slate-600">{{ r.fromMult.text }}</text>
      <text v-if="r.toMult" v-bind="textAttrs(r.toMult)" font-size="11" class="seq-text fill-slate-600">{{ r.toMult.text }}</text>
    </g>

    <!-- Classes -->
    <g
      v-for="c in L.classes"
      :key="c.key"
      :data-id="c.key"
      class="nopan cursor-grab touch-none active:cursor-grabbing"
      @pointerdown.stop="down(c, $event)"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @click.stop="clickClass(c.key, $event)"
      @dblclick.stop="edit(c.key)"
    >
      <rect v-if="selected.has(c.key) || flashed(c.key)" :x="c.x - 3" :y="c.y - 3" :width="c.w + 6" :height="c.h + 6" rx="7" fill="none" stroke-width="2" :class="flashed(c.key) ? 'seq-flash-rect' : 'seq-sel-rect'" />
      <rect :x="c.x" :y="c.y" :width="c.w" :height="c.h" rx="5" stroke-width="1.5" class="stroke-slate-600" :style="BODY" />
      <path :d="`M${c.x},${c.y + c.headH} V${c.y + 5} a5,5 0 0 1 5,-5 H${c.x + c.w - 5} a5,5 0 0 1 5,5 V${c.y + c.headH} Z`" :style="FILL" stroke="none" />
      <text v-if="c.stereotype" :x="c.x + c.w / 2" :y="c.y + 15" text-anchor="middle" font-size="11" class="seq-text" :style="HEAD_TEXT">{{ c.stereotype }}</text>
      <text :x="c.x + c.w / 2" :y="c.y + c.headH - 12" text-anchor="middle" font-size="14" font-weight="700" :font-style="c.kind === 'abstract' ? 'italic' : 'normal'" class="seq-text" :style="HEAD_TEXT">{{ c.name }}</text>
      <line :x1="c.x" :x2="c.x + c.w" :y1="c.y + c.headH" :y2="c.y + c.headH" stroke-width="1" class="stroke-slate-600" />
      <text v-for="(a, i) in c.attributes" :key="`a${i}`" :x="c.x + PAD" :y="c.y + c.headH + PAD + i * ROW_H + 8" font-family="ui-monospace, monospace" font-size="12" class="seq-text fill-slate-800">{{ a }}</text>
      <line :x1="c.x" :x2="c.x + c.w" :y1="c.methodsY - 0.5" :y2="c.methodsY - 0.5" stroke-width="1" class="stroke-slate-500" />
      <text v-for="(m, i) in c.methods" :key="`m${i}`" :x="c.x + PAD" :y="c.methodsY + PAD + i * ROW_H - 2" font-family="ui-monospace, monospace" font-size="12" class="seq-text fill-slate-800">{{ m }}</text>
    </g>
  </svg>
</template>
