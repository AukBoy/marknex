import React, { useState } from 'react';
import { GraduationCap, BookOpen, ArrowLeft } from 'lucide-react';
import api from '../api';

function Login({ onLogin }) {
    // Flow: pick a role first → then show the matching login form.
    const [portal, setPortal]     = useState(null);   // null | 'teacher' | 'student'
    const [isLogin, setIsLogin]   = useState(true);   // teacher can also sign up
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [error, setError]       = useState(null);
    const [loading, setLoading]   = useState(false);
    // Recovery-code flow
    const [recoveryCode, setRecoveryCode] = useState(null); // shown once after signup
    const [forgotMode, setForgotMode]     = useState(false);
    const [resetCode, setResetCode]       = useState('');
    const [resetDone, setResetDone]       = useState(false);

    const reset = () => {
        setUsername(''); setPassword(''); setInviteCode(''); setError(null);
        setRecoveryCode(null); setForgotMode(false); setResetCode(''); setResetDone(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            if (portal === 'teacher' && forgotMode) {
                // Password reset with the recovery code from signup
                await api.post('/auth/reset-password', { username, recovery_code: resetCode, new_password: password });
                setResetDone(true);
                setForgotMode(false);
                setIsLogin(true);
                setPassword('');
                return;
            }

            if (portal === 'teacher' && !isLogin) {
                // Teacher self-registration — backend returns a one-time recovery
                // code which we must show before logging the user in.
                const reg = await api.post('/auth/register', { username, password, invite_code: inviteCode });
                setRecoveryCode(reg.data.recovery_code || null);
                if (!reg.data.recovery_code) {
                    const res = await api.post('/auth/login', { username, password, portal: 'teacher' });
                    onLogin(res.data.token, true, res.data.role);
                }
                return;
            }

            // Send the chosen portal so the backend authenticates against the
            // correct account type (prevents teacher/student username collisions).
            const res = await api.post('/auth/login', { username, password, portal });
            onLogin(res.data.token, false, res.data.role);
        } catch (err) {
            const fallback = forgotMode ? 'Reset failed' : (!isLogin ? 'Signup failed' : 'Login failed');
            setError(err.response?.data?.error || err.message || fallback);
        } finally {
            setLoading(false);
        }
    };

    // After signup we hold the user here until they confirm they saved the code.
    const continueAfterSignup = async () => {
        setLoading(true);
        try {
            const res = await api.post('/auth/login', { username, password, portal: 'teacher' });
            onLogin(res.data.token, true, res.data.role);
        } catch { setError('Account created — please sign in.'); setRecoveryCode(null); setIsLogin(true); }
        finally { setLoading(false); }
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
                        {isTeacher ? 'Teacher' : 'Student'} {forgotMode ? 'Password Reset' : (isLogin ? 'Login' : 'Sign Up')}
                    </h2>
                    <p style={{ color: 'var(--text-muted)', marginTop: '0.35rem', fontSize: '0.9rem' }}>
                        {isTeacher
                            ? (forgotMode
                                ? 'Enter the recovery code you saved at signup'
                                : (isLogin ? 'Sign in to your teacher account' : 'Create a new teacher account'))
                            : 'Use the username & password your teacher gave you'}
                    </p>
                </div>

                {error && (
                    <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '0.85rem', borderRadius: '8px', marginBottom: '1.25rem', textAlign: 'center', fontSize: '0.9rem' }}>
                        {error}
                    </div>
                )}

                {resetDone && (
                    <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#059669', padding: '0.85rem', borderRadius: '8px', marginBottom: '1.25rem', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600 }}>
                        ✅ Password reset! Sign in with your new password.
                    </div>
                )}

                {/* One-time recovery code screen — shown once, right after signup */}
                {recoveryCode ? (
                    <div style={{ textAlign: 'center' }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>🔑 Save your recovery code</p>
                        <div style={{
                            fontSize: '1.8rem', fontWeight: 800, letterSpacing: '0.15em',
                            background: 'rgba(79,70,229,0.08)', border: '2px dashed var(--primary)',
                            borderRadius: '12px', padding: '1rem', margin: '0 0 0.75rem',
                            fontFamily: 'monospace', userSelect: 'all',
                        }}>
                            {recoveryCode}
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                            This is the <strong>only way to reset your password</strong> if you forget it
                            (there is no email recovery). Write it down somewhere safe — it will not be shown again.
                        </p>
                        <button className="btn btn-primary" style={{ width: '100%', background: accent, borderColor: accent }}
                            onClick={continueAfterSignup} disabled={loading}>
                            {loading ? 'Signing in…' : "I saved it — continue"}
                        </button>
                    </div>
                ) : (
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

                    {forgotMode && (
                        <div className="form-group">
                            <label className="form-label" htmlFor="resetcode">Recovery Code</label>
                            <input
                                className="form-input"
                                type="text"
                                id="resetcode"
                                value={resetCode}
                                onChange={(e) => setResetCode(e.target.value)}
                                placeholder="e.g., 9F3A21BC"
                                required
                            />
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label" htmlFor="password">{forgotMode ? 'New Password' : 'Password'}</label>
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

                    {/* Invite code — only for teacher signup; required when the
                        deployment has SIGNUP_CODE configured */}
                    {isTeacher && !isLogin && !forgotMode && (
                        <div className="form-group">
                            <label className="form-label" htmlFor="invite">Invite Code</label>
                            <input
                                className="form-input"
                                type="text"
                                id="invite"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value)}
                                placeholder="From your administrator (if required)"
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '1rem', background: accent, borderColor: accent }}
                        disabled={loading}>
                        {loading ? 'Working…' : (forgotMode ? 'Reset Password' : (isLogin ? 'Sign In' : 'Create Account'))}
                    </button>
                </form>
                )}

                {/* Only teachers can self-register; students are created by teachers */}
                {isTeacher && !recoveryCode && (
                    <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                        {forgotMode ? (
                            <button
                                type="button"
                                onClick={() => { setForgotMode(false); setError(null); }}
                                style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontWeight: 600, padding: 0, fontSize: '0.9rem' }}>
                                ← Back to sign in
                            </button>
                        ) : (
                            <>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                                    {isLogin ? "Don't have an account? " : 'Already have an account? '}
                                    <button
                                        type="button"
                                        onClick={() => { setIsLogin(!isLogin); setError(null); }}
                                        style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                                        {isLogin ? 'Sign up' : 'Sign in'}
                                    </button>
                                </p>
                                {isLogin && (
                                    <button
                                        type="button"
                                        onClick={() => { setForgotMode(true); setError(null); setResetDone(false); }}
                                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '0.82rem', textDecoration: 'underline' }}>
                                        Forgot password?
                                    </button>
                                )}
                            </>
                        )}
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
