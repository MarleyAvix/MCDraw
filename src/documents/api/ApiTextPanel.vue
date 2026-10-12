<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, X } from 'lucide-vue-next'
import { useApiStore } from './apiStore'
import { apiToText, mergeApi, parseApiText } from './text'

const store = useApiStore()
const uid = () => Math.random().toString(36).slice(2, 10)

// Le texte et le diagramme sont deux écritures de la même API : taper met le diagramme à jour en direct (les routes et
// schémas gardent leur identité tant que leur méthode, leur chemin ou leur nom ne changent pas), et modifier le diagramme
// réécrit le texte — sauf pendant la saisie.
const text = ref(apiToText(store.schema))
const focused = ref(false)
const parsed = computed(() => parseApiText(text.value, uid))

function onInput() {
  if (!parsed.value.errors.length) store.load(mergeApi(store.schema, parsed.value.api))
}
function onBlur() {
  focused.value = false
  if (!parsed.value.errors.length) text.value = apiToText(store.schema)
}
watch(
  () => store.schema,
  (s) => {
    if (!focused.value) text.value = apiToText(s)
  },
  { deep: true },
)
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-surface" aria-label="Saisie textuelle de l'API">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">API en texte</h2>
        <p class="text-xs text-slate-400">Schémas et routes, l'indentation fait l'arbre.</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer le panneau" @click="store.showTextPanel = false"><X :size="18" /></button>
    </div>

    <textarea
      v-model="text"
      spellcheck="false"
      wrap="off"
      class="min-h-40 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
      aria-label="Description textuelle de l'API"
      placeholder="schema User&#10;  id: uuid&#10;  name: string&#10;&#10;/users&#10;  GET Lister -> 200 User[]"
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
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ parsed.api.endpoints.length }} route(s), {{ parsed.api.resources.length }} schéma(s)
    </p>

    <details class="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <summary class="cursor-pointer text-sm font-medium">Syntaxe</summary>
      <div class="mt-2 space-y-1.5 font-mono leading-relaxed">
        <p><b>@title Boutique</b><br /><span class="text-slate-400">@version, @server, @description, @auth bearer</span></p>
        <p><b>schema User</b> puis champs<br /><span class="text-slate-400">nom: type (type? = facultatif)</span></p>
        <p><b>/users</b> puis <b>/{id:uuid}</b><br /><span class="text-slate-400">chemins imbriqués par l'indentation</span></p>
        <p><b>GET Lister [auth] [paginated] -> 200 User[], 404</b><br /><span class="text-slate-400">méthode, résumé, drapeaux, réponses</span></p>
        <p><b>&lt; UserInput</b> corps · <b>&gt; 201 User -- note</b> réponse<br /><b>? q: string?</b> requête · <b>@ X-Id: uuid</b> en-tête<br /><b># users, admin</b> groupes · <b>~ texte</b> description · <b>[deprecated]</b></p>
        <p class="text-slate-400">Types : string int number bool date datetime uuid email url any, Schéma, Schéma[], enum(a|b)</p>
      </div>
    </details>
  </aside>
</template>
