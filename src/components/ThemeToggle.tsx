import { useEffect, useState, useRef } from 'react'
import './ThemeToggle.css'

export function ThemeToggle() {
  // Check if user has manually set a preference
  const hasManualPreference = useRef(localStorage.getItem('theme-manual') === 'true')
  
  // Get system preference
  const getSystemPreference = (): 'light' | 'dark' => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  }

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // If user has manually set a preference, use that
    if (hasManualPreference.current) {
      const saved = localStorage.getItem('theme')
      if (saved === 'dark' || saved === 'light') {
        return saved
      }
    }
    // Otherwise, follow system preference
    return getSystemPreference()
  })

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark')
    } else {
      root.removeAttribute('data-theme')
    }
    
    // Only save to localStorage if user has manually set it
    if (hasManualPreference.current) {
      localStorage.setItem('theme', theme)
    }
  }, [theme])

  // Listen to system preference changes (only if user hasn't manually set it)
  useEffect(() => {
    if (hasManualPreference.current) {
      return // Don't listen if user has manually set preference
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light')
    }

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    } 
    // Fallback for older browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange)
      return () => mediaQuery.removeListener(handleChange)
    }
  }, [])

  const toggleTheme = () => {
    // Mark as manually set
    hasManualPreference.current = true
    localStorage.setItem('theme-manual', 'true')
    
    // Toggle theme
    setTheme(prev => {
      const newTheme = prev === 'light' ? 'dark' : 'light'
      localStorage.setItem('theme', newTheme)
      return newTheme
    })
  }

  return (
    <button 
      className="theme-toggle" 
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  )
}

