import React, { useState } from 'react';
import { GraduationCap, BookOpen, ArrowLeft } from 'lucide-react';
import api from '../api';

function Login({ onLogin }) {
    // Flow: pick a role first → then show the matching login form.
    const [portal, setPortal]     = useState(null);   // null | 'teacher' | 'student'
    const [isLogin, setIsLogin]   = useState(true);   // teacher can also sign up
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState(null);
    const [loading, setLoading]   = useState(false);

    const reset = () => { setUsername(''); setPassword(''); setError(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            if (portal === 'teacher' && !isLogin) {
                // Teacher self-registration
                await api.post('/auth/register', { username, password });
                const res = await api.post('/auth/login', { username, password, portal: 'teacher' });
                onLogin(res.data.token, true, res.data.role);
                return;
            }

            // Send the chosen portal so the backend authenticates against the
            // correct account type (prevents teacher/student username collisions).
            const res = await api.post('/auth/login', { username, password, portal });
            onLogin(res.data.token, false, res.data.role);
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    // ── Step 1: choose portal ──────────────────────────────────────
    if (!portal) {
        return (
            <div className="login-container">
                <div className="card login-card" style={{ animation: 'fadeIn 0.5s ease', maxWidth: '460px' }}>
                    <h2 className="login-title logo-text" style={{ marginBottom: '0.25rem' }}>Welcome to MarkNex</h2>
                    <p style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--text-muted)' }}>
                        Choose how you want to sign in
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <button
                            onClick={() => { setPortal('teacher'); setIsLogin(true); reset(); }}
                            style={portalBtnStyle('#4f46e5')}
                            className="portal-choice">
                            <div style={iconCircle('#4f46e5')}><BookOpen size={26} color="#fff" /></div>
                            <div style={{ textAlign: 'left' }}>
                                <strong style={{ fontSize: '1.1rem', display: 'block' }}>I'm a Teacher</strong>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Grade papers, manage classes & students</span>
                            </div>
                        </button>

                        <button
                            onClick={() => { setPortal('student'); setIsLogin(true); reset(); }}
                            style={portalBtnStyle('#10b981')}
                            className="portal-choice">
                            <div style={iconCircle('#10b981')}><GraduationCap size={26} color="#fff" /></div>
                            <div style={{ textAlign: 'left' }}>
                                <strong style={{ fontSize: '1.1rem', display: 'block' }}>I'm a Student</strong>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>View your results & improvement tips</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Step 2: login form for the chosen portal ───────────────────
    const isTeacher = portal === 'teacher';
    const accent = isTeacher ? '#4f46e5' : '#10b981';

    return (
        <div className="login-container">
            <div className="card login-card" style={{ animation: 'fadeIn 0.5s ease' }}>
                <button
                    type="button"
                    onClick={() => { setPortal(null); reset(); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '1rem', padding: 0, fontSize: '0.88rem' }}>
                    <ArrowLeft size={16} /> Back
                </button>

                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div style={{ ...iconCircle(accent), width: '56px', height: '56px', margin: '0 auto 0.75rem' }}>
                        {isTeacher ? <BookOpen size={28} color="#fff" /> : <GraduationCap size={28} color="#fff" />}
                    </div>
                    <h2 className="login-title logo-text" style={{ margin: 0, color: accent }}>
                        {isTeacher ? 'Teacher' : 'Student'} {isLogin ? 'Login' : 'Sign Up'}
                    </h2>
                    <p style={{ color: 'var(--text-muted)', marginTop: '0.35rem', fontSize: '0.9rem' }}>
                        {isTeacher
                            ? (isLogin ? 'Sign in to your teacher account' : 'Create a new teacher account')
                            : 'Use the username & password your teacher gave you'}
                    </p>
                </div>

                {error && (
                    <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '0.85rem', borderRadius: '8px', marginBottom: '1.25rem', textAlign: 'center', fontSize: '0.9rem' }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="form-label" htmlFor="username">Username</label>
                        <input
                            className="form-input"
                            type="text"
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder={isTeacher ? 'e.g., teacher' : 'Your student username'}
                            required
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="password">Password</label>
                        <input
                            className="form-input"
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '1rem', background: accent, borderColor: accent }}
                        disabled={loading}>
                        {loading ? 'Authenticating…' : (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                {/* Only teachers can self-register; students are created by teachers */}
                {isTeacher && (
                    <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            {isLogin ? "Don't have an account? " : 'Already have an account? '}
                            <button
                                type="button"
                                onClick={() => { setIsLogin(!isLogin); setError(null); }}
                                style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                                {isLogin ? 'Sign up' : 'Sign in'}
                            </button>
                        </p>
                    </div>
                )}

                {!isTeacher && (
                    <p style={{ textAlign: 'center', marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        Don't have an account? Ask your teacher to create one for you.
                    </p>
                )}
            </div>
        </div>
    );
}

// Inline style helpers
const portalBtnStyle = (accent) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.25rem',
    border: `2px solid var(--border)`,
    borderRadius: '14px',
    background: 'var(--surface)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
});

const iconCircle = (bg) => ({
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
});

export default Login;
