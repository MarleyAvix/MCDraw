<script setup lang="ts">
import { computed } from 'vue'
import { LINE_H, type LEdge, type LPseudo, type LState } from './layout'
import { useStateStore } from './stateStore'

const store = useStateStore()
const L = computed(() => store.layout)
const selected = computed(() => new Set(store.selection))
const flashed = (id: string) => store.highlightId === id
const options = computed(() => new Map(store.simOptions.map((o) => [o.t.id, o])))
const simOn = computed(() => store.sim.on)

function pick(key: string, e: MouseEvent) {
  if (simOn.value && options.value.has(key)) return store.simFire(key)
  const additive = e.ctrlKey || e.metaKey || e.shiftKey
  const has = selected.value.has(key)
  store.selection = additive ? (has ? store.selection.filter((k) => k !== key) : [...store.selection, key]) : [key]
}
const edit = (key: string) => (store.editing = key)

/** Les composites sont dessinés avant leur contenu, du plus externe au plus interne. */
const composites = computed(() => L.value.states.filter((s) => s.composite).sort((a, b) => a.depth - b.depth))
const simples = computed(() => L.value.states.filter((s) => !s.composite))
const active = computed(() => L.value.states.find((s) => s.name === store.sim.current))

const FILL = { fill: 'var(--entity-bg, var(--color-indigo-100))' }
const COMPOSITE_FILL = { fill: 'color-mix(in srgb, var(--entity-bg, var(--color-indigo-100)) 30%, var(--color-slate-50))' }
const TEXT = { fill: 'var(--entity-fg, var(--text, var(--color-slate-800)))' }
const NOTE_FILL = { fill: 'var(--relation-bg, #fff6c9)' }
const NOTE_TEXT = { fill: 'var(--relation-fg, var(--text, #3a3a3a))' }

const titleH = (s: LState) => s.title.length * LINE_H + 16
const actionsY = (s: LState) => s.y + titleH(s)
const noteY = (s: LState) => actionsY(s) + (s.actions.length ? s.actions.length * LINE_H + 10 : 0)
const diamond = (s: LState) => `${s.x + s.w / 2},${s.y} ${s.x + s.w},${s.y + s.h / 2} ${s.x + s.w / 2},${s.y + s.h} ${s.x},${s.y + s.h / 2}`
const labelBox = (e: LEdge) => ({ x: e.lx - e.lw / 2, y: e.ly - e.lh / 2, w: e.lw, h: e.lh })
const edgeState = (e: LEdge) => (selected.value.has(e.id) ? 'sel' : flashed(e.id) ? 'flash' : '')
const pseudoCenter = (p: LPseudo) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 })
</script>

<template>
  <svg
    v-if="L.states.length"
    :width="L.width"
    :height="L.height"
    :viewBox="`0 0 ${L.width} ${L.height}`"
    class="font-sans"
    font-size="12"
    role="img"
    :aria-label="L.title ? `Diagramme d’états : ${L.title}` : 'Diagramme d’états'"
  >
    <text v-if="L.title" :x="L.width / 2" :y="L.titleY" text-anchor="middle" font-size="16" font-weight="700" class="seq-text fill-slate-800">{{ L.title }}</text>

    <!-- Composites : le cadre, puis leur nom -->
    <g v-for="s in composites" :key="s.id" :data-id="s.id" class="cursor-pointer" @click.stop="pick(s.id, $event)" @dblclick.stop="edit(s.id)">
      <rect v-if="selected.has(s.id) || flashed(s.id)" :x="s.x - 3" :y="s.y - 3" :width="s.w + 6" :height="s.h + 6" rx="15" fill="none" stroke-width="2" :class="flashed(s.id) ? 'seq-flash-rect' : 'seq-sel-rect'" />
      <rect :x="s.x" :y="s.y" :width="s.w" :height="s.h" rx="12" stroke-width="1.5" class="stroke-slate-500" :style="COMPOSITE_FILL" />
      <text :x="s.x + s.w / 2" :y="s.y + 22" text-anchor="middle" font-weight="700" font-size="13" :style="TEXT">
        <tspan v-for="(line, i) in s.title" :key="i" :x="s.x + s.w / 2" :dy="i ? LINE_H : 0">{{ line }}</tspan>
      </text>
      <line :x1="s.x" :x2="s.x + s.w" :y1="s.y + titleH(s) - 2" :y2="s.y + titleH(s) - 2" stroke-width="1" class="stroke-slate-400" />
      <text v-for="(a, i) in s.actions" :key="`a${i}`" :x="s.x + 12" :y="actionsY(s) + 13 + i * LINE_H" font-size="11" :style="TEXT">{{ a }}</text>
      <template v-if="s.note.length">
        <rect :x="s.x + 8" :y="noteY(s) + 2" :width="s.w - 16" :height="s.note.length * LINE_H + 6" rx="3" stroke="#d6b64a" stroke-width="1" :style="NOTE_FILL" />
        <text v-for="(a, i) in s.note" :key="`n${i}`" :x="s.x + 14" :y="noteY(s) + 15 + i * LINE_H" font-size="11" font-style="italic" :style="NOTE_TEXT">{{ a }}</text>
      </template>
    </g>

    <!-- Transitions -->
    <g v-for="e in L.edges" :key="e.id" :data-id="e.id" class="cursor-pointer" @click.stop="pick(e.id, $event)" @dblclick.stop="edit(e.id)">
      <path :d="e.d" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke" />
      <path :d="e.d" fill="none" stroke-width="1.5" :class="options.has(e.id) ? 'stroke-active' : 'seq-edge stroke-slate-700'" />
      <polygon :points="e.head" stroke-width="1" :class="options.has(e.id) ? 'fill-active stroke-active' : 'seq-edge-fill fill-slate-700 stroke-slate-700'" />
      <template v-if="e.lines.length">
        <rect
          :x="labelBox(e).x" :y="labelBox(e).y" :width="labelBox(e).w" :height="labelBox(e).h" rx="4" stroke-width="1.5"
          :class="[edgeState(e) === 'flash' ? 'seq-flash-rect' : edgeState(e) === 'sel' ? 'seq-sel-rect' : options.has(e.id) ? 'option-label' : 'fill-slate-50 stroke-none']"
        />
        <text :x="e.lx" :y="e.ly - ((e.lines.length - 1) * LINE_H) / 2 + 4" text-anchor="middle" font-size="11" class="seq-text fill-slate-700">
          <tspan v-for="(line, i) in e.lines" :key="i" :x="e.lx" :dy="i ? LINE_H : 0">{{ line }}</tspan>
        </text>
      </template>
    </g>

    <!-- États -->
    <g v-for="s in simples" :key="s.id" :data-id="s.id" class="cursor-pointer" @click.stop="pick(s.id, $event)" @dblclick.stop="edit(s.id)">
      <rect v-if="selected.has(s.id) || flashed(s.id)" :x="s.x - 3" :y="s.y - 3" :width="s.w + 6" :height="s.h + 6" :rx="s.kind === 'state' ? 13 : 4" fill="none" stroke-width="2" :class="flashed(s.id) ? 'seq-flash-rect' : 'seq-sel-rect'" />
      <polygon v-if="s.kind === 'choice'" :points="diamond(s)" stroke-width="1.5" class="stroke-slate-600" :style="FILL" />
      <rect v-else-if="s.kind === 'fork' || s.kind === 'join'" :x="s.x" :y="s.y" :width="s.w" :height="s.h" rx="2" class="seq-edge-fill fill-slate-700 stroke-slate-700" />
      <template v-else>
        <rect :x="s.x" :y="s.y" :width="s.w" :height="s.h" rx="10" stroke-width="1.5" class="stroke-slate-600" :style="FILL" />
        <text :x="s.x + s.w / 2" :y="s.y + 22" text-anchor="middle" font-weight="700" font-size="13" :style="TEXT">
          <tspan v-for="(line, i) in s.title" :key="i" :x="s.x + s.w / 2" :dy="i ? LINE_H : 0">{{ line }}</tspan>
        </text>
        <line v-if="s.actions.length || s.note.length" :x1="s.x" :x2="s.x + s.w" :y1="s.y + titleH(s) - 2" :y2="s.y + titleH(s) - 2" stroke-width="1" class="stroke-slate-500" />
        <text v-for="(a, i) in s.actions" :key="`a${i}`" :x="s.x + 12" :y="actionsY(s) + 13 + i * LINE_H" font-size="11" :style="TEXT">{{ a }}</text>
        <template v-if="s.note.length">
          <rect :x="s.x + 8" :y="noteY(s) + 2" :width="s.w - 16" :height="s.note.length * LINE_H + 6" rx="3" stroke="#d6b64a" stroke-width="1" :style="NOTE_FILL" />
          <text v-for="(a, i) in s.note" :key="`n${i}`" :x="s.x + 14" :y="noteY(s) + 15 + i * LINE_H" font-size="11" font-style="italic" :style="NOTE_TEXT">{{ a }}</text>
        </template>
      </template>
    </g>

    <!-- Point de départ et d'arrivée -->
    <g v-for="p in L.pseudos" :key="p.id">
      <circle v-if="p.type === 'start'" :cx="pseudoCenter(p).x" :cy="pseudoCenter(p).y" :r="p.w / 2" class="seq-edge-fill fill-slate-800 stroke-slate-800" />
      <template v-else>
        <circle :cx="pseudoCenter(p).x" :cy="pseudoCenter(p).y" :r="p.w / 2 - 1" fill="none" stroke-width="2" class="seq-edge stroke-slate-800" />
        <circle :cx="pseudoCenter(p).x" :cy="pseudoCenter(p).y" :r="p.w / 2 - 6" class="seq-edge-fill fill-slate-800 stroke-slate-800" />
      </template>
    </g>

    <!-- Simulation : l'état courant -->
    <rect v-if="simOn && active" :x="active.x - 5" :y="active.y - 5" :width="active.w + 10" :height="active.h + 10" :rx="active.kind === 'state' ? 15 : 6" fill="none" stroke-width="3" class="sim-ring" />
  </svg>
</template>
