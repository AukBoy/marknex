import React, { useState, useEffect } from 'react';
import {
    GraduationCap, FileText, TrendingUp, Award, CheckCircle,
    Calendar, LogOut, BookOpen, Target, Loader, Sparkles,
    PenTool, XCircle, Clock, ArrowLeft, Play, Trophy, Star, Zap
} from 'lucide-react';
import api from '../api';
import './StudentPortal.css';

// What a logged-in student sees: their own grades, AI feedback, and attendance.
export default function StudentPortal({ onLogout }) {
    const [profile, setProfile]   = useState(null);
    const [results, setResults]   = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [tab, setTab]           = useState('results');
    const [openResult, setOpenResult] = useState(null);
    const [feedback, setFeedback] = useState({});      // resultId → feedback data
    const [loadingFb, setLoadingFb] = useState(null);

    useEffect(() => { load(); }, []);

    const load = async () => {
        try {
            const [p, r, a] = await Promise.all([
                api.get('/student/me'),
                api.get('/student/results'),
                api.get('/student/attendance'),
            ]);
            setProfile(p.data);
            setResults(r.data);
            setAttendance(a.data);
        } catch (e) { console.error(e); }
    };

    const avgPct = results.length
        ? Math.round(results.reduce((s, r) => s + (r.total_marks / (r.max_marks || 10)) * 100, 0) / results.length)
        : 0;

    const attendancePct = attendance.length
        ? Math.round((attendance.filter(a => a.status === 'present').length / attendance.length) * 100)
        : null;

    const loadFeedback = async (id) => {
        if (feedback[id]) { setOpenResult(openResult === id ? null : id); return; }
        setLoadingFb(id);
        try {
            const { data } = await api.post(`/scripts/${id}/feedback-pdf`, {});
            setFeedback(prev => ({ ...prev, [id]: data }));
            setOpenResult(id);
        } catch (e) {
            setFeedback(prev => ({ ...prev, [id]: { message: e.response?.data?.error || 'Could not load feedback' } }));
            setOpenResult(id);
        } finally { setLoadingFb(null); }
    };

    if (!profile) return <div className="sp-loading"><Loader className="spin" size={28} /> Loading your portal…</div>;

    return (
        <div className="sp-wrapper">
            {/* Header */}
            <header className="sp-header">
                <div className="sp-brand">
                    <GraduationCap size={26} />
                    <div>
                        <strong>MarkNex Student</strong>
                        <span>Welcome, {profile.name || profile.username}</span>
                    </div>
                </div>
                <button className="sp-logout" onClick={onLogout}><LogOut size={16} /> Logout</button>
            </header>

            {/* Profile card */}
            <div className="sp-profile">
                <div className="sp-avatar">{(profile.name || profile.username || '?').charAt(0).toUpperCase()}</div>
                <div className="sp-profile-info">
                    <h2>{profile.name || profile.username}</h2>
                    <p>{profile.grade} · {profile.subject} · {profile.class_name}</p>
                    <small>Student ID: {profile.student_id}</small>
                </div>
                <div className="sp-stats">
                    <div className="sp-stat">
                        <Award size={18} />
                        <strong>{avgPct}%</strong>
                        <span>Average</span>
                    </div>
                    <div className="sp-stat">
                        <FileText size={18} />
                        <strong>{results.length}</strong>
                        <span>Exams</span>
                    </div>
                    {attendancePct !== null && (
                        <div className="sp-stat">
                            <CheckCircle size={18} />
                            <strong>{attendancePct}%</strong>
                            <span>Attendance</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="sp-tabs">
                <button className={`sp-tab ${tab === 'results' ? 'active' : ''}`} onClick={() => setTab('results')}>
                    <FileText size={15} /> My Results
                </button>
                <button className={`sp-tab ${tab === 'quizzes' ? 'active' : ''}`} onClick={() => setTab('quizzes')}>
                    <PenTool size={15} /> Quizzes
                </button>
                <button className={`sp-tab ${tab === 'achievements' ? 'active' : ''}`} onClick={() => setTab('achievements')}>
                    <Trophy size={15} /> Achievements
                </button>
                <button className={`sp-tab ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>
                    <Calendar size={15} /> Attendance
                </button>
            </div>

            {tab === 'quizzes' && <QuizzesTab />}
            {tab === 'achievements' && <AchievementsTab />}

            {/* Results */}
            {tab === 'results' && (
                <div className="sp-results">
                    {results.length === 0 ? (
                        <div className="sp-empty"><BookOpen size={40} /><p>No results yet. Your teacher will publish them here.</p></div>
                    ) : results.map(r => {
                        const pct = Math.round((r.total_marks / (r.max_marks || 10)) * 100);
                        const fb = feedback[r.id];
                        return (
                            <div key={r.id} className="sp-result-card">
                                <div className="sp-result-head">
                                    <div>
                                        <strong>{r.subject} — {r.exam}</strong>
                                        <small>{r.grade} · {new Date(r.upload_timestamp).toLocaleDateString()}</small>
                                    </div>
                                    <div className={`sp-score ${pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'low'}`}>
                                        {r.total_marks}/{r.max_marks || 10}
                                        <span>{pct}%</span>
                                    </div>
                                </div>

                                {r.report && <p className="sp-report">{r.report}</p>}

                                <button className="sp-fb-btn" onClick={() => loadFeedback(r.id)} disabled={loadingFb === r.id}>
                                    {loadingFb === r.id
                                        ? <><Loader size={14} className="spin" /> Analysing…</>
                                        : <><Sparkles size={14} /> {openResult === r.id ? 'Hide' : 'Show'} AI Improvement Tips</>}
                                </button>

                                {openResult === r.id && fb && (
                                    <div className="sp-feedback">
                                        {fb.message ? (
                                            <p className="sp-fb-perfect">{fb.message}</p>
                                        ) : (
                                            <>
                                                <div className="sp-fb-block">
                                                    <h4><Target size={14} /> How you did</h4>
                                                    <p>{fb.feedback?.overall_assessment}</p>
                                                </div>
                                                {fb.feedback?.key_mistakes?.length > 0 && (
                                                    <div className="sp-fb-block">
                                                        <h4>Key things to fix</h4>
                                                        {fb.feedback.key_mistakes.map((m, i) => (
                                                            <div key={i} className="sp-mistake">
                                                                <strong>{m.topic}</strong>
                                                                <span>{m.what_went_wrong}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {fb.feedback?.improvement_plan?.length > 0 && (
                                                    <div className="sp-fb-block">
                                                        <h4><TrendingUp size={14} /> Your study plan</h4>
                                                        <ul>{fb.feedback.improvement_plan.map((s, i) => <li key={i}>{s}</li>)}</ul>
                                                    </div>
                                                )}
                                                {fb.feedback?.topics_to_revise?.length > 0 && (
                                                    <div className="sp-fb-block">
                                                        <h4>Topics to revise</h4>
                                                        <div className="sp-chips">{fb.feedback.topics_to_revise.map((t, i) => <span key={i} className="sp-chip">{t}</span>)}</div>
                                                    </div>
                                                )}
                                                {fb.feedback?.encouragement && (
                                                    <div className="sp-encourage">💪 {fb.feedback.encouragement}</div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Attendance */}
            {tab === 'attendance' && (
                <div className="sp-attendance">
                    {attendance.length === 0 ? (
                        <div className="sp-empty"><Calendar size={40} /><p>No attendance records yet.</p></div>
                    ) : (
                        <div className="sp-att-grid">
                            {attendance.map((a, i) => (
                                <div key={i} className={`sp-att-day ${a.status}`}>
                                    <span className="sp-att-date">{new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    <span className="sp-att-status">{a.status}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// QUIZZES — list available quizzes, take them, get instant marks
// ─────────────────────────────────────────────────────────────
function QuizzesTab() {
    const [quizzes, setQuizzes] = useState([]);
    const [view, setView]       = useState('list');   // list | take | result
    const [active, setActive]   = useState(null);
    const [answers, setAnswers] = useState({});
    const [result, setResult]   = useState(null);
    const [loading, setLoading] = useState(false);
    const [timeLeft, setTimeLeft] = useState(null);

    useEffect(() => { fetchQuizzes(); }, []);
    const fetchQuizzes = async () => { try { setQuizzes((await api.get('/student/quizzes')).data); } catch {} };

    useEffect(() => {
        if (view !== 'take' || timeLeft === null) return;
        if (timeLeft <= 0) { submitQuiz(); return; }
        const t = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
        return () => clearTimeout(t);
    }, [view, timeLeft]);

    const startQuiz = async (id, timeLimit) => {
        setLoading(true);
        try {
            const { data } = await api.get(`/student/quizzes/${id}`);
            setActive(data);
            setAnswers({});
            setTimeLeft(timeLimit ? timeLimit * 60 : null);
            setView('take');
        } catch {} finally { setLoading(false); }
    };

    const submitQuiz = async () => {
        if (!active) return;
        setLoading(true);
        try {
            const arr = active.questions.map((_, i) => answers[i] ?? -1);
            const { data } = await api.post(`/student/quizzes/${active.id}/submit`, { answers: arr });
            setResult(data);
            setView('result');
            fetchQuizzes();
        } catch {} finally { setLoading(false); }
    };

    const fmtTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

    if (view === 'result' && result) {
        return (
            <div className="sp-quiz-result">
                <div className={`sp-quiz-score-big ${result.percentage>=75?'good':result.percentage>=50?'ok':'low'}`}>
                    <span className="sp-qsb-pct">{result.percentage}%</span>
                    <span className="sp-qsb-frac">{result.score} / {result.total} correct</span>
                </div>
                <div className="sp-quiz-review">
                    {result.feedback.map((f, i) => (
                        <div key={i} className={`sp-qr-item ${f.is_correct ? 'correct' : 'wrong'}`}>
                            <div className="sp-qr-q">
                                {f.is_correct ? <CheckCircle size={16}/> : <XCircle size={16}/>}
                                <span>{i+1}. {f.text}</span>
                            </div>
                            <div className="sp-qr-opts">
                                {f.options.map((o, oi) => (
                                    <div key={oi} className={`sp-qr-opt ${oi===f.correct_answer?'is-correct':''} ${oi===f.your_answer&&oi!==f.correct_answer?'is-wrong':''}`}>
                                        {String.fromCharCode(65+oi)}. {o}
                                        {oi===f.correct_answer && ' ✓'}
                                        {oi===f.your_answer && oi!==f.correct_answer && ' ✗ (your answer)'}
                                    </div>
                                ))}
                            </div>
                            {f.explanation && <div className="sp-qr-explain">💡 {f.explanation}</div>}
                        </div>
                    ))}
                </div>
                <button className="sp-fb-btn" onClick={() => { setView('list'); setResult(null); setActive(null); }}>
                    <ArrowLeft size={14}/> Back to Quizzes
                </button>
            </div>
        );
    }

    if (view === 'take' && active) {
        const answered = Object.keys(answers).length;
        return (
            <div className="sp-quiz-take">
                <div className="sp-quiz-take-head">
                    <strong>{active.title}</strong>
                    {timeLeft !== null && <span className={`sp-quiz-timer ${timeLeft<60?'urgent':''}`}><Clock size={14}/> {fmtTime(timeLeft)}</span>}
                </div>
                <div className="sp-quiz-progress"><div style={{ width: `${(answered/active.questions.length)*100}%` }}/></div>
                {active.questions.map((q, i) => (
                    <div key={i} className="sp-take-q">
                        <div className="sp-take-qtext">{i+1}. {q.text}</div>
                        {q.options.map((o, oi) => (
                            <button key={oi}
                                className={`sp-take-opt ${answers[i]===oi?'selected':''}`}
                                onClick={() => setAnswers(a => ({ ...a, [i]: oi }))}>
                                <span className="sp-take-letter">{String.fromCharCode(65+oi)}</span> {o}
                            </button>
                        ))}
                    </div>
                ))}
                <div className="sp-take-submit">
                    <span>{answered} of {active.questions.length} answered</span>
                    <button className="sp-fb-btn" style={{ background: '#10b981', color:'#fff', borderColor:'#10b981', maxWidth:'200px' }} onClick={submitQuiz} disabled={loading}>
                        {loading ? <><Loader size={14} className="spin"/> Submitting…</> : <>Submit Quiz</>}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="sp-quizzes">
            {quizzes.length === 0 ? (
                <div className="sp-empty"><PenTool size={40}/><p>No quizzes available yet. Check back soon!</p></div>
            ) : quizzes.map(q => {
                const done = q.submitted_at;
                const pct = done ? Math.round((q.score/q.total)*100) : null;
                return (
                    <div key={q.id} className="sp-quiz-card">
                        <div>
                            <strong>{q.title}</strong>
                            <small>{q.subject} · {q.question_count} questions {q.time_limit ? `· ${q.time_limit} min` : ''}</small>
                        </div>
                        {done ? (
                            <div className="sp-quiz-done">
                                <span className={`sp-score ${pct>=75?'good':pct>=50?'ok':'low'}`}>{q.score}/{q.total}<span>{pct}%</span></span>
                                <button className="sp-quiz-retake" onClick={() => startQuiz(q.id, q.time_limit)}>Retake</button>
                            </div>
                        ) : (
                            <button className="sp-quiz-start" onClick={() => startQuiz(q.id, q.time_limit)} disabled={loading}>
                                <Play size={14}/> Start
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// ACHIEVEMENTS — XP, level, badges, class leaderboard
// ─────────────────────────────────────────────────────────────
function AchievementsTab() {
    const [g, setG] = useState(null);
    const [board, setBoard] = useState([]);

    useEffect(() => {
        api.get('/student/gamification').then(r => setG(r.data)).catch(() => {});
        api.get('/student/leaderboard').then(r => setBoard(r.data)).catch(() => {});
    }, []);

    if (!g) return <div className="page-loader"><div className="spinner" /></div>;

    return (
        <div className="sp-achieve">
            {/* Level + XP */}
            <div className="sp-level-card">
                <div className="sp-level-badge"><Zap size={22} /><span>Lv {g.level}</span></div>
                <div className="sp-xp">
                    <div className="sp-xp-row"><strong>{g.xp} XP</strong><span>{g.xpInLevel}/{g.xpToNext} to Lv {g.level + 1}</span></div>
                    <div className="sp-xp-bar"><div style={{ width: `${(g.xpInLevel / g.xpToNext) * 100}%` }} /></div>
                </div>
                <div className="sp-level-stats">
                    <div><strong>{g.papers}</strong><span>Papers</span></div>
                    <div><strong>{g.quizzes}</strong><span>Quizzes</span></div>
                    <div><strong>{g.avg}%</strong><span>Average</span></div>
                </div>
            </div>

            {/* Badges */}
            <h3 className="sp-section-h"><Award size={17} /> Badges</h3>
            <div className="sp-badges">
                {g.badges.map(b => (
                    <div key={b.id} className={`sp-badge ${b.earned ? 'earned' : 'locked'}`} title={b.name}>
                        <span className="sp-badge-icon">{b.earned ? b.icon : '🔒'}</span>
                        <span className="sp-badge-name">{b.name}</span>
                    </div>
                ))}
            </div>

            {/* Leaderboard */}
            {board.length > 0 && (
                <>
                    <h3 className="sp-section-h"><Trophy size={17} /> Class Leaderboard</h3>
                    <div className="sp-board">
                        {board.map(r => (
                            <div key={r.rank} className={`sp-board-row ${r.isMe ? 'me' : ''}`}>
                                <span className="sp-rank">{['🥇','🥈','🥉'][r.rank - 1] || `#${r.rank}`}</span>
                                <span className="sp-board-name">{r.name}{r.isMe && ' (You)'}</span>
                                <span className="sp-board-lv">Lv {r.level}</span>
                                <span className="sp-board-xp">{r.xp} XP</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
