<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, X } from 'lucide-vue-next'
import { useStateStore } from './stateStore'
import { walkStates, walkTransitions } from './model'
import { mergeState, parseStateText, stateToText } from './text'

const store = useStateStore()
const uid = () => Math.random().toString(36).slice(2, 10)

// Le texte et le diagramme sont deux écritures du même document : taper met le diagramme à jour en direct (les éléments
// inchangés gardent leur identité), et modifier le diagramme réécrit le texte — sauf pendant la saisie.
const text = ref(stateToText(store.schema))
const focused = ref(false)
const parsed = computed(() => parseStateText(text.value, uid))
const count = computed(() => {
  const n = { states: 0, transitions: 0 }
  walkStates(parsed.value.doc, () => n.states++)
  walkTransitions(parsed.value.doc, () => n.transitions++)
  return n
})

function onInput() {
  if (!parsed.value.errors.length) store.load(mergeState(store.schema, parsed.value.doc))
}
function onBlur() {
  focused.value = false
  if (!parsed.value.errors.length) text.value = stateToText(store.schema)
}
watch(
  () => store.schema,
  (s) => {
    if (!focused.value) text.value = stateToText(s)
  },
  { deep: true },
)
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-surface" aria-label="Saisie textuelle du diagramme d’états">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">États en texte</h2>
        <p class="text-xs text-slate-400">Syntaxe proche de Mermaid : collez-y un diagramme existant.</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer le panneau" @click="store.showTextPanel = false"><X :size="18" /></button>
    </div>

    <textarea
      v-model="text"
      spellcheck="false"
      wrap="off"
      class="min-h-40 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
      aria-label="Description textuelle du diagramme d’états"
      placeholder="[*] --> Brouillon&#10;Brouillon --> Envoyé : envoyer"
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
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ count.states }} état(s), {{ count.transitions }} transition(s)
    </p>

    <details class="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <summary class="cursor-pointer text-sm font-medium">Syntaxe</summary>
      <div class="mt-2 space-y-1.5 font-mono leading-relaxed">
        <p><b>title Cycle d'une commande</b> · <b>direction LR</b></p>
        <p><b>A --> B : événement [garde] / action</b><br /><span class="text-slate-400">chaque partie est facultative ; un état cité est créé tout seul</span></p>
        <p><b>[*] --> A</b> état initial · <b>A --> [*]</b> état final</p>
        <p><b>state "Libellé long" as A</b><br /><b>state Choix &lt;&lt;choice&gt;&gt;</b> · <b>&lt;&lt;fork&gt;&gt;</b> · <b>&lt;&lt;join&gt;&gt;</b></p>
        <p><b>state Bloc {</b> … <b>}</b> état composite (ses propres <b>[*]</b>)</p>
        <p><b>A : entrée / action</b> ligne sous le nom<br /><b>note right of A : texte</b></p>
        <p class="text-slate-400">&lt;br&gt; dans un texte = retour à la ligne. Commentaires : %% ou //</p>
      </div>
    </details>
  </aside>
</template>
