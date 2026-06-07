import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Award, FileText, ChevronUp, ChevronDown, CheckCircle } from 'lucide-react';
import api from '../api';

function ClassReport() {
    const navigate = useNavigate();
    const [scripts, setScripts] = useState([]);
    const [selectedGrade, setSelectedGrade] = useState('');
    const [selectedExam, setSelectedExam] = useState('');

    useEffect(() => {
        const fetchScripts = async () => {
            try {
                const res = await api.get('/scripts');
                // Filter out deleted scripts, and ensure evaluated
                const validScripts = res.data.filter(s => !s.is_deleted && s.status !== 'Pending');
                setScripts(validScripts);
            } catch (err) {
                console.error(err);
            }
        };
        fetchScripts();
    }, []);

    // Get predefined and unique grades and exams
    const predefinedGrades = ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'Unassigned Grade'];
    const predefinedExams = ['Term 1', 'Term 2', 'Term 3', 'Mid-Term', 'Final', 'Unassigned Exam'];
    
    // Combine predefined with any custom ones that might exist in the database
    const grades = [...new Set([...predefinedGrades, ...scripts.map(s => s.grade || 'Unassigned Grade')])]
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    const exams = [...new Set([...predefinedExams, ...scripts.map(s => s.exam || 'Unassigned Exam')])].sort();

    // Filter scripts based on selection
    const filteredScripts = scripts.filter(s => {
        const matchGrade = selectedGrade ? (s.grade || 'Unassigned Grade') === selectedGrade : true;
        const matchExam = selectedExam ? (s.exam || 'Unassigned Exam') === selectedExam : true;
        return matchGrade && matchExam;
    });

    // Sort by marks descending (rank up list)
    const rankedScripts = [...filteredScripts].sort((a, b) => (b.total_marks || 0) - (a.total_marks || 0));

    // Calculate metrics
    const totalStudents = rankedScripts.length;
    const avgScore = totalStudents > 0 ? (rankedScripts.reduce((acc, s) => acc + (s.total_marks || 0), 0) / totalStudents).toFixed(1) : 0;
    const highestScore = totalStudents > 0 ? Math.max(...rankedScripts.map(s => s.total_marks || 0)) : 0;
    const lowestScore = totalStudents > 0 ? Math.min(...rankedScripts.map(s => s.total_marks || 0)) : 0;

    return (
        <div style={{ animation: 'fadeIn 0.5s ease', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="btn"
                    style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </button>
                <button
                    onClick={() => window.print()}
                    className="btn btn-primary"
                    style={{ padding: '0.5rem 1rem' }}>
                    Print Report
                </button>
            </div>

            <div className="card report-card-print" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                    <Award size={40} color="var(--primary)" />
                    <div>
                        <h2 style={{ margin: 0, fontSize: '2rem' }}>Class Rank & Report</h2>
                        <p style={{ margin: 0, color: 'var(--text-muted)' }}>Generate leaderboard and analytics for specific groups.</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="form-label">Filter by Grade</label>
                        <select className="form-input" value={selectedGrade} onChange={(e) => setSelectedGrade(e.target.value)}>
                            <option value="">All Grades</option>
                            {grades.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="form-label">Filter by Exam</label>
                        <select className="form-input" value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
                            <option value="">All Exams</option>
                            {exams.map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                    </div>
                </div>

                {totalStudents > 0 ? (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Total Evaluated</span>
                                <strong style={{ fontSize: '2rem', color: 'var(--text-main)' }}>{totalStudents}</strong>
                            </div>
                            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Class Average</span>
                                <strong style={{ fontSize: '2rem', color: 'var(--primary)' }}>{avgScore}</strong>
                            </div>
                            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Highest Score</span>
                                <strong style={{ fontSize: '2rem', color: 'var(--success)' }}>{highestScore}</strong>
                            </div>
                            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Lowest Score</span>
                                <strong style={{ fontSize: '2rem', color: 'var(--danger)' }}>{lowestScore}</strong>
                            </div>
                        </div>

                        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Student Rank List</h3>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
                                        <th style={{ padding: '1rem' }}>Rank</th>
                                        <th style={{ padding: '1rem' }}>Student ID</th>
                                        <th style={{ padding: '1rem' }}>Grade / Exam</th>
                                        <th style={{ padding: '1rem' }}>Score</th>
                                        <th style={{ padding: '1rem' }}>Review State</th>
                                        <th style={{ padding: '1rem' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rankedScripts.map((script, idx) => (
                                        <tr key={script.id} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.01)' }}>
                                            <td style={{ padding: '1rem', fontWeight: 'bold', color: idx === 0 ? 'var(--primary)' : 'inherit' }}>
                                                {idx === 0 && <Award size={16} style={{ display: 'inline-block', marginRight: '4px', verticalAlign: 'middle' }} />}
                                                #{idx + 1}
                                            </td>
                                            <td style={{ padding: '1rem', fontWeight: 500 }}>{script.student_id}</td>
                                            <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{script.grade} - {script.exam}</td>
                                            <td style={{ padding: '1rem' }}>
                                                {(() => {
                                                    const max = script.max_marks || 10;
                                                    const pct = max > 0 ? (script.total_marks / max) * 100 : 0;
                                                    const color = pct >= 80 ? 'var(--success)' : (pct < 50 ? 'var(--danger)' : 'var(--warning)');
                                                    return (
                                                        <strong style={{ fontSize: '1.1rem', color }}>
                                                            {script.total_marks}/{max}
                                                        </strong>
                                                    );
                                                })()}
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <span className={`badge ${script.status === 'Needs Review' ? 'badge-danger' : 'badge-success'}`}>
                                                    {script.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <Link to={`/report/${script.id}`} className="btn btn-secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.9rem' }}>
                                                    View Report
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)' }}>
                        <FileText size={48} style={{ opacity: 0.5, margin: '0 auto 1rem auto' }} />
                        <p>No evaluated scripts found for the selected Grade & Exam combination.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ClassReport;
