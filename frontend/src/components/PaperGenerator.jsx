import React, { useState, useEffect, useRef } from 'react';
import {
    BookOpen, Plus, Trash2, Loader, FileText,
    Printer, ChevronDown, ChevronUp, Eye, EyeOff,
    CheckSquare, AlignLeft, HelpCircle, ToggleLeft, Sparkles
} from 'lucide-react';
import api from '../api';
import { showToast } from '../hooks/useToast';
import './PaperGenerator.css';

// ─────────────────────────────────────────────────────────────
// Paper Generator — create exam papers from uploaded textbooks
// ─────────────────────────────────────────────────────────────

const QUESTION_TYPES = [
    { id: 'mcq',        label: 'Multiple Choice',  icon: <CheckSquare size={14} />, desc: '4 options A–D' },
    { id: 'true_false', label: 'True / False',      icon: <ToggleLeft size={14} />,  desc: 'True or false statement' },
    { id: 'short',      label: 'Short Answer',      icon: <AlignLeft size={14} />,   desc: '1–3 sentence answer' },
    { id: 'fill',       label: 'Fill in the Blank', icon: <HelpCircle size={14} />,  desc: 'Missing word from text' },
    { id: 'essay',      label: 'Essay',             icon: <FileText size={14} />,    desc: 'Paragraph response' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Mixed'];

const DEFAULT_SECTION = { type: 'mcq', count: 10, marks: 1, difficulty: 'Mixed' };

function PaperGenerator() {
    const [contexts, setContexts]         = useState([]);
    const [papers, setPapers]             = useState([]);
    const [selectedCtx, setSelectedCtx]   = useState('');
    const [ctxTopics, setCtxTopics]       = useState([]);
    const [selectedTopics, setSelectedTopics] = useState([]);
    const [config, setConfig]             = useState({
        title: '',
        time: '1 hour',
        language: 'English',
        difficulty: 'Mixed',
        sections: [{ ...DEFAULT_SECTION }],
    });
    const [generating, setGenerating]     = useState(false);
    const [genStatus, setGenStatus]       = useState('');      // in-page status message
    const [genError, setGenError]         = useState('');      // in-page error message
    const [activePaper, setActivePaper]   = useState(null);   // currently previewing
    const [showAnswers, setShowAnswers]   = useState(false);
    const [tab, setTab]                   = useState('create'); // 'create' | 'saved'
    const printRef                        = useRef();

    useEffect(() => {
        fetchContexts();
        fetchPapers();
    }, []);

    const fetchContexts = async () => {
        try { const r = await api.get('/subject-context'); setContexts(r.data); }
        catch { console.error('Failed to load textbooks'); }
    };

    const fetchPapers = async () => {
        try { const r = await api.get('/papers'); setPapers(r.data); }
        catch { console.error('Failed to load papers'); }
    };

    // When textbook is selected, load its topics for filtering
    const handleSelectContext = (id) => {
        setSelectedCtx(id);
        setSelectedTopics([]);
        const ctx = contexts.find(c => String(c.id) === String(id));
        setCtxTopics(ctx?.topics || []);
        // Auto-fill title
        if (ctx) setConfig(prev => ({
            ...prev,
            title: prev.title || `${ctx.grade} ${ctx.subject} Examination`,
        }));
    };

    const addSection = () => {
        setConfig(prev => ({ ...prev, sections: [...prev.sections, { ...DEFAULT_SECTION }] }));
    };

    const removeSection = (i) => {
        setConfig(prev => ({ ...prev, sections: prev.sections.filter((_, idx) => idx !== i) }));
    };

    const updateSection = (i, field, value) => {
        setConfig(prev => {
            const s = [...prev.sections];
            s[i] = { ...s[i], [field]: value };
            return { ...prev, sections: s };
        });
    };

    const totalMarks = config.sections.reduce((s, sec) => s + (Number(sec.count) * Number(sec.marks)), 0);

    const handleGenerate = async () => {
        if (!selectedCtx) { setGenError('Please select a textbook first'); return; }
        if (config.sections.length === 0) { setGenError('Add at least one section'); return; }

        setGenError('');
        setGenStatus('Sending request to AI… this takes 30–60 seconds, please wait ⏳');
        setGenerating(true);

        try {
            const res = await api.post('/papers/generate', {
                context_id: selectedCtx,
                config: {
                    ...config,
                    topics: selectedTopics,
                    total_marks: totalMarks,
                },
            }, { timeout: 120000 });

            setGenStatus('');
            setActivePaper(res.data);
            setTab('preview');
            showToast.success('Paper generated successfully!');
            fetchPapers();
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Generation failed — check backend is running';
            setGenStatus('');
            setGenError(msg);
            console.error('[PaperGenerator] generate error:', err);
        } finally {
            setGenerating(false);
        }
    };

    const loadPaper = async (id) => {
        try {
            const res = await api.get(`/papers/${id}`);
            setActivePaper(res.data);
            setTab('preview');
        } catch { showToast.error('Failed to load paper'); }
    };

    const deletePaper = async (id) => {
        if (!window.confirm('Delete this paper?')) return;
        try {
            await api.delete(`/papers/${id}`);
            showToast.success('Paper deleted');
            fetchPapers();
            if (activePaper?.paper?.id === id) setActivePaper(null);
        } catch { showToast.error('Failed to delete paper'); }
    };

    // Open a clean window containing ONLY the paper, then print → "Save as PDF".
    // This guarantees the PDF has just the exam paper (no app sidebar/buttons).
    const handlePrint = () => {
        const node = document.getElementById('printable-paper');
        if (!node) return;
        const title = activePaper?.paper?.title || 'Exam Paper';
        const w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) { alert('Please allow pop-ups to download the paper as PDF.'); return; }
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: 'Georgia', serif; color: #111; }
            .paper-doc { padding: 1.5cm 2cm; line-height: 1.65; }
            .paper-header { text-align: center; border-bottom: 2.5px solid #111; padding-bottom: 14px; margin-bottom: 16px; }
            .paper-header h1 { font-size: 22px; margin: 0 0 6px; }
            .paper-meta { font-size: 13px; color: #444; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; font-family: sans-serif; }
            .paper-instructions { background: #f4f4f4; border-left: 4px solid #111; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; border-radius: 0 6px 6px 0; }
            .paper-section { margin-bottom: 26px; page-break-inside: avoid; }
            .paper-section-title { font-size: 15px; font-weight: 700; border-bottom: 1.5px solid #888; padding-bottom: 5px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
            .paper-section-marks { font-size: 12px; font-weight: 400; color: #555; text-transform: none; margin-left: 8px; }
            .paper-section-instructions { color: #555; font-style: italic; font-size: 13px; margin: 0 0 10px; }
            .paper-questions { padding-left: 22px; display: flex; flex-direction: column; gap: 14px; }
            .paper-question { font-size: 14px; page-break-inside: avoid; }
            .paper-q-text { font-weight: 500; margin-bottom: 6px; }
            .paper-q-marks { color: #666; font-size: 12px; margin-left: 6px; }
            .paper-blank { border-bottom: 1.5px solid #333; display: inline-block; min-width: 80px; margin-left: 4px; }
            .paper-options { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; padding-left: 8px; }
            .paper-option { display: flex; align-items: center; gap: 10px; font-size: 13px; }
            .paper-option-bubble { width: 14px; height: 14px; border: 1.5px solid #555; border-radius: 50%; display: inline-block; flex-shrink: 0; }
            .paper-answer-lines { display: flex; flex-direction: column; margin-top: 6px; padding-left: 8px; }
            .paper-line { border-bottom: 1px solid #bbb; height: 26px; }
            .essay-lines .paper-line { height: 30px; }
            .paper-answer-key, .noprint { display: none !important; }
            .paper-answer-page { page-break-before: always; }
            .paper-answer-page h2 { text-align: center; }
            .answer-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
            .answer-row { display: flex; gap: 8px; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; }
            .answer-q-num { font-weight: 700; font-family: monospace; min-width: 36px; }
            .answer-val { flex: 1; color: #059669; font-weight: 600; }
            @page { margin: 1cm; }
        </style></head><body>${node.innerHTML}
        <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };<\/script>
        </body></html>`);
        w.document.close();
    };

    return (
        <div className="pg-container">
            <div className="pg-header">
                <div>
                    <h2><Sparkles size={22} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />Paper Generator</h2>
                    <p>Create exam papers automatically from your uploaded textbooks</p>
                </div>
            </div>

            {/* Main tabs */}
            <div className="pg-tabs">
                <button className={`pg-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
                    <Plus size={15} /> Create New Paper
                </button>
                <button className={`pg-tab ${tab === 'saved' ? 'active' : ''}`} onClick={() => setTab('saved')}>
                    <FileText size={15} /> Saved Papers ({papers.length})
                </button>
                {activePaper && (
                    <button className={`pg-tab ${tab === 'preview' ? 'active' : ''}`} onClick={() => setTab('preview')}>
                        <Eye size={15} /> Preview Paper
                    </button>
                )}
            </div>

            {/* ── CREATE TAB ─────────────────────────────────────────────── */}
            {tab === 'create' && (
                <div className="pg-create">
                    <div className="pg-two-col">
                        {/* Left: config */}
                        <div className="pg-config">
                            {/* 1. Select textbook */}
                            <div className="pg-card">
                                <h3><BookOpen size={16} /> 1. Select Textbook</h3>
                                {contexts.length === 0 ? (
                                    <p className="pg-empty">No textbooks uploaded yet. Go to <strong>Manage Everything → Textbooks</strong> to upload one.</p>
                                ) : (
                                    <div className="pg-field">
                                        <select
                                            className="form-input"
                                            value={selectedCtx}
                                            onChange={e => handleSelectContext(e.target.value)}
                                        >
                                            <option value="">— Select a textbook —</option>
                                            {contexts.map(c => (
                                                <option key={c.id} value={String(c.id)}>
                                                    {c.label} ({c.grade} · {c.subject} · {c.topics?.length || 0} topics)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Topic filter */}
                                {ctxTopics.length > 0 && (
                                    <div className="pg-topics">
                                        <label className="pg-label">Filter topics (leave all unchecked to use full book)</label>
                                        <div className="pg-topic-chips">
                                            {ctxTopics.map((t, i) => {
                                                const name = typeof t === 'string' ? t : t.name;
                                                const sel  = selectedTopics.includes(name);
                                                return (
                                                    <button
                                                        key={i}
                                                        className={`pg-chip ${sel ? 'selected' : ''}`}
                                                        onClick={() => setSelectedTopics(prev =>
                                                            sel ? prev.filter(x => x !== name) : [...prev, name]
                                                        )}
                                                    >
                                                        {name}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 2. Paper details */}
                            <div className="pg-card">
                                <h3><FileText size={16} /> 2. Paper Details</h3>
                                <div className="pg-form-grid pg-form-grid-3">
                                    <div className="pg-field" style={{ gridColumn: 'span 2' }}>
                                        <label className="pg-label">Paper Title</label>
                                        <input
                                            className="form-input"
                                            placeholder="e.g. Grade 6 ICT — Term 1 Examination"
                                            value={config.title}
                                            onChange={e => setConfig(p => ({ ...p, title: e.target.value }))}
                                        />
                                    </div>
                                    <div className="pg-field">
                                        <label className="pg-label">Language</label>
                                        <select className="form-input" value={config.language} onChange={e => setConfig(p => ({ ...p, language: e.target.value }))}>
                                            <option value="English">English</option>
                                            <option value="Sinhala">සිංහල (Sinhala)</option>
                                            <option value="Tamil">தமிழ் (Tamil)</option>
                                        </select>
                                    </div>
                                    <div className="pg-field">
                                        <label className="pg-label">Time Allowed</label>
                                        <select className="form-input" value={config.time} onChange={e => setConfig(p => ({ ...p, time: e.target.value }))}>
                                            {['30 minutes', '45 minutes', '1 hour', '1.5 hours', '2 hours', '3 hours'].map(t => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {config.language !== 'English' && (
                                    <div className="pg-lang-note">
                                        📝 All questions, options, instructions and answers will be generated in <strong>{config.language}</strong>.
                                    </div>
                                )}
                            </div>

                            {/* 3. Sections */}
                            <div className="pg-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <h3 style={{ margin: 0 }}><CheckSquare size={16} /> 3. Question Sections</h3>
                                    <button onClick={addSection} className="btn btn-secondary" style={{ fontSize: '0.83rem' }}>
                                        <Plus size={14} /> Add Section
                                    </button>
                                </div>

                                {config.sections.map((sec, i) => (
                                    <div key={i} className="pg-section-row">
                                        <div className="pg-section-badge">{String.fromCharCode(65 + i)}</div>
                                        <div className="pg-section-fields">
                                            <div className="pg-field">
                                                <label className="pg-label">Type</label>
                                                <select className="form-input" value={sec.type} onChange={e => updateSection(i, 'type', e.target.value)}>
                                                    {QUESTION_TYPES.map(qt => (
                                                        <option key={qt.id} value={qt.id}>{qt.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="pg-field">
                                                <label className="pg-label">Questions</label>
                                                <input type="number" className="form-input" min={1} max={30} value={sec.count}
                                                    onChange={e => updateSection(i, 'count', parseInt(e.target.value) || 1)} />
                                            </div>
                                            <div className="pg-field">
                                                <label className="pg-label">Marks each</label>
                                                <input type="number" className="form-input" min={1} max={20} value={sec.marks}
                                                    onChange={e => updateSection(i, 'marks', parseInt(e.target.value) || 1)} />
                                            </div>
                                            <div className="pg-field">
                                                <label className="pg-label">Difficulty</label>
                                                <select className="form-input" value={sec.difficulty} onChange={e => updateSection(i, 'difficulty', e.target.value)}>
                                                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        {config.sections.length > 1 && (
                                            <button onClick={() => removeSection(i)} className="btn-icon pg-remove">
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                ))}

                                <div className="pg-total-marks">
                                    Total marks: <strong>{totalMarks}</strong>
                                </div>
                            </div>

                            {genStatus && (
                                <div className="pg-gen-status">
                                    <Loader size={16} className="spin" /> {genStatus}
                                </div>
                            )}
                            {genError && (
                                <div className="pg-gen-error">
                                    ⚠️ {genError}
                                </div>
                            )}

                            <button
                                onClick={handleGenerate}
                                disabled={generating || !selectedCtx}
                                className="btn btn-primary pg-generate-btn"
                            >
                                {generating
                                    ? <><Loader size={17} className="spin" /> Generating Paper…</>
                                    : <><Sparkles size={17} /> Generate Paper</>}
                            </button>
                        </div>

                        {/* Right: quick tips */}
                        <div className="pg-tips">
                            <h4>Tips</h4>
                            <ul>
                                <li>Upload a textbook first in <strong>Manage Everything → Textbooks</strong></li>
                                <li>Select specific topics to focus the paper on key chapters</li>
                                <li>Mix question types for a balanced assessment</li>
                                <li>MCQ is fastest to mark; Essays test deeper understanding</li>
                                <li>After generating, toggle <strong>Show Answers</strong> to get the answer key</li>
                                <li>Use browser <strong>Print</strong> to save as PDF or send to students</li>
                            </ul>

                            <h4 style={{ marginTop: '1.5rem' }}>Question Types</h4>
                            <div className="pg-type-list">
                                {QUESTION_TYPES.map(qt => (
                                    <div key={qt.id} className="pg-type-item">
                                        <span className="pg-type-icon">{qt.icon}</span>
                                        <div>
                                            <strong>{qt.label}</strong>
                                            <small>{qt.desc}</small>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SAVED PAPERS TAB ───────────────────────────────────────── */}
            {tab === 'saved' && (
                <div className="pg-saved">
                    {papers.length === 0 ? (
                        <div className="pg-empty-state">
                            <FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
                            <p>No papers generated yet.</p>
                            <button className="btn btn-primary" onClick={() => setTab('create')}>
                                <Plus size={15} /> Create Your First Paper
                            </button>
                        </div>
                    ) : (
                        <div className="pg-paper-list">
                            {papers.map(p => (
                                <div key={p.id} className="pg-paper-row">
                                    <div className="pg-paper-info">
                                        <strong>{p.title}</strong>
                                        <small>{p.grade} · {p.subject} · {new Date(p.created_at).toLocaleDateString()}</small>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-secondary" style={{ fontSize: '0.83rem' }} onClick={() => loadPaper(p.id)}>
                                            <Eye size={13} /> View
                                        </button>
                                        <button className="btn-icon" onClick={() => deletePaper(p.id)}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── PREVIEW TAB ────────────────────────────────────────────── */}
            {tab === 'preview' && activePaper && (
                <div className="pg-preview-wrapper">
                    {/* Controls bar */}
                    <div className="pg-preview-controls">
                        <button
                            className={`btn btn-secondary ${showAnswers ? 'active-btn' : ''}`}
                            onClick={() => setShowAnswers(p => !p)}
                            style={{ fontSize: '0.85rem' }}
                        >
                            {showAnswers ? <EyeOff size={14} /> : <Eye size={14} />}
                            {showAnswers ? 'Hide Answers' : 'Show Answer Key'}
                        </button>
                        <button className="btn btn-primary" onClick={handlePrint} style={{ fontSize: '0.85rem' }}>
                            <Printer size={14} /> Print / Save as PDF
                        </button>
                    </div>

                    {/* Paper preview */}
                    <div className="pg-paper" ref={printRef} id="printable-paper">
                        <PaperPreview
                            paper={activePaper.paper || activePaper}
                            answerKey={activePaper.answer_key}
                            showAnswers={showAnswers}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// PaperPreview — renders the exam paper (and optionally answers)
// ─────────────────────────────────────────────────────────────
function PaperPreview({ paper, answerKey, showAnswers }) {
    if (!paper || !paper.sections) return <p style={{ color: 'var(--text-muted)' }}>No paper data.</p>;

    return (
        <div className="paper-doc">
            {/* Header */}
            <div className="paper-header">
                <h1>{paper.title}</h1>
                <div className="paper-meta">
                    <span>{paper.grade}</span>
                    <span>·</span>
                    <span>{paper.subject}</span>
                    <span>·</span>
                    <span>Time: {paper.time}</span>
                    <span>·</span>
                    <span>Total Marks: {paper.total_marks}</span>
                </div>
            </div>

            {/* General instructions */}
            {paper.instructions && (
                <div className="paper-instructions">
                    <strong>Instructions:</strong> {paper.instructions}
                </div>
            )}

            {/* Sections */}
            {paper.sections.map((section, si) => (
                <div key={si} className="paper-section">
                    <div className="paper-section-title">
                        {section.title || `Section ${section.id}`}
                        <span className="paper-section-marks">({section.marks_per_q} mark{section.marks_per_q !== 1 ? 's' : ''} each)</span>
                    </div>
                    {section.instructions && (
                        <p className="paper-section-instructions">{section.instructions}</p>
                    )}

                    <ol className="paper-questions">
                        {(section.questions || []).map((q, qi) => (
                            <li key={qi} className="paper-question">
                                <div className="paper-q-text">
                                    {q.text}
                                    {section.type === 'fill' && q.blank_hint && (
                                        <span className="paper-blank"> {q.blank_hint}</span>
                                    )}
                                    <span className="paper-q-marks">({q.marks}m)</span>
                                </div>

                                {/* MCQ options */}
                                {section.type === 'mcq' && q.options && (
                                    <div className="paper-options">
                                        {q.options.map((opt, oi) => (
                                            <div key={oi} className="paper-option">
                                                <span className="paper-option-bubble" />
                                                {opt}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Short / essay answer blank */}
                                {(section.type === 'short' || section.type === 'essay') && (
                                    <div className={`paper-answer-lines ${section.type === 'essay' ? 'essay-lines' : ''}`}>
                                        {Array.from({ length: section.type === 'essay' ? 8 : 3 }).map((_, li) => (
                                            <div key={li} className="paper-line" />
                                        ))}
                                    </div>
                                )}

                                {/* Answer key overlay */}
                                {showAnswers && answerKey && (
                                    <div className="paper-answer-key">
                                        ✓ {answerKey[`${section.id}-${q.num}`]?.answer || '—'}
                                        {answerKey[`${section.id}-${q.num}`]?.topic && (
                                            <span className="answer-topic"> [{answerKey[`${section.id}-${q.num}`].topic}]</span>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ol>
                </div>
            ))}

            {/* Answer key page (shown when printing with answers) */}
            {showAnswers && answerKey && (
                <div className="paper-answer-page">
                    <h2>— Answer Key —</h2>
                    <div className="answer-grid">
                        {Object.entries(answerKey).map(([key, val]) => (
                            <div key={key} className="answer-row">
                                <span className="answer-q-num">{key}</span>
                                <span className="answer-val">{val.answer}</span>
                                <span className="answer-marks">({val.marks}m)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default PaperGenerator;
