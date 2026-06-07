import { useState, useEffect, useCallback } from 'react';

const DARK_MODE_KEY = 'marknex_dark_mode';

export function useDarkMode() {
    const [isDark, setIsDark] = useState(() => {
        // Check localStorage first
        const stored = localStorage.getItem(DARK_MODE_KEY);
        if (stored !== null) {
            return stored === 'true';
        }
        // Then check system preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });

    // Apply theme to document
    useEffect(() => {
        const root = document.documentElement;
        if (isDark) {
            root.classList.add('dark-mode');
        } else {
            root.classList.remove('dark-mode');
        }
        localStorage.setItem(DARK_MODE_KEY, isDark);
    }, [isDark]);

    const toggle = useCallback(() => {
        setIsDark(prev => !prev);
    }, []);

    return { isDark, toggle };
}
