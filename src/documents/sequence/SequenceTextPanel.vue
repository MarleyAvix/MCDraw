<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, X } from 'lucide-vue-next'
import { useSequenceStore } from './sequenceStore'
import { mergeSeq, parseSeqText, seqToText } from './text'

const store = useSequenceStore()
const uid = () => Math.random().toString(36).slice(2, 10)

// Le texte et le diagramme sont deux écritures du même document : taper met le diagramme à jour en direct (les éléments
// inchangés gardent leur identité), et modifier le diagramme réécrit le texte — sauf pendant la saisie.
const text = ref(seqToText(store.schema))
const focused = ref(false)
const parsed = computed(() => parseSeqText(text.value, uid))

function onInput() {
  if (!parsed.value.errors.length) store.load(mergeSeq(store.schema, parsed.value.doc))
}
function onBlur() {
  focused.value = false
  if (!parsed.value.errors.length) text.value = seqToText(store.schema)
}
watch(
  () => store.schema,
  (s) => {
    if (!focused.value) text.value = seqToText(s)
  },
  { deep: true },
)
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-surface" aria-label="Saisie textuelle du diagramme">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Séquence en texte</h2>
        <p class="text-xs text-slate-400">Syntaxe proche de Mermaid : collez-y un diagramme existant.</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer le panneau" @click="store.showTextPanel = false"><X :size="18" /></button>
    </div>

    <textarea
      v-model="text"
      spellcheck="false"
      wrap="off"
      class="min-h-40 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
      aria-label="Description textuelle du diagramme de séquence"
      placeholder="Client ->> API: POST /login&#10;API -->> Client: 200"
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
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ parsed.doc.participants.length }} participant(s), {{ parsed.doc.items.length }} élément(s)
    </p>

    <details class="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <summary class="cursor-pointer text-sm font-medium">Syntaxe</summary>
      <div class="mt-2 space-y-1.5 font-mono leading-relaxed">
        <p><b>title Connexion</b> · <b>autonumber</b></p>
        <p><b>actor Client as Utilisateur</b><br /><span class="text-slate-400">participant, actor, database ; « as » = libellé affiché (facultatif : un nom cité est créé tout seul)</span></p>
        <p><b>A ->> B: texte</b> appel · <b>A -->> B</b> retour<br /><b>A -) B</b> asynchrone · <b>A --) B</b> · <b>A -x B</b> perdu</p>
        <p><b>A ->>+ B</b> active B · <b>B -->>- A</b> désactive B</p>
        <p><b>Note over A, B: texte</b><br /><b>Note right of A: …</b> · <b>Note left of A: …</b></p>
        <p><b>alt cas / else cas / end</b><br /><b>opt</b> · <b>loop</b> · <b>par / and</b> · <b>critical / option</b> · <b>break</b>, chacun fermé par <b>end</b></p>
        <p class="text-slate-400">&lt;br&gt; dans un texte = retour à la ligne. Commentaires : %% ou //</p>
      </div>
    </details>
  </aside>
</template>
