<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{ title: string; wide?: boolean }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @mousedown.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="flex max-h-[90vh] w-full flex-col rounded-lg bg-surface shadow-xl" :class="wide ? 'max-w-3xl' : 'max-w-xl'">
        <header class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 class="text-base font-semibold">{{ title }}</h2>
          <button class="rounded p-1 text-slate-500 hover:bg-slate-100" title="Fermer" @click="$emit('close')"><X :size="18" /></button>
        </header>
        <div class="overflow-y-auto px-5 py-4"><slot /></div>
        <footer v-if="$slots.footer" class="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
