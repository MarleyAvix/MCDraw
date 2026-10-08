<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Link2, Table2, PanelRightClose, PanelRightOpen } from 'lucide-vue-next'
import { useSchemaStore } from '../../stores/schemaStore'
import { constraintTags, splitColumns } from '../../engine/meriseToMld'

defineProps<{ open: boolean }>()
defineEmits<{ toggle: [] }>()

const store = useSchemaStore()
const mld = computed(() => store.mld)
// Découpage en blocs (clé primaire, clés étrangères, autres colonnes) calculé une fois par table.
const tables = computed(() => mld.value.tables.map((t) => ({ t, cols: splitColumns(t) })))
</script>

<template>
  <aside v-if="!open" class="flex h-full flex-col items-center gap-3 border-l border-slate-200 bg-surface py-3">
    <button class="rounded p-1 text-slate-500 hover:bg-slate-100" title="Afficher le MLD" aria-label="Afficher le MLD" @click="$emit('toggle')">
      <PanelRightOpen :size="18" />
    </button>
    <span class="text-xs font-semibold uppercase tracking-wide text-slate-400 [writing-mode:vertical-rl]">MLD calculé</span>
  </aside>
  <aside v-else class="flex h-full flex-col overflow-y-auto border-l border-slate-200 bg-surface">
    <div class="sticky top-0 z-10 flex items-start gap-2 border-b border-slate-200 bg-surface px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">MLD calculé</h2>
        <p class="text-xs text-slate-400"><u>clé primaire</u> · # clé étrangère</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Replier le MLD" aria-label="Replier le MLD" @click="$emit('toggle')">
        <PanelRightClose :size="18" />
      </button>
    </div>

    <div v-if="store.mldWarnings.length" class="m-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <p v-for="(w, i) in store.mldWarnings" :key="i" class="flex gap-1.5"><AlertTriangle :size="14" class="mt-0.5 shrink-0" /> {{ w }}</p>
    </div>

    <p v-if="!mld.tables.length" class="p-4 text-sm italic text-slate-400">Ajoutez des entités pour voir le MLD.</p>

    <section class="space-y-3 p-3">
      <article v-for="{ t, cols } in tables" :key="t.name" class="overflow-hidden rounded-md border border-slate-200">
        <header class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold" :class="t.origin === 'entity' ? 'bg-indigo-50' : 'bg-amber-50'">
          <Table2 :size="14" class="text-slate-500" /> {{ t.name }}
          <span class="ml-auto text-[10px] font-normal uppercase text-slate-400">{{ t.origin === 'entity' ? 'entité' : 'association' }}</span>
        </header>
        <div class="text-sm">
          <!-- Clé primaire : un seul bloc, même quand elle est composée -->
          <div v-if="cols.pk.length" class="border-l-4 border-amber-500 bg-amber-500/10">
            <div class="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
              Clé primaire{{ cols.pk.length > 1 ? ' composée' : '' }}
            </div>
            <ul class="divide-y divide-slate-100/50">
              <li v-for="c in cols.pk" :key="c.name" class="flex items-center gap-2 px-3 py-1">
                <span class="font-semibold underline"><span v-if="c.isForeignKey" class="text-sky-600">#</span>{{ c.name }}</span>
                <Link2 v-if="c.isForeignKey" :size="11" class="text-sky-500" />
                <span class="ml-auto text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}{{ constraintTags(c) }}</span>
              </li>
            </ul>
          </div>
          <div
            v-for="g in cols.fks"
            :key="g.columns.map((c) => c.name).join()"
            class="border-l-4 border-sky-500 bg-sky-500/10"
          >
            <div class="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">
              Clé étrangère{{ g.columns.length > 1 ? ' composée' : '' }}{{ g.unique && g.columns.length > 1 ? ' unique' : '' }} → {{ g.refTable }}
            </div>
            <ul class="divide-y divide-slate-100/50">
              <li v-for="c in g.columns" :key="c.name" class="flex items-center gap-2 px-3 py-1">
                <span><span class="text-sky-600">#</span>{{ c.name }}</span>
                <span class="ml-auto text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}{{ constraintTags(c) }}</span>
              </li>
            </ul>
          </div>
          <ul class="divide-y divide-slate-100">
            <li v-for="c in cols.others" :key="c.name" class="flex items-center gap-2 px-3 py-1">
              <span><span v-if="c.isForeignKey" class="text-sky-600">#</span>{{ c.name }}</span>
              <Link2 v-if="c.isForeignKey" :size="11" class="text-sky-500" />
              <span class="ml-auto text-[10px] text-slate-400">{{ c.sqlType }}{{ c.nullable ? '' : ' NN' }}{{ constraintTags(c) }}</span>
            </li>
          </ul>
        </div>
        <footer v-if="t.foreignKeys.length" class="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
          <div v-for="fk in t.foreignKeys" :key="fk.columns.join()">
            # {{ fk.columns.join(', ') }} → {{ fk.refTable }}({{ fk.refColumns.join(', ') }})<span v-if="fk.unique"> · 1–1 (UNIQUE)</span><span v-if="fk.onDelete"> · ON DELETE {{ fk.onDelete }}</span><span v-if="fk.onUpdate"> · ON UPDATE {{ fk.onUpdate }}</span>
          </div>
        </footer>
      </article>
    </section>

    <details v-if="mld.tables.length" class="border-t border-slate-200 px-4 py-3 text-sm">
      <summary class="cursor-pointer font-medium text-slate-600">Notation textuelle</summary>
      <div class="mt-2 space-y-1.5 font-mono text-xs leading-relaxed">
        <p v-for="{ t, cols } in tables" :key="t.name">
          <b>{{ t.name }}</b> (<u v-if="cols.pk.length">{{ cols.pk.map((c) => (c.isForeignKey ? '#' : '') + c.name).join(', ') }}</u
          ><template v-for="(c, i) in t.columns.filter((x) => !t.primaryKey.includes(x.name))" :key="c.name"
            ><template v-if="i > 0 || cols.pk.length">, </template>{{ (c.isForeignKey ? '#' : '') + c.name }}</template>)
        </p>
      </div>
    </details>
  </aside>
</template>
