<script setup lang="ts">
import { computed } from 'vue'
import { Undo2, Redo2 } from 'lucide-vue-next'
import { useActiveDocument } from '../../core/useActiveDocument'

const { type, doc, view, ctx } = useActiveDocument()

const GROUPS = ['create', 'tools', 'danger'] as const
// Les actions du type, regroupées : création | outils (avec annuler / rétablir) | action destructive.
const groups = computed(() =>
  GROUPS.map((id) => ({
    id,
    actions: type.value.actions.filter((a) => (a.group ?? 'tools') === id && (!a.views || a.views.includes(view.value.id))),
    history: id === 'tools' && view.value.editable,
  })).filter((g) => g.actions.length || g.history),
)

const btn = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface shadow-sm'
</script>

<template>
  <div class="absolute bottom-4 left-16 z-10 flex items-center gap-2 rounded-lg bg-surface/80 p-2 shadow-lg backdrop-blur-sm border border-slate-200">
    <template v-for="(g, i) in groups" :key="g.id">
      <span v-if="i > 0" class="mx-1 h-6 w-px bg-slate-200" />
      <template v-if="g.history">
        <button :class="btn" :disabled="!doc.canUndo.value" title="Annuler (Ctrl+Z)" @click="doc.undo()"><Undo2 :size="16" /></button>
        <button :class="btn" :disabled="!doc.canRedo.value" title="Rétablir (Ctrl+Y)" @click="doc.redo()"><Redo2 :size="16" /></button>
      </template>
      <button
        v-for="a in g.actions"
        :key="a.id"
        :class="[btn, a.pressed?.(ctx()) ? 'border-indigo-600 text-indigo-600' : '']"
        :title="a.title"
        :aria-pressed="a.pressed ? a.pressed(ctx()) : undefined"
        :disabled="a.disabled?.(ctx())"
        :aria-label="a.compact ? a.label : undefined"
        @click="a.run(ctx())"
      >
        <component :is="a.icon" :size="16" :class="a.iconClass" /> <span :class="a.compact ? 'hidden 2xl:inline' : ''">{{ a.label }}</span>
      </button>
    </template>
  </div>
</template>
