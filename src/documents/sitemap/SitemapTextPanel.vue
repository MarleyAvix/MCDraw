<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, X } from 'lucide-vue-next'
import { useSitemapStore } from './sitemapStore'
import { mergeSitemap, parseSitemapText, sitemapToText } from './engine'

const store = useSitemapStore()
const uid = () => Math.random().toString(36).slice(2, 10)

// Le texte et l'arbre sont deux écritures du même plan : taper met l'arbre à jour en direct (les pages gardent leur
// identité tant que leur chemin ne change pas), et modifier l'arbre réécrit le texte — sauf pendant la saisie.
const text = ref(sitemapToText(store.schema))
const focused = ref(false)
const parsed = computed(() => parseSitemapText(text.value, uid))

function onInput() {
  if (!parsed.value.errors.length) store.load(mergeSitemap(store.schema, parsed.value.schema))
}
function onBlur() {
  focused.value = false
  if (!parsed.value.errors.length) text.value = sitemapToText(store.schema)
}
watch(
  () => store.schema,
  (s) => {
    if (!focused.value) text.value = sitemapToText(s)
  },
  { deep: true },
)
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-surface" aria-label="Saisie textuelle du plan de site">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Plan en texte</h2>
        <p class="text-xs text-slate-400">Une page par ligne, l'indentation fait l'arbre.</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer le panneau" @click="store.showTextPanel = false"><X :size="18" /></button>
    </div>

    <textarea
      v-model="text"
      spellcheck="false"
      wrap="off"
      class="min-h-40 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
      aria-label="Description textuelle du plan de site"
      placeholder="Accueil /&#10;  Produits /produits&#10;  Contact /contact"
      @focus="focused = true"
      @blur="onBlur"
      @input="onInput"
    />

    <ul v-if="parsed.errors.length" class="max-h-32 space-y-1 overflow-y-auto border-t border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <li v-for="(e, i) in parsed.errors" :key="i" class="flex gap-1.5">
        <AlertTriangle :size="13" class="mt-0.5 shrink-0" />
        <span><b>L{{ e.line }}</b> · {{ e.message }}</span>
      </li>
    </ul>
    <p v-else class="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ parsed.schema.pages.length }} page(s)
    </p>

    <details class="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <summary class="cursor-pointer text-sm font-medium">Syntaxe</summary>
      <div class="mt-2 space-y-1.5 font-mono leading-relaxed">
        <p><b>Produits /produits</b><br /><span class="text-slate-400">titre, puis adresse (commence par / ou http)</span></p>
        <p><b>Chaussures</b> (2 espaces de plus)<br /><span class="text-slate-400">sous-page de la ligne au-dessus</span></p>
        <p><b>Contact /contact -- à relire</b><br /><span class="text-slate-400">note après « -- »</span></p>
        <p class="text-slate-400">// pour un commentaire</p>
      </div>
    </details>
  </aside>
</template>
