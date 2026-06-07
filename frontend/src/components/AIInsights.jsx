import React, { useState, useEffect } from 'react';
import {
    Sparkles, TrendingUp, TrendingDown, AlertTriangle, Award,
    Users, FileText, Loader, Brain, Target, CheckCircle, Lightbulb
} from 'lucide-react';
import api from '../api';
import './AIInsights.css';

export default function AIInsights() {
    const [classes, setClasses] = useState([]);
    const [filter, setFilter]   = useState({ grade: '', subject: '' });
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(false);
    const [ran, setRan]         = useState(false);

    useEffect(() => { api.get('/classes').then(r => setClasses(r.data)).catch(() => {}); }, []);

    const grades   = [...new Set(classes.map(c => c.grade).filter(Boolean))];
    const subjects = [...new Set(classes.map(c => c.subject).filter(Boolean))];

    const analyze = async () => {
        setLoading(true); setRan(true);
        try { setData((await api.post('/insights', filter)).data); }
        catch { setData({ error: true }); }
        finally { setLoading(false); }
    };

    return (
        <div className="ai-insights">
            <div className="aii-header">
                <h2><Brain size={24} style={{ verticalAlign: '-4px', marginRight: '0.5rem', color: 'var(--primary)' }} />AI Class Insights</h2>
                <p>Let AI analyse your results — spot weak topics, find at-risk students, and get teaching recommendations.</p>
            </div>

            <div className="aii-controls">
                <select className="form-input" value={filter.grade} onChange={e => setFilter(f => ({ ...f, grade: e.target.value }))}>
                    <option value="">All grades</option>
                    {grades.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select className="form-input" value={filter.subject} onChange={e => setFilter(f => ({ ...f, subject: e.target.value }))}>
                    <option value="">All subjects</option>
                    {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn btn-primary" onClick={analyze} disabled={loading}>
                    {loading ? <><Loader size={16} className="aii-spin" /> Analysing…</> : <><Sparkles size={16} /> Analyse</>}
                </button>
            </div>

            {!ran && (
                <div className="empty-state">
                    <Brain size={48} />
                    <p>Pick a grade/subject (or leave as All) and click <strong>Analyse</strong> to generate AI insights from your graded papers.</p>
                </div>
            )}

            {loading && (
                <div className="page-loader"><div className="spinner" /><span>AI is reading your class data…</span></div>
            )}

            {!loading && data?.empty && (
                <div className="empty-state"><FileText size={48} /><p>{data.message}</p></div>
            )}

            {!loading && data?.error && (
                <div className="empty-state"><AlertTriangle size={48} /><p>Could not generate insights. Try again.</p></div>
            )}

            {!loading && data && !data.empty && !data.error && (
                <>
                    {/* Top stat cards */}
                    <div className="aii-stats">
                        <div className="aii-stat">
                            <div className="aii-stat-icon" style={{ background: 'rgba(79,70,229,0.12)', color: '#4f46e5' }}><Target size={20} /></div>
                            <div><strong>{data.classAvg}%</strong><span>Class Average</span></div>
                        </div>
                        <div className="aii-stat">
                            <div className="aii-stat-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}><Users size={20} /></div>
                            <div><strong>{data.totalStudents}</strong><span>Students</span></div>
                        </div>
                        <div className="aii-stat">
                            <div className="aii-stat-icon" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}><FileText size={20} /></div>
                            <div><strong>{data.totalPapers}</strong><span>Papers Graded</span></div>
                        </div>
                        <div className="aii-stat">
                            <div className="aii-stat-icon" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}><AlertTriangle size={20} /></div>
                            <div><strong>{data.atRisk.length}</strong><span>At Risk</span></div>
                        </div>
                    </div>

                    {/* AI headline */}
                    {data.narrative?.headline && (
                        <div className="aii-headline">
                            <Sparkles size={18} /> {data.narrative.headline}
                        </div>
                    )}

                    <div className="aii-grid">
                        {/* Subject performance bars */}
                        <div className="aii-card">
                            <h3>📊 Subject Performance</h3>
                            {data.subjectStats.map(s => (
                                <div key={s.name} className="aii-bar-row">
                                    <span className="aii-bar-label">{s.name}</span>
                                    <div className="aii-bar-track">
                                        <div className="aii-bar-fill" style={{ width: `${s.avg}%`, background: s.avg < 50 ? '#ef4444' : s.avg < 70 ? '#f59e0b' : '#10b981' }} />
                                    </div>
                                    <span className="aii-bar-val">{s.avg}%</span>
                                </div>
                            ))}
                        </div>

                        {/* At-risk students */}
                        <div className="aii-card">
                            <h3>⚠️ Students Needing Help</h3>
                            {data.atRisk.length === 0 ? (
                                <p className="aii-muted">🎉 No at-risk students — everyone is doing well!</p>
                            ) : data.atRisk.map(s => (
                                <div key={s.id} className="aii-risk-row">
                                    <span className="aii-risk-id">{s.id}</span>
                                    <span className={`aii-trend ${s.trend >= 0 ? 'up' : 'down'}`}>
                                        {s.trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                                        {s.trend >= 0 ? '+' : ''}{s.trend}%
                                    </span>
                                    <span className="aii-risk-avg">{s.avg}%</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* AI narrative sections */}
                    <div className="aii-grid">
                        {data.narrative?.strengths?.length > 0 && (
                            <div className="aii-card aii-narr">
                                <h3><CheckCircle size={16} color="#10b981" /> Strengths</h3>
                                <ul>{data.narrative.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
                            </div>
                        )}
                        {data.narrative?.concerns?.length > 0 && (
                            <div className="aii-card aii-narr">
                                <h3><AlertTriangle size={16} color="#f59e0b" /> Topics to Reteach</h3>
                                <ul>{data.narrative.concerns.map((x, i) => <li key={i}>{x}</li>)}</ul>
                            </div>
                        )}
                    </div>

                    {data.narrative?.recommendations?.length > 0 && (
                        <div className="aii-card aii-recommend">
                            <h3><Lightbulb size={16} color="#4f46e5" /> AI Recommendations</h3>
                            <ul>{data.narrative.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul>
                            {data.narrative.at_risk_advice && (
                                <div className="aii-advice">💡 {data.narrative.at_risk_advice}</div>
                            )}
                        </div>
                    )}

                    {/* Top performers */}
                    {data.topPerformers.length > 0 && (
                        <div className="aii-card">
                            <h3><Award size={16} color="#f59e0b" /> Top Performers</h3>
                            <div className="aii-top">
                                {data.topPerformers.map((s, i) => (
                                    <div key={s.id} className="aii-top-chip">
                                        <span className="aii-medal">{['🥇','🥈','🥉'][i] || '⭐'}</span>
                                        {s.id} <strong>{s.avg}%</strong>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
