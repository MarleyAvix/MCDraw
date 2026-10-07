<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'
import { X } from 'lucide-vue-next'

defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const titleId = useId()
const panel = ref<HTMLElement>()
let previousFocus: HTMLElement | null = null

// Échap ferme la modale même quand le focus n'y est pas (ex. après un clic sur le fond).
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  window.addEventListener('keydown', onKey)
  // `autofocus` n'agit pas sur un élément inséré après le chargement de la page : on le fait à la main.
  ;(panel.value?.querySelector<HTMLElement>('[autofocus]') ?? panel.value)?.focus()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  previousFocus?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <!-- `nokey` : Suppr / Retour arrière dans la modale ne doivent pas supprimer les nœuds sélectionnés du canvas. -->
    <div class="nokey fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @mousedown.self="$emit('close')">
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="flex max-h-[90vh] w-full flex-col rounded-lg bg-surface shadow-xl outline-none"
        :class="wide ? 'max-w-3xl' : 'max-w-xl'"
      >
        <header class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 :id="titleId" class="text-base font-semibold">{{ title }}</h2>
          <button class="rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" aria-label="Fermer" @click="$emit('close')"><X :size="18" /></button>
        </header>
        <div class="overflow-y-auto px-5 py-4"><slot /></div>
        <footer v-if="$slots.footer" class="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
