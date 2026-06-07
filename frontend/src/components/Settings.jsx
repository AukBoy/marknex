import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings as SettingsIcon, Save, Info, Plus, Trash2, Check, ListChecks } from 'lucide-react';
import api from '../api';
import { useOptions } from '../hooks/useOptions';

// Add / rename / delete the values for one dropdown type (grade|subject|exam).
function OptionListEditor({ title, type, items, onChanged }) {
    const [draft, setDraft] = useState('');     // new value being typed
    const [edits, setEdits] = useState({});     // id -> edited value
    const [busy, setBusy] = useState(false);

    const add = async () => {
        const v = draft.trim();
        if (!v || busy) return;
        setBusy(true);
        try {
            await api.post('/options', { type, value: v });
            setDraft('');
            await onChanged();
        } catch (err) {
            alert(err.response?.data?.error || 'Could not add');
        } finally { setBusy(false); }
    };

    const rename = async (id) => {
        const v = (edits[id] ?? '').trim();
        if (!v) return;
        try {
            await api.put(`/options/${id}`, { value: v });
            setEdits(e => { const n = { ...e }; delete n[id]; return n; });
            await onChanged();
        } catch (err) {
            alert(err.response?.data?.error || 'Could not rename');
        }
    };

    const remove = async (id, value) => {
        if (!window.confirm(`Remove "${value}" from ${title}?`)) return;
        try {
            await api.delete(`/options/${id}`);
            await onChanged();
        } catch (err) {
            alert(err.response?.data?.error || 'Could not remove');
        }
    };

    return (
        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
            <h4 style={{ margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {title} <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.85rem' }}>({items.length})</span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
                {items.map(({ id, value }) => {
                    const editing = edits[id] !== undefined && edits[id] !== value;
                    return (
                        <div key={id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <input
                                className="form-input"
                                style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                                value={edits[id] ?? value}
                                onChange={(e) => setEdits(s => ({ ...s, [id]: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && editing && rename(id)}
                            />
                            {editing && (
                                <button type="button" onClick={() => rename(id)} title="Save"
                                    className="btn" style={{ padding: '0.4rem', background: 'var(--success)', color: '#fff', border: 'none' }}>
                                    <Check size={15} />
                                </button>
                            )}
                            <button type="button" onClick={() => remove(id, value)} title="Remove"
                                className="btn" style={{ padding: '0.4rem', color: 'var(--danger)', borderColor: 'var(--danger)', background: 'transparent' }}>
                                <Trash2 size={15} />
                            </button>
                        </div>
                    );
                })}
                {items.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>None yet.</p>}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                    className="form-input"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                    placeholder={`Add ${title.slice(0, -1).toLowerCase()}…`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                />
                <button type="button" onClick={add} disabled={busy || !draft.trim()}
                    className="btn btn-primary" style={{ padding: '0.4rem 0.7rem' }}>
                    <Plus size={16} />
                </button>
            </div>
        </div>
    );
}

function Settings() {
    const navigate = useNavigate();
    const [threshold, setThreshold] = useState(75);
    const [saving, setSaving] = useState(false);
    const { raw, refresh } = useOptions();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await api.get('/settings');
                if (res.data.confidence_threshold) {
                    setThreshold(Number(res.data.confidence_threshold));
                }
            } catch (err) {
                console.error(err);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.put('/settings', { confidence_threshold: threshold });
            const btn = document.getElementById('save-btn-text');
            if (btn) {
                const old = btn.innerText;
                btn.innerText = 'Settings Saved!';
                setTimeout(() => { btn.innerText = old; }, 2000);
            }
        } catch (err) {
            alert('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease', maxWidth: '880px', margin: '0 auto' }}>
            <button
                onClick={() => navigate('/dashboard')}
                className="btn"
                style={{ background: 'transparent', color: 'var(--text-muted)', marginBottom: '1rem', padding: '0.5rem 0' }}>
                <ArrowLeft size={18} /> Back to Dashboard
            </button>

            <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                    <SettingsIcon size={28} color="var(--text-main)" />
                    <h2 style={{ margin: 0 }}>System Settings</h2>
                </div>

                <form onSubmit={handleSave}>
                    <div className="form-group" style={{ marginBottom: '2rem' }}>
                        <label className="form-label">AI Confidence Threshold (%)</label>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            Answers graded by AI with a confidence score lower than this threshold will be flagged as "Needs Review" and require manual teacher verification.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <input
                                type="range"
                                min="50"
                                max="100"
                                value={threshold}
                                onChange={(e) => setThreshold(e.target.value)}
                                style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--primary)' }}
                            />
                            <span style={{ fontSize: '1.5rem', fontWeight: 600, width: '4rem', textAlign: 'right', color: 'var(--primary)' }}>
                                {threshold}%
                            </span>
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%', padding: '1rem' }}>
                        <Save size={20} /> <span id="save-btn-text">{saving ? 'Saving...' : 'Save Settings'}</span>
                    </button>
                </form>
            </div>

            <div className="card" style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <ListChecks size={26} color="var(--text-main)" />
                    <h2 style={{ margin: 0 }}>Dropdown Options</h2>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    Add, rename or remove the Grade, Subject and Exam choices used across upload forms, filters and reports.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
                    <OptionListEditor title="Grades" type="grade" items={raw.grades} onChanged={refresh} />
                    <OptionListEditor title="Subjects" type="subject" items={raw.subjects} onChanged={refresh} />
                    <OptionListEditor title="Exams" type="exam" items={raw.exams} onChanged={refresh} />
                </div>
            </div>
        </div>
    );
}

export default Settings;
