import React from 'react';
import { useToast } from '../hooks/useToast';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import './ToastContainer.css';

function ToastContainer() {
    const toasts = useToast();

    const getIcon = (type) => {
        switch (type) {
            case 'success':
                return <CheckCircle size={20} />;
            case 'error':
                return <AlertTriangle size={20} />;
            case 'info':
                return <Info size={20} />;
            case 'loading':
                return <div className="spinner"></div>;
            default:
                return null;
        }
    };

    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast-${toast.type}`}>
                    <div className="toast-icon">
                        {getIcon(toast.type)}
                    </div>
                    <div className="toast-message">
                        {toast.message}
                    </div>
                    {toast.type !== 'loading' && (
                        <div className="toast-progress"></div>
                    )}
                </div>
            ))}
        </div>
    );
}

export default ToastContainer;
