import { useEffect } from 'react'
import { DbConnectionBox } from '../components/DbConnectionBox'

export function ConnectionBoxPage() {
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)')

        const applyTheme = (theme: 'dark' | 'light' | 'system') => {
            const isDark = theme === 'system'
                ? mq.matches
                : theme === 'dark';

            if (isDark) {
                document.documentElement.setAttribute('data-theme', 'dark')
            } else {
                document.documentElement.removeAttribute('data-theme')
            }
        }

        // 1. Initial check: Query Param > System
        const params = new URLSearchParams(window.location.search);
        const queryTheme = params.get('theme') as 'dark' | 'light' | null;
        applyTheme(queryTheme || 'system');

        // 2. Listen for system changes (only if no override)
        const systemHandler = (e: MediaQueryListEvent) => {
            if (!params.get('theme')) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        }
        mq.addEventListener('change', systemHandler);

        // 3. Listen for messages from parent (Tauri)
        const messageHandler = (event: MessageEvent) => {
            if (event.data && event.data.type === 'THEME_CHANGE') {
                applyTheme(event.data.theme);
            }
        };
        window.addEventListener('message', messageHandler);

        return () => {
            mq.removeEventListener('change', systemHandler);
            window.removeEventListener('message', messageHandler);
            // Clean up? Maybe not needed if unmounting means navigating away, 
            // but if navigating back to main app, we might want to respect app's theme store.
            // But this app seems to lack a central theme store (except maybe implicit CSS).
            // Main app seems to default to light or system? 
            // index.css has media query? No, it has `[data-theme="dark"]`.
            // So main app likely doesn't support auto-dark mode yet? 
            // Or maybe it does elsewhere.
            // Safest is to clean up by removing the attribute if we leave?
            // But for MFE page (iframe), we stay there.
        }
    }, [])

    // const isMinimal = params.get('minimal') === '1'; // Removed

    return (
        <div style={{
            padding: '2rem',
            width: '100%',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center', // Center vertically
            alignItems: 'center',
            background: 'transparent'
        }}>
            <DbConnectionBox />
        </div>
    )
}
