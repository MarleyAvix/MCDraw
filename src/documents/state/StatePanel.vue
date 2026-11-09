<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Flag, Play, RotateCcw, Square } from 'lucide-vue-next'
import { useStateStore } from './stateStore'
import { findState, stateLabel, transitionLabel } from './model'
import type { StateIssue } from './lint'

// Deux petits panneaux posés sur le canvas : les remarques de conception (en haut à droite) et la simulation (en bas).
const store = useStateStore()
const open = ref(false)

const issues = computed(() => store.issues)
const errors = computed(() => issues.value.filter((i) => i.severity === 'error').length)
const warnings = computed(() => issues.value.filter((i) => i.severity === 'warning').length)
const tone = computed(() => (errors.value ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'))

function show(issue: StateIssue) {
  store.selection = [issue.key]
  store.flash(issue.key)
}

const sim = computed(() => store.sim)
const currentLabel = computed(() => {
  const s = sim.value.current ? findState(store.doc, sim.value.current)?.state : undefined
  return s ? stateLabel(s) : ''
})
const label = (t: Parameters<typeof transitionLabel>[0]) => transitionLabel(t) || 'automatique'
const target = (to: string) => (to === '[*]' ? 'fin' : (findState(store.doc, to) ? stateLabel(findState(store.doc, to)!.state) : to))
</script>

<template>
  <div class="absolute right-3 top-3 z-20 flex w-96 max-w-[calc(100%-1.5rem)] flex-col items-end gap-1.5">
    <button
      class="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-medium shadow-sm"
      :class="issues.length ? tone : 'border-slate-200 text-slate-500'"
      :disabled="!issues.length"
      :aria-expanded="open && issues.length > 0"
      :title="issues.length ? 'Afficher les remarques de conception' : 'Aucune remarque de conception'"
      @click="open = !open"
    >
      <component :is="issues.length ? (errors ? AlertCircle : AlertTriangle) : CheckCircle2" :size="13" />
      <template v-if="issues.length">
        {{ issues.length }} {{ issues.length > 1 ? 'remarques' : 'remarque' }} ({{ errors ? `${errors} erreur${errors > 1 ? 's' : ''}` : '' }}{{ errors && warnings ? ', ' : '' }}{{ warnings ? `${warnings} à corriger` : '' }})
      </template>
      <template v-else>Conception OK</template>
      <ChevronDown v-if="issues.length" :size="13" class="transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>
    <ul
      v-if="open && issues.length"
      class="max-h-72 w-full divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-surface text-xs shadow-lg"
      aria-label="Remarques de conception du diagramme d'états"
    >
      <li v-for="(i, n) in issues" :key="`${i.rule}:${n}`">
        <button class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-100" @click="show(i)">
          <AlertCircle v-if="i.severity === 'error'" :size="14" class="mt-0.5 shrink-0 text-red-500" />
          <AlertTriangle v-else :size="14" class="mt-0.5 shrink-0 text-amber-500" />
          <span>{{ i.message }}</span>
        </button>
      </li>
    </ul>
    <!-- Simulation -->
    <section v-if="sim.on" class="w-full rounded-lg border border-slate-200 bg-surface p-3 shadow-lg" aria-label="Simulation du diagramme d'états">
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Play :size="12" /> Simulation</span>
        <span v-if="sim.ended" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><Flag :size="12" /> Terminé</span>
        <span class="flex-1" />
        <button class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" title="Repartir de l'état initial" @click="store.simStart()"><RotateCcw :size="12" /> Recommencer</button>
        <button class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" title="Quitter la simulation" @click="store.simStop()"><Square :size="12" /> Arrêter</button>
      </div>
      <p v-if="!sim.ended && sim.current" class="mt-2 text-sm">État courant : <b data-testid="sim-current">{{ currentLabel }}</b></p>
      <p v-else-if="!sim.ended" class="mt-2 text-sm text-amber-700">Aucun état initial : ajoutez « [*] --> État ».</p>

      <div v-if="store.simOptions.length" class="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Transitions possibles">
        <button
          v-for="o in store.simOptions"
          :key="o.t.id"
          class="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
          :title="`${o.via} → ${target(o.t.to)}`"
          @click="store.simFire(o.t.id)"
        >
          <span class="truncate font-medium">{{ label(o.t) }}</span>
          <span class="text-indigo-400">→</span>
          <span class="truncate">{{ target(o.t.to) }}</span>
        </button>
      </div>
      <p v-else-if="sim.current && !sim.ended" class="mt-2 text-xs text-slate-500">Aucune transition possible depuis cet état.</p>

      <ol v-if="sim.trace.length" class="mt-2 flex max-h-16 flex-wrap gap-x-1 gap-y-0.5 overflow-y-auto text-xs text-slate-500" aria-label="Chemin parcouru">
        <li v-for="(s, i) in sim.trace" :key="i" class="whitespace-nowrap">
          <span v-if="i === 0">{{ s.from }}</span>
          <span class="text-slate-400"> —{{ s.label }}→ </span><span>{{ s.to ?? 'fin' }}</span>
        </li>
      </ol>
    </section>
  </div>

</template>
