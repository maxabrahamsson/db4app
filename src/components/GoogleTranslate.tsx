import React, { useEffect, useRef } from 'react'
import './GoogleTranslate.css'

// TypeScript declarations for Google Translate
declare global {
  interface Window {
    google?: {
      translate?: {
        TranslateElement: {
          new (
            config: {
              pageLanguage: string
              includedLanguages: string
              layout: number
              autoDisplay: boolean
            },
            element: HTMLElement
          ): void
          InlineLayout: {
            SIMPLE: number
          }
        }
      }
    }
    googleTranslateElementInit?: () => void
  }
}

export function GoogleTranslate() {
  const translateElementRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const scriptLoadedRef = useRef(false)
  const [displayLang, setDisplayLang] = React.useState<string>('EN')
  
  // Always show the language selector (like the theme toggle)
  const shouldShow = true
  
  // Get current language for display
  const currentLang = navigator.language || (navigator as any).userLanguage || 'en'
  const langCode = currentLang.split('-')[0].toLowerCase()
  
  // Initialize display language - check localStorage first, then browser language
  React.useEffect(() => {
    const savedLang = localStorage.getItem('google-translate-lang')
    if (savedLang) {
      setDisplayLang(savedLang)
    } else {
      setDisplayLang(langCode.toUpperCase())
    }
  }, [langCode])

  useEffect(() => {
    // Only load Google Translate if we should show it
    if (!shouldShow) {
      return
    }
    
    // Prevent multiple initializations
    if (initializedRef.current || scriptLoadedRef.current) {
      return
    }
    
    console.log('[GoogleTranslate] Loading widget, langCode:', langCode)

    const initializeTranslate = () => {
      // Double-check to prevent recursive calls
      if (initializedRef.current) {
        console.log('[GoogleTranslate] Already initialized, skipping')
        return
      }
      
      if (!translateElementRef.current) {
        console.warn('[GoogleTranslate] Cannot initialize - element missing')
        return
      }
      
      // Check if Google Translate API is fully loaded
      if (!window.google?.translate) {
        console.warn('[GoogleTranslate] Google translate API not loaded yet')
        return
      }
      
      // Check if TranslateElement constructor exists
      const TranslateElement = window.google.translate.TranslateElement
      if (!TranslateElement || typeof TranslateElement !== 'function') {
        console.warn('[GoogleTranslate] TranslateElement constructor not available')
        return
      }
      
      try {
        initializedRef.current = true
        console.log('[GoogleTranslate] Initializing, element exists:', !!translateElementRef.current, 'google.translate exists:', !!window.google?.translate)
        
        // Use InlineLayout.SIMPLE if available, otherwise use numeric value 0 (SIMPLE layout)
        // The layout parameter is optional and defaults to SIMPLE (0) if not provided
        const layoutValue = (TranslateElement.InlineLayout?.SIMPLE !== undefined) 
          ? TranslateElement.InlineLayout.SIMPLE 
          : 0
        
        // Define language order to match Google Translate's option order
        const languageOrder = ['en', 'ar', 'de', 'el', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'sv', 'tr', 'zh-CN', 'zh-TW']
        
        new TranslateElement(
          {
            pageLanguage: 'en',
            includedLanguages: 'ar,de,el,es,fr,hi,it,ja,ko,pt,ru,sv,tr,zh-CN,zh-TW',
            layout: layoutValue,
            autoDisplay: false,
          },
          translateElementRef.current
        )
        
        // Store language order for later use
        ;(translateElementRef.current as any).__languageOrder = languageOrder
          
          // Force visibility after initialization - Google Translate creates elements dynamically
          setTimeout(() => {
            const element = document.getElementById('google_translate_element')
            const wrapper = element?.closest('.google-translate-wrapper') as HTMLElement
            const label = wrapper?.querySelector('.translate-label') as HTMLElement
            
            if (element && wrapper && label) {
              // Get the wrapper's dimensions to match the overlay
              const wrapperRect = wrapper.getBoundingClientRect()
              
              element.style.display = 'block'
              element.style.visibility = 'visible'
              element.style.opacity = '0'
              element.style.position = 'absolute'
              element.style.top = '0'
              element.style.left = '0'
              element.style.width = `${wrapperRect.width}px`
              element.style.height = `${wrapperRect.height}px`
              element.style.cursor = 'pointer'
              
              // Also ensure child elements are visible and set up
              const select = element.querySelector('select') as HTMLSelectElement
              if (select) {
                select.id = 'google_translate_select'
                select.style.position = 'absolute'
                select.style.top = '0'
                select.style.left = '0'
                select.style.width = '100%'
                select.style.height = '100%'
                select.style.opacity = '0'
                select.style.cursor = 'pointer'
                select.style.border = 'none'
                select.style.padding = '0'
                select.style.margin = '0'
                
                /**
                 * Reads the current target language from the Google Translate cookie.
                 * Returns 'EN' if no translation is active.
                 */
                const getCurrentLanguageFromCookie = (): string => {
                  const cookie = document.cookie
                    .split('; ')
                    .find(row => row.startsWith('googtrans='))
                    
                  if (!cookie) return 'EN' // Default to Page Language

                  // Cookie format is typically: googtrans=/en/sv or googtrans=/auto/fr
                  const value = cookie.split('=')[1]
                  const parts = value.split('/')
                  
                  // The last part is usually the target language
                  const targetLang = parts[parts.length - 1]
                  
                  return targetLang ? targetLang.toUpperCase() : 'EN'
                }
                
                // Function to update display language - using cookie as primary source
                const updateDisplayLang = () => {
                  // 1. Try Cookie (Most Reliable - "Gold Standard")
                  let code = getCurrentLanguageFromCookie()
                  
                  console.log('[GoogleTranslate] Cookie language:', code, 'Select value:', select.value)
                  
                  // 2. Also check select value directly (cookie might not be updated yet)
                  let selectCode: string | null = null
                  if (select.value) {
                    const val = select.value
                    
                    // Handle "en|sv" OR just "sv" - FIX: Don't require pipe!
                    let candidate: string | null = null
                    if (val.includes('|')) {
                      // Pipe-separated: extract target (usually second part)
                      const parts = val.split('|')
                      candidate = parts[parts.length - 1]?.trim() || null
                    } else {
                      // Single value: use it directly if it looks like a language code
                      if (/^[a-z]{2,5}(?:-[A-Z]{2})?$/i.test(val)) {
                        candidate = val
                      }
                    }
                    
                    if (candidate && candidate.length >= 2) {
                      selectCode = candidate.toUpperCase()
                      console.log('[GoogleTranslate] Extracted from select value:', selectCode)
                    }
                  }
                  
                  // 3. Also check the selected option text/index
                  let optionCode: string | null = null
                  if (select.selectedIndex >= 0 && select.options[select.selectedIndex]) {
                    const selectedOption = select.options[select.selectedIndex]
                    const optionText = selectedOption.text.toLowerCase()
                    const optionValue = selectedOption.value
                    
                    // Map common language names to codes
                    const languageNameMap: Record<string, string> = {
                      'greek': 'EL', 'ελληνικά': 'EL', 'grekiska': 'EL',
                      'swedish': 'SV', 'svenska': 'SV',
                      'french': 'FR', 'français': 'FR', 'franska': 'FR',
                      'german': 'DE', 'deutsch': 'DE', 'tyska': 'DE',
                      'portuguese': 'PT', 'português': 'PT', 'portugisiska': 'PT',
                      'spanish': 'ES', 'español': 'ES', 'spanska': 'ES',
                      'russian': 'RU', 'русский': 'RU', 'ryska': 'RU',
                      'chinese': 'ZH', '中文': 'ZH', 'kinesiska': 'ZH',
                      'japanese': 'JA', '日本語': 'JA', 'japanska': 'JA',
                      'korean': 'KO', '한국어': 'KO', 'koreanska': 'KO',
                      'italian': 'IT', 'italiano': 'IT', 'italienska': 'IT',
                      'arabic': 'AR', 'العربية': 'AR', 'arabiska': 'AR',
                      'hindi': 'HI', 'हिन्दी': 'HI',
                      'turkish': 'TR', 'türkçe': 'TR', 'turkiska': 'TR',
                    }
                    
                    // Check if option text contains a language name
                    for (const [name, langCode] of Object.entries(languageNameMap)) {
                      if (optionText.includes(name)) {
                        optionCode = langCode
                        console.log('[GoogleTranslate] Found language from option text:', name, '->', langCode)
                        break
                      }
                    }
                    
                    // Also try to extract from option value
                    if (!optionCode && optionValue) {
                      const valMatch = optionValue.match(/([a-z]{2,5}(?:-[A-Z]{2})?)/i)
                      if (valMatch) {
                        optionCode = valMatch[1].toUpperCase()
                        console.log('[GoogleTranslate] Extracted from option value:', optionCode)
                      }
                    }
                  }
                  
                  // Priority: Cookie > Select Value > Option Code
                  if (code && code !== 'EN' && code !== 'AUTO') {
                    // Cookie has a valid language
                    console.log('[GoogleTranslate] Using cookie language:', code)
                  } else if (selectCode) {
                    // Use select value if cookie is EN/AUTO
                    code = selectCode
                    console.log('[GoogleTranslate] Using select value:', code)
                  } else if (optionCode) {
                    // Fallback to option code
                    code = optionCode
                    console.log('[GoogleTranslate] Using option code:', code)
                  }

                  // Update display and store
                  if (code && code !== 'EN' && code !== 'AUTO') {
                    console.log('[GoogleTranslate] Updating display language to:', code)
                    setDisplayLang(code)
                    localStorage.setItem('google-translate-lang', code)
                  } else if (code === 'EN' || code === 'AUTO') {
                    // If cookie says EN or AUTO, show EN (page language)
                    setDisplayLang('EN')
                    localStorage.setItem('google-translate-lang', 'EN')
                  }
                }
                
                // Check localStorage for previously selected language
                const savedLang = localStorage.getItem('google-translate-lang')
                if (savedLang) {
                  setDisplayLang(savedLang)
                }
                
                // Update display language when selection changes
                select.addEventListener('change', () => {
                  // Update immediately (don't wait for cookie)
                  updateDisplayLang()
                  // Also update after a delay to catch cookie changes
                  setTimeout(updateDisplayLang, 200)
                  setTimeout(updateDisplayLang, 500)
                })
                
                // Watch for Google Translate DOM changes (when translation is applied)
                // Google adds "translated-ltr" or "translated-rtl" class to <html> tag
                const observer = new MutationObserver(() => {
                  updateDisplayLang() // Check cookie when DOM changes
                })
                
                observer.observe(document.documentElement, { 
                  attributes: true, 
                  attributeFilter: ['class', 'lang'] 
                })
                
                // Also poll periodically to catch cookie changes
                const pollInterval = setInterval(() => {
                  updateDisplayLang()
                }, 300) // Check every 300ms for faster updates
                
                // Store cleanup functions
                ;(element as any).__pollInterval = pollInterval
                ;(element as any).__observer = observer
                
                // Initial update after a short delay to ensure everything is ready
                setTimeout(() => {
                  updateDisplayLang()
                }, 500)
              }
              
              // Also set up the combo element
              const comboElement = element.querySelector('.goog-te-combo') as HTMLElement
              if (comboElement) {
                comboElement.style.position = 'absolute'
                comboElement.style.top = '0'
                comboElement.style.left = '0'
                comboElement.style.width = '100%'
                comboElement.style.height = '100%'
                comboElement.style.opacity = '0'
                comboElement.style.cursor = 'pointer'
              }
            }
          }, 300)
        console.log('[GoogleTranslate] Widget initialized successfully')
      } catch (error) {
        console.error('[GoogleTranslate] Failed to initialize:', error)
        initializedRef.current = false // Reset on error
      }
    }

    // Add Google Translate script
    const addScript = () => {
      // Check if script is already in the DOM
      const existingScript = document.querySelector('script[src*="translate.google.com"]')
      if (existingScript) {
        // Script already exists, wait for TranslateElement to be available
        const checkInterval = setInterval(() => {
          if (window.google?.translate?.TranslateElement && typeof window.google.translate.TranslateElement === 'function') {
            clearInterval(checkInterval)
            // Small delay to ensure it's fully ready
            setTimeout(() => initializeTranslate(), 50)
          }
        }, 100)
        setTimeout(() => clearInterval(checkInterval), 5000) // Timeout after 5 seconds
        return
      }

      // Check if Google Translate is already fully loaded (including TranslateElement)
      if (window.google?.translate?.TranslateElement && typeof window.google.translate.TranslateElement === 'function') {
        // Small delay to ensure it's fully ready
        setTimeout(() => initializeTranslate(), 50)
        return
      }

      // Mark script as loading to prevent duplicates
      scriptLoadedRef.current = true

      const script = document.createElement('script')
      script.type = 'text/javascript'
      // Force UI language to English (hl=en) to prevent location-based language detection
      // This ensures language names are always shown in English, not the user's location language
      script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit&hl=en'
      script.async = true
      script.onerror = () => {
        console.error('[GoogleTranslate] Failed to load Google Translate script')
        scriptLoadedRef.current = false
      }
      
      // Set up the callback only once
      if (!window.googleTranslateElementInit) {
        window.googleTranslateElementInit = () => {
          scriptLoadedRef.current = false // Script has loaded
          // Wait a bit for TranslateElement to be fully available
          setTimeout(() => {
            if (window.google?.translate?.TranslateElement && typeof window.google.translate.TranslateElement === 'function') {
              initializeTranslate()
            } else {
              // If not ready, poll for it
              const checkInterval = setInterval(() => {
                if (window.google?.translate?.TranslateElement && typeof window.google.translate.TranslateElement === 'function') {
                  clearInterval(checkInterval)
                  initializeTranslate()
                }
              }, 50)
              setTimeout(() => clearInterval(checkInterval), 3000) // Timeout after 3 seconds
            }
          }, 100)
        }
      }
      
      document.head.appendChild(script)
    }

    addScript()

    return () => {
      // Cleanup polling intervals and observers
      const element = document.getElementById('google_translate_element')
      if (element) {
        if ((element as any).__pollInterval) {
          clearInterval((element as any).__pollInterval)
        }
        if ((element as any).__observer) {
          ;(element as any).__observer.disconnect()
        }
      }
      // Don't reset initializedRef on cleanup to prevent re-initialization
      // Just mark script as not loaded
      scriptLoadedRef.current = false
    }
  }, [shouldShow, langCode])

  // Only render if we should show it
  if (!shouldShow) {
    return null
  }

  const handleWrapperClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Try multiple ways to trigger the dropdown
    const select = document.getElementById('google_translate_select') as HTMLSelectElement
    const combo = document.querySelector('.goog-te-combo') as HTMLElement
    const anySelect = document.querySelector('#google_translate_element select') as HTMLSelectElement
    
    // Try clicking the combo first (Google's custom element)
    if (combo) {
      combo.click()
      return
    }
    
    // Fallback to select element
    if (select) {
      select.focus()
      // Use a small delay to ensure focus is set
      setTimeout(() => {
        select.click()
      }, 10)
      return
    }
    
    if (anySelect) {
      anySelect.focus()
      anySelect.click()
      return
    }
  }

  return (
    <div className="google-translate-wrapper" onClick={handleWrapperClick} style={{ minWidth: 'fit-content' }}>
      <div className="translate-label">
        <span className="translate-icon">🌐</span>
        <span className="translate-text">{displayLang}</span>
      </div>
      <div ref={translateElementRef} id="google_translate_element"></div>
    </div>
  )
}

