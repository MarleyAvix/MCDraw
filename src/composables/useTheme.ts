import { ref, watchEffect } from 'vue'

const KEY = 'mcdraw:theme'
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'light' // sombre par défaut
  } catch {
    return true
  }
}

const isDark = ref(read())

watchEffect(() => {
  document.documentElement.classList.toggle('light', !isDark.value)
  try {
    localStorage.setItem(KEY, isDark.value ? 'dark' : 'light')
  } catch {
    /* ignoré */
  }
})

export function useTheme() {
  return { isDark, toggle: () => (isDark.value = !isDark.value) }
}
