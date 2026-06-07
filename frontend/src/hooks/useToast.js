import { useState, useCallback } from 'react';

// Global toast state for the entire app
let toastListeners = [];

function notifyListeners(toast) {
    toastListeners.forEach(listener => listener(toast));
}

export function useToast() {
    const [toasts, setToasts] = useState([]);

    // Subscribe to global toast changes
    useCallback(() => {
        const listener = (toast) => {
            const id = Math.random().toString(36).substr(2, 9);
            const newToast = { ...toast, id };
            setToasts(prev => [...prev, newToast]);

            // Auto-dismiss after 4 seconds
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, toast.duration || 4000);
        };
        toastListeners.push(listener);
        return () => {
            toastListeners = toastListeners.filter(l => l !== listener);
        };
    }, []);

    return toasts;
}

// Exported functions to trigger toasts from anywhere
export const showToast = {
    success: (message, duration) => notifyListeners({ type: 'success', message, duration }),
    error: (message, duration) => notifyListeners({ type: 'error', message, duration }),
    info: (message, duration) => notifyListeners({ type: 'info', message, duration }),
    loading: (message) => notifyListeners({ type: 'loading', message, duration: 0 }),
};
