<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-vue-next'
import { useApiStore } from './apiStore'
import type { LintIssue } from './lint'

const store = useApiStore()
const open = ref(false)

const issues = computed(() => store.issues)
const errors = computed(() => issues.value.filter((i) => i.severity === 'error').length)
const warnings = computed(() => issues.value.filter((i) => i.severity === 'warning').length)
const tone = computed(() => (errors.value ? 'border-red-300 text-red-700 hover:bg-red-50' : warnings.value ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-sky-300 text-sky-700 hover:bg-sky-50'))

/** Va sur la route ou le schéma concerné : bascule de vue si besoin, sélectionne, recadre et fait clignoter. */
async function show(issue: LintIssue) {
  const endpoint = issue.endpointId ? store.endpointById.get(issue.endpointId) : undefined
  const id = endpoint ? endpoint.path : issue.resourceId
  if (!id) return
  store.view = endpoint ? 'routes' : 'schemas'
  store.selection = [id]
  await nextTick()
  const flow = useVueFlow(endpoint ? 'api-routes' : 'api-schemas')
  const node = flow.findNode(id)
  if (node) {
    const w = node.dimensions?.width || 250
    const h = node.dimensions?.height || 100
    flow.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: Math.max(flow.viewport.value.zoom, 0.9), duration: 350 })
  }
  store.flash(id)
}
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
      <component :is="issues.length ? (errors ? AlertCircle : warnings ? AlertTriangle : Info) : CheckCircle2" :size="13" />
      <template v-if="issues.length">
        {{ issues.length }} {{ issues.length > 1 ? 'remarques' : 'remarque' }}<template v-if="errors || warnings"> ({{ errors ? `${errors} erreur${errors > 1 ? 's' : ''}` : '' }}{{ errors && warnings ? ', ' : '' }}{{ warnings ? `${warnings} à corriger` : '' }})</template>
      </template>
      <template v-else>Conception OK</template>
      <ChevronDown v-if="issues.length" :size="13" class="transition-transform" :class="open ? 'rotate-180' : ''" />
    </button>
    <ul
      v-if="open && issues.length"
      class="max-h-72 w-full divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-surface text-xs shadow-lg"
      aria-label="Remarques de conception de l'API"
    >
      <li v-for="(i, n) in issues" :key="`${i.rule}:${n}`">
        <button class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-100" @click="show(i)">
          <AlertCircle v-if="i.severity === 'error'" :size="14" class="mt-0.5 shrink-0 text-red-500" />
          <AlertTriangle v-else-if="i.severity === 'warning'" :size="14" class="mt-0.5 shrink-0 text-amber-500" />
          <Info v-else :size="14" class="mt-0.5 shrink-0 text-sky-500" />
          <span>{{ i.message }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
