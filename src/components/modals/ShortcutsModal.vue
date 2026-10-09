<script setup lang="ts">
import { useSchemaStore } from '../../stores/schemaStore'

const store = useSchemaStore()

const btn = "inline-flex items-center justify-center rounded-md border border-slate-300 bg-surface px-4 py-2 text-sm font-medium hover:bg-slate-100"
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
    <div class="w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl">
      <h2 class="mb-4 text-xl font-bold">Raccourcis clavier</h2>
      <div class="space-y-3 text-sm">
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Ajouter une entité</span>
          <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">N</kbd>
        </div>
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Ajouter une association</span>
          <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">A</kbd>
        </div>
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Annuler</span>
          <div class="flex gap-1">
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Ctrl</kbd>
            <span>+</span>
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Z</kbd>
          </div>
        </div>
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Rétablir</span>
          <div class="flex gap-1">
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Ctrl</kbd>
            <span>+</span>
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Y</kbd>
          </div>
        </div>
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Tout sélectionner</span>
          <div class="flex gap-1">
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Ctrl</kbd>
            <span>+</span>
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">A</kbd>
          </div>
        </div>
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Copier</span>
          <div class="flex gap-1">
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Ctrl</kbd>
            <span>+</span>
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">C</kbd>
          </div>
        </div>
        <div class="flex justify-between border-b border-slate-100 pb-2">
          <span class="font-semibold text-slate-600">Coller</span>
          <div class="flex gap-1">
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Ctrl</kbd>
            <span>+</span>
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">V</kbd>
          </div>
        </div>
        <div class="flex justify-between pb-2">
          <span class="font-semibold text-slate-600">Dupliquer</span>
          <div class="flex gap-1">
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">Ctrl</kbd>
            <span>+</span>
            <kbd class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">D</kbd>
          </div>
        </div>
      </div>
      <div class="mt-6 flex justify-end gap-3">
        <button :class="btn" @click="store.showShortcutsModal = false">Fermer</button>
      </div>
    </div>
  </div>
</template>
