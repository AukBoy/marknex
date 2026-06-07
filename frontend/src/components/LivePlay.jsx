import React, { useState, useEffect, useRef } from 'react';
import { Loader, Trophy, CheckCircle, XCircle, X, Clock } from 'lucide-react';
import api from '../api';
import { sfx, unlockAudio } from '../utils/sounds';
import './Live.css';

// Student's phone view for joining & playing a live quiz.
export default function LivePlay({ onExit }) {
    const [pin, setPin]       = useState('');
    const [joined, setJoined] = useState(false);
    const [title, setTitle]   = useState('');
    const [state, setState]   = useState(null);
    const [error, setError]   = useState('');
    const [picking, setPicking] = useState(false);
    const poll = useRef(null);

    const OPT_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];
    const OPT_SHAPES = ['▲', '◆', '●', '■'];

    const prevPhase = useRef(null);

    const join = async () => {
        setError('');
        unlockAudio();
        try {
            const r = await api.post('/live/join', { pin: pin.trim() });
            setTitle(r.data.title);
            setJoined(true);
            sfx('join');
        } catch (err) { setError(err.response?.data?.error || 'Could not join'); }
    };

    useEffect(() => {
        if (!joined) return;
        const tick = () => api.get(`/live/${pin.trim()}/play`).then(r => {
            const st = r.data;
            if (prevPhase.current !== st.phase) {
                if (st.phase === 'question') sfx('start');
                else if (st.phase === 'reveal' && st.reveal) sfx(st.reveal.gotIt ? 'correct' : 'wrong');
                else if (st.phase === 'ended') sfx('podium');
                prevPhase.current = st.phase;
            }
            setState(st);
        }).catch(() => {});
        tick();
        poll.current = setInterval(tick, 1000);
        return () => clearInterval(poll.current);
    }, [joined, pin]);

    const answer = async (i) => {
        if (state?.answered) return;
        setPicking(true);
        try { await api.post(`/live/${pin.trim()}/answer`, { option: i }); }
        catch {} finally { setPicking(false); }
    };

    // ── Join screen ──
    if (!joined) {
        return (
            <div className="live-play join">
                <button className="live-play-exit" onClick={onExit}><X size={20} /></button>
                <h2>🎮 Join Live Quiz</h2>
                <p>Enter the PIN your teacher is showing</p>
                <input
                    className="live-pin-input"
                    inputMode="numeric"
                    placeholder="000000"
                    maxLength={6}
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                />
                {error && <div className="live-error">{error}</div>}
                <button className="live-join-go" onClick={join} disabled={pin.length < 6}>Join</button>
            </div>
        );
    }

    if (!state) return <div className="live-play"><div className="spinner" /></div>;

    // ── Lobby ──
    if (state.phase === 'lobby') {
        return (
            <div className="live-play center">
                <div className="live-pulse">✅</div>
                <h2>You're in!</h2>
                <p>{title}</p>
                <p className="live-wait">Waiting for the teacher to start…</p>
            </div>
        );
    }

    // ── Question ──
    if (state.phase === 'question' && state.question) {
        return (
            <div className="live-play">
                <div className="live-play-top">
                    Q{state.currentQ + 1} / {state.total} · <strong>{state.myScore}</strong> pts
                    {state.secondsLeft != null && (
                        <span className={`live-play-timer ${state.secondsLeft <= 5 ? 'urgent' : ''}`}>
                            <Clock size={15} /> {state.secondsLeft}s
                        </span>
                    )}
                </div>
                <h3 className="live-play-q">{state.question.text}</h3>
                {state.answered ? (
                    <div className="live-play-locked"><CheckCircle size={40} /><p>Answer locked in!<br/>Waiting for others…</p></div>
                ) : (
                    <div className="live-play-opts">
                        {state.question.options.map((opt, i) => (
                            <button key={i} className="live-play-opt" style={{ background: OPT_COLORS[i] }}
                                onClick={() => answer(i)} disabled={picking}>
                                <span className="live-shape">{OPT_SHAPES[i]}</span> {opt}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ── Reveal ──
    if (state.phase === 'reveal' && state.reveal) {
        const got = state.reveal.gotIt;
        return (
            <div className={`live-play center ${got ? 'win' : 'lose'}`}>
                {got ? <CheckCircle size={64} /> : <XCircle size={64} />}
                <h2>{got ? 'Correct! 🎉' : 'Not quite'}</h2>
                {got && <p className="live-pts">+{state.reveal.points} points</p>}
                {!got && <p>Correct answer: <strong>{state.question?.options?.[state.reveal.correct] ?? OPT_SHAPES[state.reveal.correct]}</strong></p>}
                <div className="live-rank-chip">Score: {state.myScore} · Rank #{state.myRank || '—'}</div>
            </div>
        );
    }

    // ── Ended ──
    if (state.phase === 'ended') {
        return (
            <div className="live-play center">
                <Trophy size={56} color="#f59e0b" />
                <h2>Quiz Over!</h2>
                <div className="live-final-rank">#{state.myRank || '—'}</div>
                <p>{state.myScore} points</p>
                <div className="live-final-board">
                    {state.leaderboard.map(p => (
                        <div key={p.rank} className="live-fb-row">
                            <span>{['🥇','🥈','🥉'][p.rank-1] || `#${p.rank}`}</span>
                            <span className="live-fb-name">{p.name}</span>
                            <span>{p.score}</span>
                        </div>
                    ))}
                </div>
                <button className="live-join-go" onClick={onExit}>Back to Portal</button>
            </div>
        );
    }

    return <div className="live-play center"><Loader className="spin" size={32} /></div>;
}
