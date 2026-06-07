import React, { useEffect, useState } from 'react';
import { ShieldCheck, Scale, Target, TrendingUp, AlertCircle } from 'lucide-react';
import api from '../api';

// Human-vs-AI agreement: how closely the AI's original grade matched the
// teacher's final grade across reviewed scripts. The core validation surface —
// it turns ordinary marking into a measurable reliability study.

// Cohen/QWK interpretation bands (Landis & Koch).
function kappaLabel(k) {
    if (k === null || k === undefined) return { text: '—', color: 'var(--text-muted)' };
    if (k < 0.2) return { text: 'Slight', color: 'var(--danger)' };
    if (k < 0.4) return { text: 'Fair', color: 'var(--warning)' };
    if (k < 0.6) return { text: 'Moderate', color: 'var(--warning)' };
    if (k < 0.8) return { text: 'Substantial', color: 'var(--success)' };
    return { text: 'Almost perfect', color: 'var(--success)' };
}

function MetricCard({ icon: Icon, label, value, sub, accent }) {
    return (
        <div className="card" style={{ flex: '1 1 180px', minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: accent || 'var(--primary)', marginBottom: '0.6rem' }}>
                <Icon size={18} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 700, lineHeight: 1 }}>{value}</div>
            {sub && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>{sub}</div>}
        </div>
    );
}

// Scatter of AI% (x) vs Teacher% (y); points on the diagonal = perfect match.
function Scatter({ pairs }) {
    const size = 360, pad = 36, plot = size - pad * 2;
    const x = pct => pad + (pct / 100) * plot;
    const y = pct => size - pad - (pct / 100) * plot;
    return (
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: 420 }}>
            {/* grid + axes */}
            {[0, 25, 50, 75, 100].map(t => (
                <g key={t}>
                    <line x1={x(t)} y1={y(0)} x2={x(t)} y2={y(100)} stroke="var(--border)" strokeWidth="1" />
                    <line x1={x(0)} y1={y(t)} x2={x(100)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
                    <text x={x(t)} y={size - pad + 16} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{t}</text>
                    <text x={pad - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)">{t}</text>
                </g>
            ))}
            {/* perfect-agreement diagonal */}
            <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.6" />
            {/* points */}
            {pairs.map((p, i) => (
                <circle key={i} cx={x(p.ai_pct)} cy={y(p.human_pct)} r="5"
                    fill="var(--secondary)" opacity="0.55" stroke="white" strokeWidth="1">
                    <title>{`${p.student_id || 'Script'}: AI ${p.ai}/${p.max}, Teacher ${p.human}/${p.max}`}</title>
                </circle>
            ))}
            <text x={size / 2} y={size - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text-muted)">AI grade (%)</text>
            <text x={12} y={size / 2} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text-muted)" transform={`rotate(-90 12 ${size / 2})`}>Teacher grade (%)</text>
        </svg>
    );
}

function AgreementDashboard() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.get('/analytics/agreement')
            .then(res => setData(res.data))
            .catch(err => setError(err.response?.data?.error || err.message));
    }, []);

    if (error) return <div style={{ padding: '2rem', color: 'var(--danger)' }}>Failed to load: {error}</div>;
    if (!data) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading agreement metrics…</div>;

    return (
        <div style={{ animation: 'fadeIn 0.4s ease' }}>
            <div className="dashboard-header">
                <h2 style={{ margin: 0, fontSize: '2rem' }}>AI vs Teacher Agreement</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                    How closely the AI's first grade matched your final grade, across {data.n} reviewed script{data.n === 1 ? '' : 's'}.
                </p>
            </div>

            {data.n === 0 ? (
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)' }}>
                    <AlertCircle size={20} />
                    <span>{data.message}</span>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                        <MetricCard
                            icon={Scale} label="Weighted Kappa (QWK)"
                            value={data.qwk ?? '—'}
                            sub={kappaLabel(data.qwk).text + ' agreement'}
                            accent={kappaLabel(data.qwk).color}
                        />
                        <MetricCard icon={Target} label="Exact agreement" value={`${data.exactAgreementPct}%`} sub="identical mark" />
                        <MetricCard icon={ShieldCheck} label="Within 1 mark" value={`${data.within1MarkPct}%`} sub="±1 of teacher" />
                        <MetricCard icon={TrendingUp} label="Mean abs. error" value={data.maeMarks} sub="marks, average" />
                        <MetricCard
                            icon={TrendingUp} label="Bias" value={(data.biasMarks > 0 ? '+' : '') + data.biasMarks}
                            sub={data.biasMarks > 0 ? 'AI graded lower than you' : data.biasMarks < 0 ? 'AI graded higher than you' : 'no systematic bias'}
                            accent={Math.abs(data.biasMarks) < 0.5 ? 'var(--success)' : 'var(--warning)'}
                        />
                    </div>

                    <div className="card">
                        <h3 style={{ marginTop: 0 }}>Grade-by-grade comparison</h3>
                        <p style={{ color: 'var(--text-muted)', marginTop: 0, fontSize: '0.9rem' }}>
                            Each point is one script. Points on the dashed line are where the AI and you agreed exactly.
                            Points above it are where you graded higher than the AI; below, lower.
                        </p>
                        <Scatter pairs={data.pairs} />
                    </div>
                </>
            )}
        </div>
    );
}

export default AgreementDashboard;
