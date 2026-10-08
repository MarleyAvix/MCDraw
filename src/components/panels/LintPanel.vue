<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { lintSchema, type LintIssue } from '../../engine/lintSchema'

const store = useSchemaStore()
const flow = useVueFlow('mcdraw')
const open = ref(false)

const issues = computed(() => lintSchema(store.schema))
const warnings = computed(() => issues.value.filter((i) => i.severity === 'warning').length)

/** Sélectionne les éléments concernés, recadre le canvas sur le premier et le fait clignoter. */
function show(issue: LintIssue) {
  store.selection = issue.nodeIds
  const node = flow.findNode(issue.nodeIds[0])
  if (node) {
    const w = node.dimensions?.width || 180
    const h = node.dimensions?.height || 100
    flow.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: Math.max(flow.viewport.value.zoom, 0.9), duration: 350 })
  }
  store.flash(issue.nodeIds[0])
}
</script>

<template>
  <div class="absolute bottom-3 right-3 z-20 flex w-80 max-w-[calc(100%-1.5rem)] flex-col items-end gap-1.5">
    <ul
      v-if="open && issues.length"
      class="max-h-72 w-full divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-surface text-xs shadow-lg"
      aria-label="Avertissements de conception"
    >
      <li v-for="i in issues" :key="i.id">
        <button class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-100" @click="show(i)">
          <AlertTriangle v-if="i.severity === 'warning'" :size="14" class="mt-0.5 shrink-0 text-amber-500" />
          <Info v-else :size="14" class="mt-0.5 shrink-0 text-sky-500" />
          <span>{{ i.message }}</span>
        </button>
      </li>
    </ul>
    <button
      class="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-medium shadow-sm"
      :class="issues.length ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-slate-200 text-slate-500'"
      :disabled="!issues.length"
      :aria-expanded="open && issues.length > 0"
      :title="issues.length ? 'Afficher les avertissements de conception' : 'Aucun problème de conception détecté'"
      @click="open = !open"
    >
      <component :is="issues.length ? AlertTriangle : CheckCircle2" :size="13" />
      <template v-if="issues.length">{{ issues.length }} {{ issues.length > 1 ? 'remarques' : 'remarque' }}<template v-if="warnings < issues.length"> ({{ warnings }} à corriger)</template></template>
      <template v-else>Conception OK</template>
      <ChevronDown v-if="issues.length" :size="13" class="transition-transform" :class="open ? '' : 'rotate-180'" />
    </button>
  </div>
</template>
