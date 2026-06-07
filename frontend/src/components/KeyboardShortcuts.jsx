import React, { useState, useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';
import './KeyboardShortcuts.css';

function KeyboardShortcuts() {
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        const handleKeyPress = (e) => {
            // Show help with ? key
            if (e.key === '?' && !showHelp) {
                setShowHelp(true);
            }
            // Close help with Escape
            if (e.key === 'Escape' && showHelp) {
                setShowHelp(false);
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [showHelp]);

    if (!showHelp) return null;

    return (
        <div className="keyboard-overlay">
            <div className="keyboard-modal">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Keyboard size={24} /> Keyboard Shortcuts
                    </h2>
                    <button
                        onClick={() => setShowHelp(false)}
                        className="btn-close"
                        aria-label="Close keyboard shortcuts"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    <div>
                        <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--primary)' }}>Navigation</h3>
                        <table className="shortcuts-table">
                            <tbody>
                                <tr>
                                    <td><kbd>Tab</kbd></td>
                                    <td>Navigate forward</td>
                                </tr>
                                <tr>
                                    <td><kbd>Shift</kbd> + <kbd>Tab</kbd></td>
                                    <td>Navigate backward</td>
                                </tr>
                                <tr>
                                    <td><kbd>Enter</kbd></td>
                                    <td>Activate button/link</td>
                                </tr>
                                <tr>
                                    <td><kbd>Space</kbd></td>
                                    <td>Toggle checkbox</td>
                                </tr>
                                <tr>
                                    <td><kbd>Escape</kbd></td>
                                    <td>Close modal/popover</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div>
                        <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--primary)' }}>Application</h3>
                        <table className="shortcuts-table">
                            <tbody>
                                <tr>
                                    <td><kbd>?</kbd></td>
                                    <td>Show this help</td>
                                </tr>
                                <tr>
                                    <td><kbd>Ctrl</kbd> + <kbd>K</kbd></td>
                                    <td>Search (coming soon)</td>
                                </tr>
                                <tr>
                                    <td><kbd>Ctrl</kbd> + <kbd>S</kbd></td>
                                    <td>Save/Submit (context)</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <p style={{ marginTop: '2rem', marginBottom: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Press <kbd>Escape</kbd> to close this dialog
                </p>
            </div>
        </div>
    );
}

export default KeyboardShortcuts;
