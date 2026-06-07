import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart2, TrendingUp, Users, Activity, Lightbulb, AlertTriangle, BookOpen, HelpCircle, Target, Download } from 'lucide-react';
import api from '../api';
import { useOptions } from '../hooks/useOptions';
import SimpleBarChart from './SimpleBarChart';
import SimpleLineChart from './SimpleLineChart';
import { exportGradesCSV } from '../utils/csv';
import { showToast } from '../hooks/useToast';

function AnalyticsDashboard() {
    const navigate = useNavigate();
    const { grades, subjects, exams } = useOptions();
    const [scripts, setScripts] = useState([]);
    const [selectedGrade, setSelectedGrade] = useState('All');
    const [selectedExam, setSelectedExam] = useState('All');
    const [selectedSubject, setSelectedSubject] = useState('All');

    useEffect(() => {
        const fetchScripts = async () => {
            try {
                const res = await api.get('/scripts');
                setScripts(res.data);
            } catch (err) {
                console.error(err);
            }
        };
        fetchScripts();
    }, []);

    const filteredScripts = scripts.filter(s => {
        const matchGrade = selectedGrade === 'All' || s.grade === selectedGrade;
        const matchExam = selectedExam === 'All' || s.exam === selectedExam;
        const matchSubject = selectedSubject === 'All' || s.subject === selectedSubject;
        const notDeleted = !s.is_deleted;
        return matchGrade && matchExam && matchSubject && notDeleted;
    });

    const totalScripts = filteredScripts.length;
    let avgScore = 0;
    let avgConfidence = 0;
    let needsReviewCount = 0;
    const scoreDistribution = { low: 0, medium: 0, high: 0 };

    if (totalScripts > 0) {
        const evaluatedScripts = filteredScripts.filter(s => s.status !== 'Pending');
        const count = evaluatedScripts.length;
        if (count > 0) {
            // Scores are normalised to a percentage so assignments with different
            // max marks (MCQ, essays, etc.) can be averaged and bucketed fairly.
            const pct = (s) => {
                const max = s.max_marks || 10;
                return max > 0 ? ((s.total_marks || 0) / max) * 100 : 0;
            };
            avgScore = (evaluatedScripts.reduce((acc, s) => acc + pct(s), 0) / count).toFixed(1);
            avgConfidence = (evaluatedScripts.reduce((acc, s) => acc + (s.confidence_score || 0), 0) / count).toFixed(1);

            evaluatedScripts.forEach(s => {
                const p = pct(s);
                if (p < 50) scoreDistribution.low++;
                else if (p < 80) scoreDistribution.medium++;
                else scoreDistribution.high++;
            });
        }
        needsReviewCount = filteredScripts.filter(s => s.status === 'Needs Review').length;
    }

    // Question-wise aggregation
    const questionStats = {};
    filteredScripts.forEach(s => {
        if (s.question_analysis) {
            try {
                const qa = JSON.parse(s.question_analysis);
                qa.forEach(q => {
                    const qid = q.q_num || 'Unknown';
                    if (!questionStats[qid]) questionStats[qid] = { total: 0, correct: 0, tips: [] };
                    questionStats[qid].total++;
                    if (q.status === 'Correct') questionStats[qid].correct++;
                    if (q.status !== 'Correct' && q.teacher_tip) {
                        if (!questionStats[qid].tips.includes(q.teacher_tip)) questionStats[qid].tips.push(q.teacher_tip);
                    }
                });
            } catch (e) {}
        }
    });

    const difficultQuestions = Object.entries(questionStats)
        .map(([id, stat]) => ({
            id,
            failRate: ((stat.total - stat.correct) / stat.total * 100).toFixed(0),
            tips: stat.tips.slice(0, 2)
        }))
        .filter(q => q.failRate > 0)
        .sort((a, b) => b.failRate - a.failRate)
        .slice(0, 3);

    return (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>
            <button
                onClick={() => navigate('/dashboard')}
                className="btn"
                style={{ background: 'transparent', color: 'var(--text-muted)', marginBottom: '1rem', padding: '0.5rem 0' }}>
                <ArrowLeft size={18} /> Back to Dashboard
            </button>

            <div className="dashboard-header" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1.5rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <BarChart2 size={32} color="var(--primary)" /> Class Analytics
                    </h2>
                    <p style={{ color: 'var(--text-muted)' }}>Class-level performance summary and evaluation metrics.</p>
                </div>
                {filteredScripts.length > 0 && (
                    <button
                        onClick={() => {
                            exportGradesCSV(filteredScripts, `analytics_${new Date().toISOString().split('T')[0]}.csv`);
                            showToast.success('Report exported as CSV');
                        }}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <Download size={18} /> Export Report
                    </button>
                )}

                <div style={{ display: 'flex', gap: '1rem', background: 'var(--surface)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <div className="form-group" style={{ marginBottom: 0, minWidth: '130px' }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Subject</label>
                        <select 
                            className="form-input" 
                            style={{ height: '36px', padding: '0 0.8rem', fontSize: '0.9rem' }} 
                            value={selectedSubject} 
                            onChange={(e) => setSelectedSubject(e.target.value)}
                        >
                            <option value="All">All Topics</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, minWidth: '130px' }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Grade</label>
                        <select 
                            className="form-input" 
                            style={{ height: '36px', padding: '0 0.8rem', fontSize: '0.9rem' }} 
                            value={selectedGrade} 
                            onChange={(e) => setSelectedGrade(e.target.value)}
                        >
                            <option value="All">All Grades</option>
                            {grades.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, minWidth: '130px' }}>
                        <label className="form-label" style={{ fontSize: '0.8rem' }}>Exam</label>
                        <select 
                            className="form-input" 
                            style={{ height: '36px', padding: '0 0.8rem', fontSize: '0.9rem' }} 
                            value={selectedExam} 
                            onChange={(e) => setSelectedExam(e.target.value)}
                        >
                            <option value="All">All Exams</option>
                            {exams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="analytics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '1rem', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '50%' }}>
                        <Users size={28} color="var(--primary)" />
                    </div>
                    <div>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Total Evaluated</p>
                        <strong style={{ fontSize: '1.5rem' }}>{totalScripts} Scripts</strong>
                    </div>
                </div>

                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '1rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '50%' }}>
                        <TrendingUp size={28} color="var(--success)" />
                    </div>
                    <div>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Average Score</p>
                        <strong style={{ fontSize: '1.5rem' }}>{avgScore}%</strong>
                    </div>
                </div>

                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '1rem', background: 'rgba(168, 85, 247, 0.1)', borderRadius: '50%' }}>
                        <Activity size={28} color="#a855f7" />
                    </div>
                    <div>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Avg Confidence</p>
                        <strong style={{ fontSize: '1.5rem' }}>{avgConfidence}%</strong>
                    </div>
                </div>
            </div>


            {/* Charts Section */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <SimpleBarChart
                    data={[
                        { label: 'High\n(80%+)', value: scoreDistribution.high, color: 'var(--success)' },
                        { label: 'Medium\n(50-79%)', value: scoreDistribution.medium, color: 'var(--warning)' },
                        { label: 'Low\n(<50%)', value: scoreDistribution.low, color: 'var(--danger)' }
                    ]}
                    title="Score Distribution Chart"
                    yAxisLabel="Count"
                    height={280}
                />

                {/* Grade-wise performance */}
                <SimpleBarChart
                    data={grades.map(grade => {
                        const gradeScripts = filteredScripts.filter(s => s.grade === grade && s.status !== 'Pending');
                        const avgGradeScore = gradeScripts.length > 0
                            ? (gradeScripts.reduce((sum, s) => sum + ((s.total_marks || 0) / (s.max_marks || 10) * 100), 0) / gradeScripts.length).toFixed(0)
                            : 0;
                        return { label: grade.split(' ')[1] || grade, value: avgGradeScore, color: 'var(--primary)' };
                    })}
                    title="Average Score by Grade"
                    yAxisLabel="Score %"
                    height={280}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="card">
                    <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Score Distribution</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                <span>High (80%+)</span>
                                <strong>{scoreDistribution.high}</strong>
                            </div>
                            <div style={{ background: 'var(--border)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ background: 'var(--success)', height: '100%', width: (totalScripts ? (scoreDistribution.high / totalScripts) * 100 : 0) + '%' }}></div>
                            </div>
                        </div>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                <span>Medium (50-79%)</span>
                                <strong>{scoreDistribution.medium}</strong>
                            </div>
                            <div style={{ background: 'var(--border)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ background: 'var(--warning)', height: '100%', width: (totalScripts ? (scoreDistribution.medium / totalScripts) * 100 : 0) + '%' }}></div>
                            </div>
                        </div>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                <span>Low (&lt;50%)</span>
                                <strong>{scoreDistribution.low}</strong>
                            </div>
                            <div style={{ background: 'var(--border)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ background: 'var(--danger)', height: '100%', width: (totalScripts ? (scoreDistribution.low / totalScripts) * 100 : 0) + '%' }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Target size={20} color="var(--primary)" /> Paper-Based Teacher Guide
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                        {difficultQuestions.length > 0 ? difficultQuestions.map((q, idx) => (
                            <div key={idx} style={{ padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                                    <strong style={{ fontSize: '1.1rem', color: '#1e293b' }}>{q.id} Challenge</strong>
                                    <span style={{ padding: '0.2rem 0.6rem', background: '#fee2e2', color: '#dc2626', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700 }}>
                                        {q.failRate}% Error Rate
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.5 }}>
                                    <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: 'var(--primary)' }}>Instructional Guideline:</p>
                                    <ul style={{ paddingLeft: '1.2rem', margin: 0 }}>
                                        {q.tips.length > 0 ? q.tips.map((tip, i) => (
                                            <li key={i} style={{ marginBottom: '0.4rem' }}>{tip}</li>
                                        )) : <li>Provide students with more practice variations for this specific question type.</li>}
                                    </ul>
                                </div>
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                <HelpCircle size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                                <p>No specific question-wise struggling identified yet.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AnalyticsDashboard;
