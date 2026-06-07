import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Sparkles, Loader, Save, Eye, Send, FileText,
    CheckCircle, Users, Award, X, Edit2, Globe, Radio
} from 'lucide-react';
import api from '../api';
import { showToast } from '../hooks/useToast';
import LiveHost from './LiveHost';
import './QuizMaker.css';

const BLANK_Q = { text: '', options: ['', '', '', ''], correct: 0, explanation: '' };

export default function QuizMaker() {
    const [tab, setTab]           = useState('list');     // list | create | results
    const [quizzes, setQuizzes]   = useState([]);
    const [classes, setClasses]   = useState([]);
    const [contexts, setContexts] = useState([]);

    // Grades & subjects come ONLY from the teacher's added classes (deduplicated).
    const grades   = [...new Set(classes.map(c => c.grade).filter(Boolean))];
    const subjects = [...new Set(classes.map(c => c.subject).filter(Boolean))];

    // create form
    const [meta, setMeta] = useState({ title: '', grade: '', subject: '', class_id: '', time_limit: 0, language: 'English' });
    const [questions, setQuestions] = useState([{ ...BLANK_Q }]);
    const [aiForm, setAiForm] = useState({ topic: '', count: 5, difficulty: 'Medium', context_id: '' });
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);

    // results
    const [resultsQuiz, setResultsQuiz] = useState(null);
    const [results, setResults] = useState([]);
    const [liveQuizId, setLiveQuizId] = useState(null);   // live host session
    const [lifetime, setLifetime] = useState([]);

    useEffect(() => { fetchQuizzes(); fetchClasses(); fetchContexts(); }, []);

    const fetchQuizzes  = async () => { try { setQuizzes((await api.get('/quizzes')).data); } catch {} };
    const fetchClasses  = async () => { try { setClasses((await api.get('/classes')).data); } catch {} };
    const fetchContexts = async () => { try { setContexts((await api.get('/subject-context')).data); } catch {} };

    const onSelectClass = (id) => {
        const cls = classes.find(c => String(c.id) === String(id));
        setMeta(m => ({ ...m, class_id: id, grade: cls?.grade || m.grade, subject: cls?.subject || m.subject }));
    };

    // ── AI generate ──
    const handleGenerate = async () => {
        if (!meta.class_id) return showToast.error('Select a class first');
        if (!meta.subject) return showToast.error('Select a subject first');
        if (!aiForm.topic && !aiForm.context_id) return showToast.error('Enter a topic or pick a textbook');
        setGenerating(true);
        try {
            const { data } = await api.post('/quizzes/generate', {
                ...aiForm, grade: meta.grade, subject: meta.subject, language: meta.language,
            }, { timeout: 90000 });
            if (data.questions?.length) {
                setQuestions(data.questions.map(q => ({
                    text: q.text || '', options: q.options || ['', '', '', ''],
                    correct: q.correct ?? 0, explanation: q.explanation || '',
                })));
                if (!meta.title) setMeta(m => ({ ...m, title: `${aiForm.topic || meta.subject} Quiz` }));
                showToast.success(`Generated ${data.questions.length} questions`);
            } else showToast.error('No questions generated');
        } catch (err) { showToast.error(err.response?.data?.error || 'Generation failed'); }
        finally { setGenerating(false); }
    };

    // ── manual question editing ──
    const addQuestion    = () => setQuestions(q => [...q, { ...BLANK_Q, options: ['', '', '', ''] }]);
    const removeQuestion = (i) => setQuestions(q => q.filter((_, idx) => idx !== i));
    const updateQ = (i, field, val) => setQuestions(qs => { const c = [...qs]; c[i] = { ...c[i], [field]: val }; return c; });
    const updateOpt = (i, oi, val) => setQuestions(qs => { const c = [...qs]; const o = [...c[i].options]; o[oi] = val; c[i] = { ...c[i], options: o }; return c; });

    const handleSave = async (publish) => {
        if (!meta.title.trim()) return showToast.error('Enter a quiz title');
        if (!meta.class_id) return showToast.error('Select a class');
        if (!meta.subject) return showToast.error('Select a subject');
        const valid = questions.filter(q => q.text.trim() && q.options.every(o => o.trim()));
        if (valid.length === 0) return showToast.error('Add at least one complete question');
        setSaving(true);
        try {
            await api.post('/quizzes', { ...meta, questions: valid, is_published: publish });
            showToast.success(publish ? 'Quiz published to students!' : 'Quiz saved as draft');
            resetForm(); fetchQuizzes(); setTab('list');
        } catch (err) { showToast.error(err.response?.data?.error || 'Save failed'); }
        finally { setSaving(false); }
    };

    const resetForm = () => {
        setMeta({ title: '', grade: '', subject: '', class_id: '', time_limit: 0, language: 'English' });
        setQuestions([{ ...BLANK_Q, options: ['', '', '', ''] }]);
        setAiForm({ topic: '', count: 5, difficulty: 'Medium', context_id: '' });
    };

    const togglePublish = async (q) => {
        try { await api.put(`/quizzes/${q.id}/publish`, { is_published: !q.is_published }); fetchQuizzes(); }
        catch { showToast.error('Failed'); }
    };
    const deleteQuiz = async (id) => {
        if (!window.confirm('Delete this quiz and all its results?')) return;
        try { await api.delete(`/quizzes/${id}`); fetchQuizzes(); showToast.success('Deleted'); }
        catch { showToast.error('Failed'); }
    };
    const viewResults = async (q) => {
        setResultsQuiz(q);
        try { setResults((await api.get(`/quizzes/${q.id}/results`)).data); } catch {}
        setTab('results');
    };

    if (liveQuizId) return <LiveHost quizId={liveQuizId} onExit={() => setLiveQuizId(null)} />;

    return (
        <div className="qm-container">
            <div className="qm-header">
                <h2>📝 Online Quizzes</h2>
                <p>Create MCQ quizzes — students take them online and get instant marks & feedback</p>
            </div>

            <div className="qm-tabs">
                <button className={`qm-tab ${tab==='list'?'active':''}`} onClick={() => setTab('list')}><FileText size={15}/> My Quizzes ({quizzes.length})</button>
                <button className={`qm-tab ${tab==='create'?'active':''}`} onClick={() => { resetForm(); setTab('create'); }}><Plus size={15}/> Create Quiz</button>
                <button className={`qm-tab ${tab==='leaderboard'?'active':''}`} onClick={() => { setTab('leaderboard'); api.get('/leaderboard/lifetime').then(r => setLifetime(r.data)).catch(()=>{}); }}><Award size={15}/> Hall of Fame</button>
                {tab === 'results' && <button className="qm-tab active"><Award size={15}/> Results</button>}
            </div>

            {tab === 'leaderboard' && (
                <div className="qm-lifetime">
                    <p className="qm-lifetime-sub">🏆 All-time live quiz champions — points accumulate across every game forever.</p>
                    {lifetime.length === 0 ? (
                        <div className="empty-state"><Award size={40}/><p>No live games played yet. Run a <strong>Go Live</strong> quiz to start the leaderboard!</p></div>
                    ) : (
                        <div className="qm-hof">
                            {lifetime.map(r => (
                                <div key={r.rank} className={`qm-hof-row rank-${r.rank}`}>
                                    <span className="qm-hof-rank">{['🥇','🥈','🥉'][r.rank-1] || `#${r.rank}`}</span>
                                    <div className="qm-hof-who">
                                        <strong>{r.name || r.code}</strong>
                                        <small>{r.class_name} · {r.games} game{r.games!==1?'s':''} · best {r.best}</small>
                                    </div>
                                    <span className="qm-hof-total">{r.total.toLocaleString()} pts</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── LIST ── */}
            {tab === 'list' && (
                <div className="qm-list">
                    {quizzes.length === 0 ? (
                        <div className="qm-empty"><FileText size={40}/><p>No quizzes yet. Create one to share with students.</p></div>
                    ) : quizzes.map(q => (
                        <div key={q.id} className="qm-quiz-card">
                            <div className="qm-quiz-info">
                                <strong>{q.title}</strong>
                                <small>{q.grade} · {q.subject} · {q.question_count} questions {q.class_name && `· ${q.class_name}`}</small>
                                <div className="qm-quiz-meta">
                                    <span className={`qm-badge ${q.is_published ? 'live' : 'draft'}`}>
                                        {q.is_published ? '🟢 Live' : '⚪ Draft'}
                                    </span>
                                    <span className="qm-attempts"><Users size={12}/> {q.attempts} attempt{q.attempts !== 1 ? 's' : ''}</span>
                                </div>
                            </div>
                            <div className="qm-quiz-actions">
                                <button className="btn qm-sm qm-live-btn" onClick={() => setLiveQuizId(q.id)} title="Host a live Kahoot-style game">
                                    <Radio size={13}/> Go Live
                                </button>
                                <button className="btn btn-secondary qm-sm" onClick={() => togglePublish(q)}>
                                    {q.is_published ? 'Unpublish' : <><Send size={13}/> Publish</>}
                                </button>
                                <button className="btn btn-secondary qm-sm" onClick={() => viewResults(q)}><Award size={13}/> Results</button>
                                <button className="btn-icon" onClick={() => deleteQuiz(q.id)}><Trash2 size={14}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── CREATE ── */}
            {tab === 'create' && (
                <div className="qm-create">
                    {/* Meta — pick the added class & subject first */}
                    <div className="qm-meta-grid">
                        <div className="qm-field" style={{ gridColumn: '1 / -1' }}>
                            <label>Quiz Title *</label>
                            <input className="form-input" placeholder="e.g. Computer Hardware Quiz" value={meta.title} onChange={e => setMeta(m => ({...m, title: e.target.value}))} />
                        </div>
                        <div className="qm-field">
                            <label>Class *</label>
                            <select className="form-input" value={meta.class_id} onChange={e => onSelectClass(e.target.value)}>
                                <option value="">— Select class —</option>
                                {classes.map(c => <option key={c.id} value={c.id}>{c.name} {c.grade ? `(${c.grade})` : ''}</option>)}
                            </select>
                        </div>
                        <div className="qm-field">
                            <label>Language</label>
                            <select className="form-input" value={meta.language} onChange={e => setMeta(m => ({...m, language: e.target.value}))}>
                                <option value="English">English</option>
                                <option value="Sinhala">සිංහල</option>
                                <option value="Tamil">தமிழ்</option>
                            </select>
                        </div>
                        <div className="qm-field">
                            <label>Subject *</label>
                            <select className="form-input" value={meta.subject} onChange={e => setMeta(m => ({...m, subject: e.target.value}))}>
                                <option value="">— Select subject —</option>
                                {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="qm-field">
                            <label>Grade</label>
                            <select className="form-input" value={meta.grade} onChange={e => setMeta(m => ({...m, grade: e.target.value}))}>
                                <option value="">— Select grade —</option>
                                {grades.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                        </div>
                        <div className="qm-field">
                            <label>Time Limit</label>
                            <select className="form-input" value={meta.time_limit} onChange={e => setMeta(m => ({...m, time_limit: +e.target.value}))}>
                                <option value={0}>No time limit</option>
                                {[5,10,15,20,30,45,60].map(t => <option key={t} value={t}>{t} min</option>)}
                            </select>
                        </div>
                    </div>

                    {/* AI generate panel */}
                    <div className="qm-ai-card">
                        <h4><Sparkles size={15}/> Generate questions with AI</h4>
                        <div className="qm-ai-grid">
                            <input className="form-input" placeholder="Topic (e.g. Computer Hardware)" value={aiForm.topic} onChange={e => setAiForm(a => ({...a, topic: e.target.value}))} />
                            <select className="form-input" value={aiForm.context_id} onChange={e => setAiForm(a => ({...a, context_id: e.target.value}))}>
                                <option value="">No textbook</option>
                                {contexts.filter(c => !meta.subject || c.subject === meta.subject).map(c => <option key={c.id} value={c.id}>{c.label || `${c.grade} ${c.subject}`}</option>)}
                            </select>
                            <select className="form-input" value={aiForm.count} onChange={e => setAiForm(a => ({...a, count: +e.target.value}))}>
                                {[3,5,10,15,20].map(n => <option key={n} value={n}>{n} questions</option>)}
                            </select>
                            <select className="form-input" value={aiForm.difficulty} onChange={e => setAiForm(a => ({...a, difficulty: e.target.value}))}>
                                {['Easy','Medium','Hard','Mixed'].map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <button className="btn btn-primary qm-gen-btn" onClick={handleGenerate} disabled={generating}>
                            {generating ? <><Loader size={15} className="spin"/> Generating…</> : <><Sparkles size={15}/> Generate</>}
                        </button>
                    </div>

                    {/* Questions */}
                    <div className="qm-questions">
                        {questions.map((q, i) => (
                            <div key={i} className="qm-q-card">
                                <div className="qm-q-head">
                                    <span className="qm-q-num">Q{i+1}</span>
                                    {questions.length > 1 && <button className="btn-icon" onClick={() => removeQuestion(i)}><Trash2 size={14}/></button>}
                                </div>
                                <textarea className="form-input qm-q-text" placeholder="Question text" value={q.text} onChange={e => updateQ(i, 'text', e.target.value)} rows={2} />
                                {q.options.map((opt, oi) => (
                                    <div key={oi} className="qm-opt-row">
                                        <button
                                            className={`qm-correct-btn ${q.correct === oi ? 'active' : ''}`}
                                            onClick={() => updateQ(i, 'correct', oi)}
                                            title="Mark as correct answer">
                                            {q.correct === oi ? <CheckCircle size={16}/> : <span className="qm-circle"/>}
                                        </button>
                                        <textarea className="form-input qm-opt-input" placeholder={`Option ${String.fromCharCode(65+oi)}`} value={opt} onChange={e => updateOpt(i, oi, e.target.value)} rows={1} />
                                    </div>
                                ))}
                                <textarea className="form-input qm-explain" placeholder="Explanation (shown to student after answering)" value={q.explanation} onChange={e => updateQ(i, 'explanation', e.target.value)} rows={2} />
                            </div>
                        ))}
                        <button className="btn btn-secondary" onClick={addQuestion} style={{ width: '100%' }}><Plus size={15}/> Add Question</button>
                    </div>

                    <div className="qm-save-bar">
                        <button className="btn btn-secondary" onClick={() => handleSave(false)} disabled={saving}><Save size={15}/> Save Draft</button>
                        <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving}>
                            {saving ? <><Loader size={15} className="spin"/> Saving…</> : <><Send size={15}/> Publish to Students</>}
                        </button>
                    </div>
                </div>
            )}

            {/* ── RESULTS ── */}
            {tab === 'results' && resultsQuiz && (
                <div className="qm-results">
                    <button className="btn btn-secondary qm-sm" onClick={() => setTab('list')} style={{ marginBottom: '1rem' }}>← Back</button>
                    <h3>{resultsQuiz.title} — Results</h3>
                    {results.length === 0 ? (
                        <div className="qm-empty"><Users size={36}/><p>No students have taken this quiz yet.</p></div>
                    ) : (
                        <table className="qm-table">
                            <thead><tr><th>Student</th><th>ID</th><th>Score</th><th>%</th><th>Submitted</th></tr></thead>
                            <tbody>
                                {results.map(r => {
                                    const pct = Math.round((r.score / r.total) * 100);
                                    return (
                                        <tr key={r.id}>
                                            <td><strong>{r.name}</strong></td>
                                            <td>{r.student_id}</td>
                                            <td>{r.score}/{r.total}</td>
                                            <td><span className={`qm-pct ${pct>=75?'good':pct>=50?'ok':'low'}`}>{pct}%</span></td>
                                            <td>{new Date(r.submitted_at).toLocaleString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
