import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, BookOpen } from 'lucide-react';
import api from '../api';

function AssignmentManager() {
    const navigate = useNavigate();
    const [assignments, setAssignments] = useState([]);
    const [showCreate, setShowCreate] = useState(false);
    const [loading, setLoading] = useState(false);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [questions, setQuestions] = useState([
        { q_num: 'Q1', max_marks: 5, rubric: '' }
    ]);

    useEffect(() => {
        fetchAssignments();
    }, []);

    const fetchAssignments = async () => {
        try {
            const res = await api.get('/assignments');
            setAssignments(res.data);
        } catch (err) {
            console.error(err);
        }
    };

    const addQuestion = () => {
        const nextNum = questions.length + 1;
        setQuestions([...questions, { q_num: `Q${nextNum}`, max_marks: 5, rubric: '' }]);
    };

    const removeQuestion = (index) => {
        setQuestions(questions.filter((_, i) => i !== index));
    };

    const updateQuestion = (index, field, value) => {
        const newQs = [...questions];
        newQs[index][field] = value;
        setQuestions(newQs);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/assignments', { title, description, questions });
            setShowCreate(false);
            setTitle('');
            setDescription('');
            setQuestions([{ q_num: 'Q1', max_marks: 5, rubric: '' }]);
            fetchAssignments();
        } catch (err) {
            alert('Failed to create assignment');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="btn"
                    style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </button>
                <button onClick={() => setShowCreate(!showCreate)} className="btn btn-primary">
                    <Plus size={18} /> {showCreate ? 'Cancel' : 'Create New Assignment'}
                </button>
            </div>

            {showCreate && (
                <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--primary)' }}>
                    <h3>Define New Assignment & Rubrics</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label">Assignment Title</label>
                            <input 
                                className="form-input" 
                                value={title} 
                                onChange={e => setTitle(e.target.value)} 
                                placeholder="e.g., Mathematics Midterm 2024" 
                                required 
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Description (Optional)</label>
                            <textarea 
                                className="form-input" 
                                value={description} 
                                onChange={e => setDescription(e.target.value)} 
                            />
                        </div>

                        <div style={{ marginTop: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4 style={{ margin: 0 }}>Questions & Marking Scheme</h4>
                                <button type="button" onClick={addQuestion} className="btn" style={{ fontSize: '0.8rem' }}>
                                    <Plus size={14} /> Add Question
                                </button>
                            </div>

                            {questions.map((q, idx) => (
                                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr 50px', gap: '1rem', marginBottom: '1rem', alignItems: 'start', background: '#f8fafc', padding: '1rem', borderRadius: '8px' }}>
                                    <input 
                                        className="form-input" 
                                        value={q.q_num} 
                                        onChange={e => updateQuestion(idx, 'q_num', e.target.value)} 
                                        placeholder="Q1" 
                                    />
                                    <input 
                                        type="number" 
                                        className="form-input" 
                                        value={q.max_marks} 
                                        onChange={e => updateQuestion(idx, 'max_marks', e.target.value)} 
                                    />
                                    <textarea 
                                        className="form-input" 
                                        value={q.rubric} 
                                        onChange={e => updateQuestion(idx, 'rubric', e.target.value)} 
                                        placeholder="Marking criteria for AI..." 
                                        rows="2"
                                    />
                                    <button type="button" onClick={() => removeQuestion(idx)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', marginTop: '0.5rem' }}>
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} disabled={loading}>
                            <Save size={18} /> {loading ? 'Saving...' : 'Save Assignment Configuration'}
                        </button>
                    </form>
                </div>
            )}

            <div className="grid">
                {assignments.map(a => (
                    <div key={a.id} className="card hover-up">
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                            <div style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '0.8rem', borderRadius: '12px' }}>
                                <BookOpen size={24} />
                            </div>
                            <div>
                                <h3 style={{ margin: 0 }}>{a.title}</h3>
                                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Created: {new Date(a.created_at).toLocaleDateString()}</p>
                            </div>
                        </div>
                        <p>{a.description}</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                            <span style={{ fontWeight: 600 }}>Total Max: {a.total_max_marks} Marks</span>
                            <span className="badge">ID: {a.id}</span>
                        </div>
                    </div>
                ))}
                {assignments.length === 0 && !showCreate && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                        <BookOpen size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                        <p>No assignments defined yet. Create one to enable detailed question marking.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AssignmentManager;
