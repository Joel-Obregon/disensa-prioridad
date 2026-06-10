import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'disensa-theme'

export function initializeTheme() {
  applyTheme(resolveInitialTheme())
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme())

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return {
    isDark: theme === 'dark',
    setTheme,
    theme,
    toggleTheme,
  }
}

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'

  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme
  } catch {
    return 'light'
  }

  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

function saveTheme(theme: ThemeMode) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}
