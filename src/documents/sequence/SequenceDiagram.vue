<script setup lang="ts">
import { computed } from 'vue'
import { BOX_H, type LMessage, type LParticipant } from './layout'
import { useSequenceStore } from './sequenceStore'

const store = useSequenceStore()
const L = computed(() => store.layout)
const selected = computed(() => new Set(store.selection))
const flashed = (id: string) => store.highlightId === id

function pick(key: string, e: MouseEvent) {
  const additive = e.ctrlKey || e.metaKey || e.shiftKey
  const has = selected.value.has(key)
  store.selection = additive ? (has ? store.selection.filter((k) => k !== key) : [...store.selection, key]) : [key]
}
const edit = (key: string) => (store.editing = key)

// --- Géométrie des flèches ----------------------------------------------------------
// Une barre d'activation est large de 10, décalée de 6 par niveau d'imbrication : la flèche s'arrête à son bord.
const BAR_W = 10
const BAR_STEP = 6
const barX = (x: number, level: number) => x - BAR_W / 2 + level * BAR_STEP

/** Bord de la barre active de `name` à l'ordonnée `y`, du côté d'où vient (`dir` = +1 : par la gauche) ou où va la flèche. */
function edge(name: string, x: number, y: number, side: 'left' | 'right'): number {
  const bars = L.value.activations.filter((a) => a.participant === name && a.y1 - 0.5 <= y && y <= a.y2 + 0.5)
  if (!bars.length) return x
  if (side === 'left') return x - BAR_W / 2
  return Math.max(...bars.map((b) => barX(x, b.level) + BAR_W))
}

interface Shape {
  line: string
  head: string
  open: boolean
  cross?: [number, number]
  dashed: boolean
  badge: { x: number; y: number }
}
const nameAt = (x: number) => L.value.participants.find((p) => p.x === x)?.name ?? ''

function shape(m: LMessage): Shape {
  const dashed = m.arrow === 'reply' || m.arrow === 'asyncReply'
  const open = m.arrow === 'async' || m.arrow === 'asyncReply'
  if (m.self) {
    const name = nameAt(m.x1)
    const x0 = edge(name, m.x1, m.y, 'right')
    const x1 = edge(name, m.x1, m.y + 18, 'right')
    const out = x0 + 36
    return { line: `M${x0},${m.y} H${out} V${m.y + 18} H${x1 + 9}`, head: heads(x1, m.y + 18, -1, open), open, cross: m.arrow === 'lost' ? [x1, m.y + 18] : undefined, dashed, badge: { x: x0 + 12, y: m.y - 9 } }
  }
  const dir = m.x2 > m.x1 ? 1 : -1
  const a = edge(nameAt(m.x1), m.x1, m.y, dir > 0 ? 'right' : 'left')
  const b = edge(nameAt(m.x2), m.x2, m.y, dir > 0 ? 'left' : 'right')
  const tip = m.arrow === 'lost' ? b - dir * 14 : b
  return { line: `M${a},${m.y} H${m.arrow === 'lost' ? tip : open ? b : b - dir * 9}`, head: heads(b, m.y, dir, open), open, cross: m.arrow === 'lost' ? [tip, m.y] : undefined, dashed, badge: { x: a + dir * 13, y: m.y - 9 } }
}
/** Pointe de flèche : triangle plein, ou chevron ouvert pour un message asynchrone. */
function heads(x: number, y: number, dir: number, open: boolean) {
  const back = x - dir * 9
  return open ? `${back},${y - 4.5} ${x},${y} ${back},${y + 4.5}` : `${x},${y} ${back},${y - 4.5} ${back},${y + 4.5}`
}
const shapes = computed(() => new Map(L.value.messages.map((m) => [m.id, shape(m)])))

const partBox = (p: LParticipant) => ({ x: p.x - p.boxW / 2, w: p.boxW })
const iconX = (p: LParticipant) => p.x - p.boxW / 2 + 18
const labelX = (p: LParticipant) => (p.kind === 'participant' ? p.x : p.x + 11)
</script>

<template>
  <svg
    v-if="L.participants.length"
    :width="L.width"
    :height="L.height"
    :viewBox="`0 0 ${L.width} ${L.height}`"
    class="font-sans"
    font-size="12"
    role="img"
    :aria-label="L.title ? `Diagramme de séquence : ${L.title}` : 'Diagramme de séquence'"
  >
    <text v-if="L.title" :x="L.width / 2" :y="L.titleY" text-anchor="middle" font-size="16" font-weight="700" class="seq-text fill-slate-800">{{ L.title }}</text>

    <!-- Lignes de vie -->
    <line v-for="p in L.participants" :key="`l-${p.id}`" :x1="p.x" :x2="p.x" :y1="L.lifelineTop" :y2="L.lifelineBottom" stroke-dasharray="5 5" stroke-width="1" class="stroke-slate-300" />

    <!-- Blocs : le cadre, puis son étiquette et ses séparateurs -->
    <g v-for="b in L.blocks" :key="b.id" :data-id="b.id">
      <rect v-if="selected.has(b.id) || flashed(b.id)" :x="b.x - 3" :y="b.y - 3" :width="b.w + 6" :height="b.h + 6" rx="5" :class="flashed(b.id) ? 'seq-flash-rect' : 'seq-sel-rect'" fill="none" stroke-width="2" />
      <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3" fill="none" stroke-width="1.2" class="stroke-slate-400" />
      <polygon :points="`${b.x},${b.y} ${b.x + b.tabW},${b.y} ${b.x + b.tabW},${b.y + 14} ${b.x + b.tabW - 8},${b.y + 22} ${b.x},${b.y + 22}`" stroke-width="1.2" class="fill-slate-100 stroke-slate-400" />
      <text :x="b.x + 9" :y="b.y + 15" font-weight="700" class="seq-text fill-slate-700">{{ b.type }}</text>
      <text v-if="b.label" :x="b.x + b.tabW + 8" :y="b.y + 15" class="seq-text fill-slate-600">[{{ b.label }}]</text>
      <g v-for="s in b.sections" :key="s.id">
        <line :x1="b.x" :x2="b.x + b.w" :y1="s.y" :y2="s.y" stroke-dasharray="6 4" stroke-width="1.2" class="stroke-slate-400" />
        <text v-if="s.label" :x="b.x + 9" :y="s.y + 16" class="seq-text fill-slate-600">[{{ s.label }}]</text>
      </g>
      <!-- zones cliquables : l'étiquette et les séparateurs -->
      <rect :x="b.x" :y="b.y" :width="Math.max(b.tabW + 40, 60)" height="24" fill="transparent" class="cursor-pointer" @click.stop="pick(b.id, $event)" @dblclick.stop="edit(b.id)" />
      <rect v-for="s in b.sections" :key="`h-${s.id}`" :x="b.x" :y="s.y - 4" :width="b.w" height="24" fill="transparent" class="cursor-pointer" @click.stop="pick(b.id, $event)" @dblclick.stop="edit(b.id)" />
    </g>

    <!-- Barres d'activation -->
    <rect v-for="(a, i) in L.activations" :key="`a-${i}`" :x="barX(a.x, a.level)" :y="a.y1" :width="BAR_W" :height="Math.max(a.y2 - a.y1, 8)" rx="1.5" stroke-width="1" class="fill-slate-100 stroke-slate-500" />

    <!-- Messages -->
    <g v-for="m in L.messages" :key="m.id" :data-id="m.id" class="cursor-pointer" @click.stop="pick(m.id, $event)" @dblclick.stop="edit(m.id)">
      <rect :x="m.hit.x" :y="m.hit.y" :width="m.hit.w" :height="m.hit.h" rx="4" :class="flashed(m.id) ? 'seq-flash-rect' : selected.has(m.id) ? 'seq-sel-rect' : ''" :fill="flashed(m.id) || selected.has(m.id) ? undefined : 'transparent'" stroke-width="1.5" />
      <template v-if="shapes.get(m.id)">
        <path :d="shapes.get(m.id)!.line" fill="none" stroke-width="1.5" :stroke-dasharray="shapes.get(m.id)!.dashed ? '6 4' : undefined" class="seq-edge stroke-slate-700" />
        <polyline v-if="shapes.get(m.id)!.open && m.arrow !== 'lost'" :points="shapes.get(m.id)!.head" fill="none" stroke-width="1.5" class="seq-edge stroke-slate-700" />
        <polygon v-else-if="m.arrow !== 'lost'" :points="shapes.get(m.id)!.head" stroke-width="1" class="seq-edge-fill fill-slate-700 stroke-slate-700" />
        <g v-if="shapes.get(m.id)!.cross">
          <line :x1="shapes.get(m.id)!.cross![0] - 5" :x2="shapes.get(m.id)!.cross![0] + 5" :y1="m.y - 5" :y2="m.y + 5" stroke-width="2" class="seq-edge stroke-slate-700" />
          <line :x1="shapes.get(m.id)!.cross![0] - 5" :x2="shapes.get(m.id)!.cross![0] + 5" :y1="m.y + 5" :y2="m.y - 5" stroke-width="2" class="seq-edge stroke-slate-700" />
        </g>
        <g v-if="m.number">
          <circle :cx="shapes.get(m.id)!.badge.x" :cy="shapes.get(m.id)!.badge.y" r="8" class="seq-edge-fill fill-slate-700 stroke-none" />
          <text :x="shapes.get(m.id)!.badge.x" :y="shapes.get(m.id)!.badge.y + 3.5" text-anchor="middle" font-size="10" font-weight="700" class="fill-surface">{{ m.number }}</text>
        </g>
      </template>
      <text v-if="m.lines.length" :x="m.textX" :y="m.textY" :text-anchor="m.self ? 'start' : 'middle'" class="seq-text fill-slate-700">
        <tspan v-for="(line, i) in m.lines" :key="i" :x="m.textX" :dy="i ? 14 : 0">{{ line }}</tspan>
      </text>
    </g>

    <!-- Notes -->
    <g v-for="n in L.notes" :key="n.id" :data-id="n.id" class="cursor-pointer" @click.stop="pick(n.id, $event)" @dblclick.stop="edit(n.id)">
      <rect v-if="selected.has(n.id) || flashed(n.id)" :x="n.x - 3" :y="n.y - 3" :width="n.w + 6" :height="n.h + 6" rx="5" fill="none" stroke-width="2" :class="flashed(n.id) ? 'seq-flash-rect' : 'seq-sel-rect'" />
      <path :d="`M${n.x},${n.y} H${n.x + n.w - 10} L${n.x + n.w},${n.y + 10} V${n.y + n.h} H${n.x} Z`" stroke="#d6b64a" stroke-width="1" :style="{ fill: 'var(--relation-bg, #fff6c9)' }" />
      <text :x="n.x + 9" :y="n.y + 18" :style="{ fill: 'var(--relation-fg, var(--text, #3a3a3a))' }">
        <tspan v-for="(line, i) in n.lines" :key="i" :x="n.x + 9" :dy="i ? 14 : 0">{{ line }}</tspan>
      </text>
    </g>

    <!-- Participants, en haut et en bas -->
    <template v-for="y in [L.boxY, L.bottomBoxY]" :key="y">
      <g v-for="p in L.participants" :key="`${y}-${p.id}`" class="cursor-pointer" :data-id="y === L.boxY ? p.id : undefined" @click.stop="pick(p.id, $event)" @dblclick.stop="edit(p.id)">
        <rect v-if="selected.has(p.id) || flashed(p.id)" :x="partBox(p).x - 3" :y="y - 3" :width="partBox(p).w + 6" :height="BOX_H + 6" rx="8" fill="none" stroke-width="2" :class="flashed(p.id) ? 'seq-flash-rect' : 'seq-sel-rect'" />
        <rect :x="partBox(p).x" :y="y" :width="partBox(p).w" :height="BOX_H" rx="6" stroke-width="1.5" class="stroke-slate-600" :style="{ fill: 'var(--entity-bg, var(--color-surface))' }" />
        <g v-if="p.kind === 'actor'" class="stroke-slate-600" fill="none" stroke-width="1.5" stroke-linecap="round">
          <circle :cx="iconX(p)" :cy="y + 13" r="4" />
          <path :d="`M${iconX(p)},${y + 17} V${y + 27} M${iconX(p) - 6},${y + 21} H${iconX(p) + 6} M${iconX(p)},${y + 27} L${iconX(p) - 5},${y + 34} M${iconX(p)},${y + 27} L${iconX(p) + 5},${y + 34}`" />
        </g>
        <g v-else-if="p.kind === 'database'" class="stroke-slate-600" fill="none" stroke-width="1.5">
          <ellipse :cx="iconX(p)" :cy="y + 15" rx="7" ry="3" />
          <path :d="`M${iconX(p) - 7},${y + 15} V${y + 29} A7,3 0 0 0 ${iconX(p) + 7},${y + 29} V${y + 15}`" />
        </g>
        <text :x="labelX(p)" :y="y + BOX_H / 2 + 4" text-anchor="middle" font-weight="600" class="seq-text fill-slate-800" :style="{ fill: 'var(--entity-fg, var(--text, var(--color-slate-800)))' }">{{ p.label }}</text>
      </g>
    </template>
  </svg>
</template>
