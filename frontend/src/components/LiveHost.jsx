import React, { useState, useEffect, useRef } from 'react';
import { Users, ChevronRight, X, Trophy, CheckCircle, Clock } from 'lucide-react';
import api from '../api';
import { sfx, unlockAudio } from '../utils/sounds';
import './Live.css';

// Teacher's big-screen host view for a live quiz session.
export default function LiveHost({ quizId, onExit }) {
    const [pin, setPin]     = useState('');
    const [title, setTitle] = useState('');
    const [state, setState] = useState(null);
    const poll = useRef(null);
    const prevPhase = useRef(null);   // detect phase transitions for sounds
    const prevSec   = useRef(null);   // detect tick changes
    const advancing = useRef(false);  // guard auto-advance

    useEffect(() => {
        unlockAudio();
        api.post('/live/start', { quiz_id: quizId })
            .then(r => { setPin(r.data.pin); setTitle(r.data.title); })
            .catch(() => onExit());
        return () => clearInterval(poll.current);
    }, [quizId]);

    useEffect(() => {
        if (!pin) return;
        const tick = () => api.get(`/live/${pin}/state`).then(r => {
            const st = r.data;
            // Sounds on phase changes
            if (prevPhase.current !== st.phase) {
                if (st.phase === 'question') sfx('start');
                else if (st.phase === 'reveal') sfx('reveal');
                else if (st.phase === 'ended') sfx('podium');
                prevPhase.current = st.phase;
            }
            // Countdown ticks (last 5 seconds) + auto-advance at 0
            if (st.phase === 'question' && st.secondsLeft != null) {
                if (st.secondsLeft <= 5 && st.secondsLeft > 0 && prevSec.current !== st.secondsLeft) sfx('tick');
                prevSec.current = st.secondsLeft;
                if (st.secondsLeft === 0 && !advancing.current) {
                    advancing.current = true;
                    sfx('timeup');
                    api.post(`/live/${pin}/next`).finally(() => { advancing.current = false; });
                }
            }
            setState(st);
        }).catch(() => {});
        tick();
        poll.current = setInterval(tick, 1000);
        return () => clearInterval(poll.current);
    }, [pin]);

    const next = () => { advancing.current = false; api.post(`/live/${pin}/next`); };
    const end  = () => { api.post(`/live/${pin}/end`); onExit(); };

    const OPT_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];
    const OPT_SHAPES = ['▲', '◆', '●', '■'];

    return (
        <div className="live-host">
            <div className="live-host-bar">
                <span className="live-pin-mini">PIN <strong>{pin}</strong></span>
                <span className="live-title-mini">{title}</span>
                <button className="live-exit" onClick={end}><X size={18} /> End</button>
            </div>

            {!state ? (
                <div className="live-center"><div className="spinner" /></div>
            ) : state.phase === 'lobby' ? (
                <div className="live-lobby">
                    <p className="live-join-label">Join at the Student Portal with PIN:</p>
                    <div className="live-pin-big">{pin}</div>
                    <div className="live-players-count"><Users size={22} /> {state.playerCount} joined</div>
                    <button className="live-next-btn" onClick={next} disabled={state.playerCount === 0}>
                        Start Quiz <ChevronRight size={22} />
                    </button>
                    {state.playerCount === 0 && <p className="live-hint">Waiting for students to join…</p>}
                </div>
            ) : state.phase === 'ended' ? (
                <div className="live-podium">
                    <h2><Trophy size={28} /> Final Results</h2>
                    <div className="live-podium-list">
                        {state.leaderboard.map(p => (
                            <div key={p.rank} className={`live-podium-row r${p.rank}`}>
                                <span className="live-medal">{['🥇','🥈','🥉'][p.rank - 1] || `#${p.rank}`}</span>
                                <span className="live-pname">{p.name}</span>
                                <span className="live-pscore">{p.score}</span>
                            </div>
                        ))}
                    </div>
                    <button className="live-next-btn" onClick={onExit}>Done</button>
                </div>
            ) : (
                <div className="live-question-view">
                    <div className="live-q-topbar">
                        <span className="live-q-progress">Question {state.currentQ + 1} / {state.total}</span>
                        {state.phase === 'question' && state.secondsLeft != null && (
                            <span className={`live-timer ${state.secondsLeft <= 5 ? 'urgent' : ''}`}>
                                <Clock size={20} /> {state.secondsLeft}
                            </span>
                        )}
                    </div>
                    <h1 className="live-q-text">{state.question?.text}</h1>

                    <div className="live-options">
                        {state.question?.options.map((opt, i) => {
                            const isCorrect = state.question.correct === i;
                            const revealed = state.phase === 'reveal';
                            return (
                                <div key={i}
                                    className={`live-opt ${revealed ? (isCorrect ? 'correct' : 'dim') : ''}`}
                                    style={{ background: OPT_COLORS[i] }}>
                                    <span className="live-shape">{OPT_SHAPES[i]}</span>
                                    <span className="live-opt-text">{opt}</span>
                                    {revealed && isCorrect && <CheckCircle size={26} className="live-check" />}
                                    {revealed && state.counts && <span className="live-count">{state.counts[i]}</span>}
                                </div>
                            );
                        })}
                    </div>

                    <div className="live-q-footer">
                        {state.phase === 'question'
                            ? <span className="live-answered"><Users size={18} /> {state.answered} / {state.playerCount} answered</span>
                            : <span className="live-leaderboard-mini">
                                {state.leaderboard.slice(0, 3).map(p => `${['🥇','🥈','🥉'][p.rank-1]} ${p.name} (${p.score})`).join('   ')}
                              </span>}
                        <button className="live-next-btn" onClick={next}>
                            {state.phase === 'question' ? 'Reveal Answer' : (state.currentQ + 1 >= state.total ? 'Final Results' : 'Next Question')}
                            <ChevronRight size={22} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
