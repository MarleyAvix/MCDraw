<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, X } from 'lucide-vue-next'
import { useClassStore } from './classStore'
import { classesToText, parseClassText } from './text'

const store = useClassStore()

// Le texte et le diagramme sont deux écritures du même document : taper met le diagramme à jour en direct,
// et modifier le diagramme réécrit le texte — sauf pendant la saisie.
const text = ref(classesToText(store.schema))
const focused = ref(false)
const parsed = computed(() => parseClassText(text.value))

function onInput() {
  if (!parsed.value.errors.length) store.load(parsed.value.doc)
}
function onBlur() {
  focused.value = false
  if (!parsed.value.errors.length) text.value = classesToText(store.schema)
}
watch(
  () => store.schema,
  (s) => {
    if (!focused.value) text.value = classesToText(s)
  },
  { deep: true },
)
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-surface" aria-label="Saisie textuelle du diagramme">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Classes en texte</h2>
        <p class="text-xs text-slate-400">Syntaxe de Mermaid : collez-y un diagramme existant.</p>
      </div>
      <button class="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer le panneau" @click="store.showTextPanel = false"><X :size="18" /></button>
    </div>

    <textarea
      v-model="text"
      spellcheck="false"
      wrap="off"
      class="min-h-40 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
      aria-label="Description textuelle du diagramme de classes"
      placeholder="class Animal {&#10;  +nom: String&#10;}&#10;Animal &lt;|-- Chien"
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
      <CheckCircle2 :size="13" class="text-emerald-500" /> {{ parsed.doc.classes.length }} classe(s), {{ parsed.doc.relations.length }} relation(s)
    </p>

    <details class="border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <summary class="cursor-pointer text-sm font-medium">Syntaxe</summary>
      <div class="mt-2 space-y-1.5 font-mono leading-relaxed">
        <p><b>title Ma bibliothèque</b></p>
        <p><b>class Animal {</b><br />&nbsp;&nbsp;<b>&lt;&lt;abstract&gt;&gt;</b> <span class="text-slate-400">ou interface, enumeration</span><br />&nbsp;&nbsp;<b>+nom: String</b> <span class="text-slate-400">attribut</span><br />&nbsp;&nbsp;<b>+manger() void</b> <span class="text-slate-400">méthode (contient « ( »)</span><br /><b>}</b></p>
        <p><b>Animal : +age: int</b> <span class="text-slate-400">ajoute un membre</span></p>
        <p><b>A &lt;|-- B</b> héritage · <b>A &lt;|.. B</b> réalisation<br /><b>A *-- B</b> composition · <b>A o-- B</b> agrégation<br /><b>A &lt;-- B</b> association · <b>A &lt;.. B</b> dépendance · <b>A -- B</b> lien</p>
        <p><b>A "1" *-- "0..*" B : contient</b><br /><span class="text-slate-400">multiplicités entre guillemets, libellé après « : »</span></p>
        <p class="text-slate-400">Une classe citée dans une relation est créée toute seule. Commentaires : %% ou //</p>
      </div>
    </details>
  </aside>
</template>
