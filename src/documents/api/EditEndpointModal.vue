<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-vue-next'
import BaseModal from '../../components/modals/BaseModal.vue'
import { useApiStore } from './apiStore'
import { METHOD_COLOR } from './methodStyle'
import { isParamType, METHODS, normalizePath, normalizeType, paramNamesOf, PRIMITIVES, statusText, pathParams, type ApiEndpoint, type ApiParam, type HttpMethod } from './model'

const store = useApiStore()
const endpoint = computed(() => store.endpointById.get(store.editingEndpointId ?? ''))

// Copie de travail : validée uniquement à l'enregistrement.
const e = endpoint.value
const method = ref<HttpMethod>(e?.method ?? 'GET')
const path = ref(e?.path ?? '/')
const summary = ref(e?.summary ?? '')
const auth = ref(!!e?.auth)
const paginated = ref(!!e?.paginated)
const extraParams = ref<ApiParam[]>(e?.params.filter((p) => p.in !== 'path').map((p) => ({ ...p })) ?? [])
const pathTypes = reactive<Record<string, string>>(Object.fromEntries((e?.params ?? []).filter((p) => p.in === 'path').map((p) => [p.name, p.type])))
const bodyType = ref(e?.body?.type ?? '')
const bodyDesc = ref(e?.body?.description ?? '')
const responses = ref(e?.responses.map((r) => ({ status: String(r.status), type: r.type ?? '', description: r.description ?? '' })) ?? [])

const normalized = computed(() => normalizePath(path.value.trim() || '/'))
const pathNames = computed(() => (normalized.value.error ? [] : paramNamesOf(normalized.value.path)))

const typeOk = (t: string, simple = false) => !t.trim() || (normalizeType(t) !== null && (!simple || isParamType(normalizeType(t)!)))
const problems = computed(() => {
  const out: string[] = []
  if (normalized.value.error) out.push(normalized.value.error)
  for (const n of pathNames.value) if (!typeOk(pathTypes[n] ?? '', true)) out.push(`Type invalide pour {${n}}.`)
  for (const p of extraParams.value) {
    if (!p.name.trim()) out.push('Un paramètre n’a pas de nom.')
    if (!typeOk(p.type, true)) out.push(`Type invalide pour « ${p.name || '?'} » (valeur simple attendue).`)
  }
  if (!typeOk(bodyType.value)) out.push('Type du corps invalide.')
  const seen = new Set<number>()
  for (const r of responses.value) {
    const s = Number(r.status)
    if (!Number.isInteger(s) || s < 100 || s > 599) out.push(`Code HTTP invalide : « ${r.status} ».`)
    else if (seen.has(s)) out.push(`Le code ${s} est décrit deux fois.`)
    seen.add(s)
    if (!typeOk(r.type)) out.push(`Type invalide pour la réponse ${r.status}.`)
  }
  return out
})

const suggestions = computed(() => [...PRIMITIVES, ...store.resources.map((r) => r.name), ...store.resources.map((r) => `${r.name}[]`)])
const QUICK = [200, 201, 204, 400, 401, 403, 404, 409, 422]

const addParam = (where: 'query' | 'header') => extraParams.value.push({ name: '', in: where, type: 'string', optional: true })
const addResponse = (status = 200) => responses.value.push({ status: String(status), type: '', description: '' })

const close = () => (store.editingEndpointId = null)
function save() {
  if (!e || problems.value.length) return
  const { path: finalPath } = normalized.value
  const next: ApiEndpoint = {
    id: e.id,
    method: method.value,
    path: finalPath,
    ...(summary.value.trim() ? { summary: summary.value.trim() } : {}),
    ...(auth.value ? { auth: true } : {}),
    ...(paginated.value ? { paginated: true } : {}),
    params: [
      ...pathParams(finalPath, pathTypes),
      ...extraParams.value
        .filter((p) => p.name.trim())
        .map((p) => ({ name: p.name.trim(), in: p.in, type: normalizeType(p.type) ?? 'string', ...(p.optional ? { optional: true } : {}), ...(p.description?.trim() ? { description: p.description.trim() } : {}) })),
    ],
    ...(bodyType.value.trim() ? { body: { type: normalizeType(bodyType.value)!, ...(bodyDesc.value.trim() ? { description: bodyDesc.value.trim() } : {}) } } : {}),
    responses: responses.value.map((r) => ({
      status: Number(r.status),
      ...(r.type.trim() ? { type: normalizeType(r.type)! } : {}),
      ...(r.description.trim() ? { description: r.description.trim() } : {}),
    })),
  }
  store.setEndpoint(next)
  store.selection = [finalPath]
  close()
}
function remove() {
  if (e) store.removeEndpoint(e.id)
}

const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5'
const cell = 'rounded border border-slate-300 px-2 py-1 text-sm'
const iconBtn = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600'
</script>

<template>
  <BaseModal v-if="endpoint" title="Modifier la route" wide @close="close">
    <datalist id="api-types"><option v-for="t in suggestions" :key="t" :value="t" /></datalist>

    <div class="grid gap-4 sm:grid-cols-[9rem_1fr]">
      <label class="text-sm font-medium">
        Méthode
        <select v-model="method" :class="field" class="font-mono font-bold" :style="{ color: METHOD_COLOR[method] }" aria-label="Méthode HTTP">
          <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label class="text-sm font-medium">
        Chemin
        <input v-model="path" autofocus :class="[field, 'font-mono text-sm']" placeholder="/users/{id}" aria-label="Chemin" />
      </label>
    </div>
    <label class="mt-4 block text-sm font-medium">
      Résumé
      <input v-model="summary" :class="field" placeholder="Lister les utilisateurs" />
    </label>
    <div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <label class="inline-flex items-center gap-2"><input v-model="auth" type="checkbox" /> Authentification requise</label>
      <label class="inline-flex items-center gap-2" title="Ajoute page, limit et l'en-tête X-Total-Count"><input v-model="paginated" type="checkbox" /> Liste paginée</label>
    </div>

    <section v-if="pathNames.length" class="mt-5">
      <h3 class="text-sm font-semibold">Paramètres de chemin</h3>
      <div v-for="n in pathNames" :key="n" class="mt-2 flex items-center gap-2">
        <code class="w-32 truncate rounded bg-slate-100 px-2 py-1 text-sm">{{ n }}</code>
        <input v-model="pathTypes[n]" list="api-types" :class="[cell, 'w-48 font-mono']" placeholder="string" :aria-label="`Type de ${n}`" />
      </div>
    </section>

    <section class="mt-5">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Paramètres de requête et en-têtes</h3>
        <div class="flex gap-2 text-xs">
          <button class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" @click="addParam('query')"><Plus :size="12" /> Requête</button>
          <button class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100" @click="addParam('header')"><Plus :size="12" /> En-tête</button>
        </div>
      </div>
      <p v-if="!extraParams.length" class="mt-1 text-xs text-slate-400">Aucun.</p>
      <div v-for="(p, i) in extraParams" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
        <select v-model="p.in" :class="cell" aria-label="Emplacement"><option value="query">requête</option><option value="header">en-tête</option></select>
        <input v-model="p.name" :class="[cell, 'w-40 font-mono']" placeholder="nom" aria-label="Nom du paramètre" />
        <input v-model="p.type" list="api-types" :class="[cell, 'w-36 font-mono']" placeholder="string" aria-label="Type du paramètre" />
        <label class="inline-flex items-center gap-1 text-xs"><input v-model="p.optional" type="checkbox" /> facultatif</label>
        <input v-model="p.description" :class="[cell, 'min-w-32 flex-1']" placeholder="description" aria-label="Description du paramètre" />
        <button :class="iconBtn" title="Retirer" aria-label="Retirer le paramètre" @click="extraParams.splice(i, 1)"><X :size="15" /></button>
      </div>
    </section>

    <section class="mt-5">
      <h3 class="text-sm font-semibold">Corps de la requête</h3>
      <div class="mt-2 flex gap-2">
        <input v-model="bodyType" list="api-types" :class="[cell, 'w-48 font-mono']" placeholder="aucun (ex. UserInput)" aria-label="Type du corps" />
        <input v-model="bodyDesc" :class="[cell, 'flex-1']" placeholder="description" aria-label="Description du corps" />
      </div>
    </section>

    <section class="mt-5">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Réponses</h3>
        <button class="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="addResponse()"><Plus :size="12" /> Réponse</button>
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="s in QUICK"
          :key="s"
          class="rounded-full border border-slate-300 px-2 py-0.5 font-mono text-xs hover:bg-slate-100"
          :title="statusText(s)"
          @click="addResponse(s)"
        >
          {{ s }}
        </button>
      </div>
      <p v-if="!responses.length" class="mt-2 text-xs text-slate-400">Aucune réponse décrite.</p>
      <div v-for="(r, i) in responses" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
        <input v-model="r.status" :class="[cell, 'w-20 font-mono']" inputmode="numeric" aria-label="Code HTTP" />
        <input v-model="r.type" list="api-types" :class="[cell, 'w-44 font-mono']" placeholder="type (facultatif)" aria-label="Type de la réponse" />
        <input v-model="r.description" :class="[cell, 'min-w-32 flex-1']" :placeholder="statusText(Number(r.status) || 200)" aria-label="Description de la réponse" />
        <button :class="iconBtn" title="Retirer" aria-label="Retirer la réponse" @click="responses.splice(i, 1)"><X :size="15" /></button>
      </div>
    </section>

    <ul v-if="problems.length" class="mt-4 space-y-0.5 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
      <li v-for="p in problems" :key="p">{{ p }}</li>
    </ul>

    <template #footer>
      <div class="flex items-center gap-1">
        <button class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" @click="remove"><Trash2 :size="15" /> Supprimer</button>
        <button
          :class="iconBtn"
          class="disabled:pointer-events-none disabled:opacity-30"
          title="Placer avant la route précédente du même chemin"
          aria-label="Monter la route"
          :disabled="!store.canMoveEndpoint(e?.id, -1)"
          @click="e && store.moveEndpointBy(e.id, -1)"
        >
          <ArrowUp :size="16" />
        </button>
        <button
          :class="iconBtn"
          class="disabled:pointer-events-none disabled:opacity-30"
          title="Placer après la route suivante du même chemin"
          aria-label="Descendre la route"
          :disabled="!store.canMoveEndpoint(e?.id, 1)"
          @click="e && store.moveEndpointBy(e.id, 1)"
        >
          <ArrowDown :size="16" />
        </button>
      </div>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-100" @click="close">Annuler</button>
        <button class="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" :disabled="problems.length > 0" @click="save">Enregistrer</button>
      </div>
    </template>
  </BaseModal>
</template>
