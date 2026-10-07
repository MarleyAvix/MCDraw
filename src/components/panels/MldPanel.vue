<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Link2, Table2 } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'

const store = useSchemaStore()
const mld = computed(() => store.mld)
</script>

<template>
  <aside class="flex h-full flex-col overflow-y-auto border-l border-slate-200 bg-surface">
    <div class="sticky top-0 z-10 border-b border-slate-200 bg-surface px-4 py-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">MLD calculé</h2>
      <p class="text-xs text-slate-400"><u>clé primaire</u> · # clé étrangère</p>
    </div>

    <div v-if="mld.warnings.length" class="m-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <p v-for="w in mld.warnings" :key="w" class="flex gap-1.5"><AlertTriangle :size="14" class="mt-0.5 shrink-0" /> {{ w }}</p>
    </div>

    <p v-if="!mld.tables.length" class="p-4 text-sm italic text-slate-400">Ajoutez des entités pour voir le MLD.</p>

    <section class="space-y-3 p-3">
      <article v-for="t in mld.tables" :key="t.name" class="overflow-hidden rounded-md border border-slate-200">
        <header class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold" :class="t.origin === 'entity' ? 'bg-indigo-50' : 'bg-amber-50'">
          <Table2 :size="14" class="text-slate-500" /> {{ t.name }}
          <span class="ml-auto text-[10px] font-normal uppercase text-slate-400">{{ t.origin === 'entity' ? 'entité' : 'association' }}</span>
        </header>
        <ul class="divide-y divide-slate-100 text-sm">
          <li v-for="c in t.columns" :key="c.name" class="flex items-center gap-2 px-3 py-1">
            <span :class="c.isPrimaryKey ? 'font-semibold underline' : ''">
              <span v-if="c.isForeignKey" class="text-sky-600">#</span>{{ c.name }}
            </span>
            <Link2 v-if="c.isForeignKey" :size="11" class="text-sky-500" />
            <span class="ml-auto text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}</span>
          </li>
        </ul>
        <footer v-if="t.foreignKeys.length" class="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
          <div v-for="fk in t.foreignKeys" :key="fk.columns.join()">
            # {{ fk.columns.join(', ') }} → {{ fk.refTable }}({{ fk.refColumns.join(', ') }})
          </div>
        </footer>
      </article>
    </section>

    <details v-if="mld.tables.length" class="border-t border-slate-200 px-4 py-3 text-sm">
      <summary class="cursor-pointer font-medium text-slate-600">Notation textuelle</summary>
      <div class="mt-2 space-y-1.5 font-mono text-xs leading-relaxed">
        <p v-for="t in mld.tables" :key="t.name">
          <b>{{ t.name }}</b> (<template v-for="(c, i) in t.columns" :key="c.name"
            ><span :class="c.isPrimaryKey ? 'underline' : ''"><template v-if="c.isForeignKey">#</template>{{ c.name }}</span
            ><template v-if="i < t.columns.length - 1">, </template></template>)
        </p>
      </div>
    </details>
  </aside>
</template>
