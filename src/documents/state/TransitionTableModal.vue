<script setup lang="ts">
import { computed } from 'vue'
import { ClipboardCopy, FileDown } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { downloadBlob } from '../../composables/useFileIO'
import { useStateStore } from './stateStore'
import { AUTO, tableToCsv, tableToMarkdown, transitionTable } from './table'

const store = useStateStore()
const table = computed(() => transitionTable(store.doc))
const close = () => (store.showTable = false)

async function copyMarkdown() {
  const md = tableToMarkdown(table.value)
  try {
    await navigator.clipboard.writeText(md)
    alert('Tableau Markdown copié dans le presse-papiers.')
  } catch {
    downloadBlob(md, 'text/markdown', 'transitions.md')
  }
}
</script>

<template>
  <BaseModal title="Tableau des transitions" wide @close="close">
    <p v-if="!table.rows.length" class="text-sm text-slate-600">Le diagramme n'a pas encore de transition.</p>
    <template v-else>
      <p class="mb-3 text-sm text-slate-600">Une ligne par état, une colonne par événement. Une case vide : l'état ne réagit pas à cet événement.</p>
      <div class="overflow-auto rounded border border-slate-200">
        <table class="w-full border-collapse text-xs" aria-label="Transitions par état et par événement">
          <thead class="bg-slate-100 text-left">
            <tr>
              <th class="sticky left-0 border-b border-slate-200 bg-slate-100 px-3 py-2 font-semibold">État</th>
              <th v-for="e in table.events" :key="e" class="whitespace-nowrap border-b border-l border-slate-200 px-3 py-2 font-semibold" :class="e === AUTO ? 'italic text-slate-500' : ''">{{ e }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in table.rows" :key="r.name" class="odd:bg-slate-50/60">
              <th class="sticky left-0 whitespace-nowrap border-b border-slate-200 bg-surface px-3 py-1.5 text-left font-medium" :style="{ paddingLeft: `${12 + r.depth * 14}px` }">{{ r.label }}</th>
              <td v-for="(cell, i) in r.cells" :key="i" class="border-b border-l border-slate-200 px-3 py-1.5 align-top">
                <span v-if="!cell.length" class="text-slate-300">—</span>
                <span v-for="(c, j) in cell" :key="j" class="block whitespace-nowrap">→ {{ c }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <button class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50" :disabled="!table.rows.length" @click="copyMarkdown"><ClipboardCopy :size="14" /> Copier en Markdown</button>
        <button class="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50" :disabled="!table.rows.length" @click="downloadBlob(tableToCsv(table), 'text/csv', 'transitions.csv')"><FileDown :size="14" /> Télécharger le CSV</button>
      </div>
      <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="close">Fermer</button>
    </template>
  </BaseModal>
</template>
