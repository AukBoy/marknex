import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Layers, BookOpen, CheckCircle, FileText, Edit3 } from 'lucide-react';
import { toImageIfPdf } from '../utils/pdf';
import api from '../api';
import { useOptions } from '../hooks/useOptions';

function EssayGrader() {
    const navigate = useNavigate();
    const { grades, subjects, exams } = useOptions();
    const [step, setStep] = useState(1);

    // Step 1 — Rubric definition
    const [mode, setMode] = useState('new'); // 'new' | 'existing' | 'upload'
    const [existingAssignments, setExistingAssignments] = useState([]);
    const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
    const [assignmentTitle, setAssignmentTitle] = useState('');
    const [description, setDescription] = useState('');
    const [questions, setQuestions] = useState([
        { q_num: 'Q1', max_marks: 10, rubric: '' }
    ]);
    const [savingRubric, setSavingRubric] = useState(false);

    // Upload marking scheme mode
    const [markingSchemeFile, setMarkingSchemeFile] = useState(null);
    const [extractingScheme, setExtractingScheme] = useState(false);
    const [extractedScheme, setExtractedScheme] = useState('');
    const [showExtractedPreview, setShowExtractedPreview] = useState(false);

    // Step 2 — Confirmed assignment
    const [assignmentId, setAssignmentId] = useState(null);
    const [confirmedQuestions, setConfirmedQuestions] = useState([]);
    const [totalMax, setTotalMax] = useState(0);

    // Step 3 — Bulk upload
    const [studentFiles, setStudentFiles] = useState(null);
    const [grade, setGrade] = useState('');
    const [exam, setExam] = useState('');
    const [subject, setSubject] = useState('');
    const [uploadingBulk, setUploadingBulk] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadResults, setUploadResults] = useState([]); // {name, status}

    useEffect(() => {
        api.get('/assignments').then(r => setExistingAssignments(r.data)).catch(() => {});
    }, []);

    // ── Step 1 helpers ──────────────────────────────────────────────
    const addQuestion = () => {
        const n = questions.length + 1;
        setQuestions([...questions, { q_num: `Q${n}`, max_marks: 5, rubric: '' }]);
    };

    const removeQuestion = (i) => setQuestions(questions.filter((_, idx) => idx !== i));

    const updateQuestion = (i, field, value) => {
        const updated = [...questions];
        updated[i][field] = field === 'max_marks' ? parseInt(value) || 0 : value;
        setQuestions(updated);
    };

    const handleSaveRubric = async () => {
        if (!assignmentTitle.trim()) return alert('Please enter an assignment title.');
        if (questions.some(q => !q.rubric.trim())) return alert('Please fill in the rubric for every question.');

        setSavingRubric(true);
        try {
            const res = await api.post('/assignments', {
                title: assignmentTitle,
                description: description || 'Bulk Essay Assignment',
                questions
            });
            const newId = res.data.id;
            setAssignmentId(newId);
            setConfirmedQuestions(questions);
            setTotalMax(questions.reduce((s, q) => s + q.max_marks, 0));
            setStep(2);
        } catch (err) {
            alert('Failed to save rubric: ' + (err.response?.data?.error || err.message));
        } finally {
            setSavingRubric(false);
        }
    };

    const handleSelectExisting = async () => {
        if (!selectedAssignmentId) return alert('Please select an assignment.');
        try {
            const res = await api.get(`/assignments/${selectedAssignmentId}`);
            const a = res.data;
            setAssignmentId(a.id);
            setConfirmedQuestions(a.questions || []);
            setTotalMax(a.total_max_marks || 0);
            setAssignmentTitle(a.title);
            setStep(2);
        } catch (err) {
            alert('Failed to load assignment.');
        }
    };

    const handleExtractScheme = async (e) => {
        e.preventDefault();
        if (!markingSchemeFile) return alert('Please select a marking scheme PDF.');
        setExtractingScheme(true);
        try {
            const formData = new FormData();
            formData.append('marking_scheme', markingSchemeFile);
            
            const res = await api.post('/essay/extract-scheme', formData);
            setExtractedScheme(res.data.extracted_scheme);
            setShowExtractedPreview(true);
        } catch (err) {
            alert('Failed to extract marking scheme. ' + (err.response?.data?.error || err.message));
        } finally {
            setExtractingScheme(false);
        }
    };

    const handleUseExtractedScheme = () => {
        // Parse the extracted scheme into questions
        // Expected format: "Q1 (10 marks): rubric text\nQ2 (5 marks): rubric text"
        const lines = extractedScheme.split('\n').filter(l => l.trim());
        const parsed = [];
        
        lines.forEach(line => {
            // Try to match: Q1 (10 marks): rubric OR Q1 - 10 marks: rubric
            const match = line.match(/^(Q\d+|Question\s*\d+)\s*[\(\-]\s*(\d+)\s*marks?\s*[\):]?\s*:?\s*(.+)$/i);
            if (match) {
                const qNum = match[1].replace(/Question\s*/i, 'Q');
                const marks = parseInt(match[2]);
                const rubric = match[3].trim();
                parsed.push({ q_num: qNum, max_marks: marks, rubric });
            }
        });

        if (parsed.length === 0) {
            // Fallback: use entire extracted text as single question rubric
            if (!assignmentTitle.trim()) setAssignmentTitle('Essay Assignment');
            setQuestions([{ q_num: 'Q1', max_marks: 10, rubric: extractedScheme }]);
        } else {
            setQuestions(parsed);
        }
        
        setShowExtractedPreview(false);
        setMode('new'); // Switch to manual mode so user can review/edit
    };

    // ── Step 3 ──────────────────────────────────────────────────────
    const handleBulkUpload = async (e) => {
        e.preventDefault();
        if (!studentFiles || studentFiles.length === 0) return alert('Please select student answer files.');
        if (!grade || !exam || !subject) return alert('Please fill in Grade, Subject, and Exam.');

        setUploadingBulk(true);
        setUploadProgress(0);
        setUploadResults([]);

        const results = [];
        for (let i = 0; i < studentFiles.length; i++) {
            const original = studentFiles[i];
            const sId = original.name.replace(/\.[^/.]+$/, '');
            try {
                const f = await toImageIfPdf(original); // PDFs → image so AI sees real layout
                const formData = new FormData();
                formData.append('student_id', sId);
                formData.append('grade', grade);
                formData.append('exam', exam);
                formData.append('subject', subject);
                formData.append('assignment_id', assignmentId);
                formData.append('script', f);
                await api.post('/scripts/upload', formData);
                results.push({ name: original.name, status: 'queued' });
            } catch (err) {
                results.push({ name: original.name, status: 'failed' });
            }
            setUploadProgress(Math.round(((i + 1) / studentFiles.length) * 100));
            setUploadResults([...results]);
        }

        setUploadingBulk(false);
        const failed = results.filter(r => r.status === 'failed').length;
        if (failed === 0) {
            alert(`All ${results.length} papers queued for AI grading!`);
            navigate('/dashboard');
        } else {
            alert(`${results.length - failed} papers queued. ${failed} failed — check the list below.`);
        }
    };

    // ── Stepper UI ──────────────────────────────────────────────────
    const steps = ['1. Define Rubric', '2. Verify', '3. Bulk Upload'];

    return (
        <div style={{ animation: 'fadeIn 0.5s ease', maxWidth: '860px', margin: '0 auto' }}>
            {/* Header */}
            <div className="dashboard-header" style={{ marginBottom: '2rem' }}>
                <button onClick={() => navigate('/dashboard')} className="btn btn-secondary"
                    style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </button>
                <h2 style={{ margin: 0, fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Edit3 size={32} color="var(--primary)" /> Bulk Essay Grader
                </h2>
                <p style={{ color: 'var(--text-muted)' }}>Define a marking rubric, then upload all student essays for AI grading.</p>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                {steps.map((label, idx) => (
                    <div key={idx} style={{
                        flex: 1, padding: '1rem', textAlign: 'center', fontWeight: 'bold',
                        borderRadius: '12px',
                        background: step > idx + 1 ? 'var(--success)' : step === idx + 1 ? 'var(--primary)' : 'var(--surface)',
                        color: step >= idx + 1 ? 'white' : 'var(--text-muted)',
                        border: step < idx + 1 ? '1px solid var(--border)' : 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                    }}>
                        {step > idx + 1 && <CheckCircle size={16} />}
                        {label}
                    </div>
                ))}
            </div>

            {/* ── STEP 1: Define Rubric ── */}
            {step === 1 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>Define Marking Rubric</h3>

                    {/* Mode toggle */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: '#f1f5f9', padding: '0.3rem', borderRadius: '10px', width: 'fit-content', flexWrap: 'wrap' }}>
                        {[
                            ['new', 'Create New Rubric'],
                            ['upload', 'Upload Marking Scheme PDF'],
                            ['existing', 'Use Existing Assignment']
                        ].map(([val, label]) => (
                            <button key={val} type="button" onClick={() => setMode(val)}
                                className="btn"
                                style={{
                                    padding: '0.5rem 1rem', fontSize: '0.85rem', border: 'none',
                                    background: mode === val ? 'var(--primary)' : 'transparent',
                                    color: mode === val ? 'white' : 'var(--text-muted)',
                                    boxShadow: mode === val ? '0 4px 6px rgba(0,0,0,0.1)' : 'none',
                                    whiteSpace: 'nowrap'
                                }}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {mode === 'existing' && (
                        <div>
                            <div className="form-group">
                                <label className="form-label">Select Assignment</label>
                                <select className="form-input" value={selectedAssignmentId}
                                    onChange={e => setSelectedAssignmentId(e.target.value)}>
                                    <option value="">-- Choose an assignment --</option>
                                    {existingAssignments.map(a => (
                                        <option key={a.id} value={a.id}>
                                            {a.title} ({a.total_max_marks} marks)
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button onClick={handleSelectExisting} className="btn btn-primary" style={{ width: '100%' }}>
                                <BookOpen size={18} /> Use This Assignment
                            </button>
                        </div>
                    )}

                    {mode === 'upload' && (
                        <div>
                            {!showExtractedPreview ? (
                                <form onSubmit={handleExtractScheme}>
                                    <div style={{
                                        background: 'linear-gradient(135deg, #ede9fe, #e0e7ff)',
                                        border: '2px dashed var(--primary)',
                                        borderRadius: '12px',
                                        padding: '2rem',
                                        textAlign: 'center',
                                        marginBottom: '1.5rem'
                                    }}>
                                        <FileText size={40} color="var(--primary)" style={{ marginBottom: '0.8rem', opacity: 0.8 }} />
                                        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                                            Upload your marking scheme PDF or image. The AI will extract all questions, marks, and rubric criteria automatically.
                                        </p>
                                        <input
                                            type="file"
                                            className="form-input"
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={e => setMarkingSchemeFile(e.target.files[0])}
                                            required
                                            style={{ maxWidth: '400px', margin: '0 auto' }}
                                        />
                                        {markingSchemeFile && (
                                            <p style={{ margin: '0.8rem 0 0 0', fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
                                                Selected: {markingSchemeFile.name}
                                            </p>
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Assignment Title</label>
                                        <input className="form-input" value={assignmentTitle}
                                            onChange={e => setAssignmentTitle(e.target.value)}
                                            placeholder="e.g., English Essay — Term 2" required />
                                    </div>
                                    <button type="submit" className="btn btn-primary"
                                        disabled={extractingScheme} style={{ width: '100%' }}>
                                        {extractingScheme ? (
                                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                                <span style={{ width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                                                Extracting Rubric with AI...
                                            </span>
                                        ) : (
                                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                                <FileText size={18} /> Extract Marking Scheme
                                            </span>
                                        )}
                                    </button>
                                </form>
                            ) : (
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--success)', fontWeight: 600 }}>
                                        <CheckCircle size={20} /> Marking scheme extracted successfully
                                    </div>
                                    <div style={{
                                        background: '#f8fafc', border: '1px solid var(--border)',
                                        borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem'
                                    }}>
                                        <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                                            Extracted Content — Review & Edit if Needed
                                        </label>
                                        <textarea
                                            className="form-input"
                                            rows={12}
                                            value={extractedScheme}
                                            onChange={e => setExtractedScheme(e.target.value)}
                                            style={{ fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical' }}
                                        />
                                        <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.5rem' }}>
                                            For best auto-parsing, format each question as: <code>Q1 (10 marks): rubric text</code>
                                        </small>
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <button type="button" onClick={() => setShowExtractedPreview(false)}
                                            className="btn btn-secondary" style={{ flex: 1 }}>
                                            ← Re-upload
                                        </button>
                                        <button type="button" onClick={handleUseExtractedScheme}
                                            className="btn btn-primary" style={{ flex: 2 }}>
                                            <CheckCircle size={18} /> Use This Rubric & Edit →
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {mode === 'new' && (
                        <div>
                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                <div className="form-group" style={{ flex: 2, minWidth: '200px' }}>
                                    <label className="form-label">Assignment Title</label>
                                    <input className="form-input" value={assignmentTitle}
                                        onChange={e => setAssignmentTitle(e.target.value)}
                                        placeholder="e.g., English Essay — Term 2" />
                                </div>
                                <div className="form-group" style={{ flex: 1, minWidth: '160px' }}>
                                    <label className="form-label">Description (optional)</label>
                                    <input className="form-input" value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="Brief description" />
                                </div>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <label className="form-label" style={{ margin: 0 }}>
                                        Questions & Rubrics
                                        <span style={{ marginLeft: '0.8rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                                            Total: {questions.reduce((s, q) => s + (q.max_marks || 0), 0)} marks
                                        </span>
                                    </label>
                                    <button type="button" onClick={addQuestion} className="btn btn-secondary"
                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <Plus size={15} /> Add Question
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {questions.map((q, i) => (
                                        <div key={i} style={{
                                            background: '#f8fafc', borderRadius: '12px',
                                            border: '1px solid var(--border)', padding: '1.2rem'
                                        }}>
                                            <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '0.8rem', alignItems: 'center' }}>
                                                <input
                                                    className="form-input"
                                                    style={{ width: '80px', fontWeight: 700, textAlign: 'center' }}
                                                    value={q.q_num}
                                                    onChange={e => updateQuestion(i, 'q_num', e.target.value)}
                                                    placeholder="Q1"
                                                />
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        style={{ width: '80px', textAlign: 'center' }}
                                                        value={q.max_marks}
                                                        min="1"
                                                        onChange={e => updateQuestion(i, 'max_marks', e.target.value)}
                                                    />
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>marks</span>
                                                </div>
                                                {questions.length > 1 && (
                                                    <button type="button" onClick={() => removeQuestion(i)}
                                                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.3rem' }}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                            <textarea
                                                className="form-input"
                                                rows={3}
                                                value={q.rubric}
                                                onChange={e => updateQuestion(i, 'rubric', e.target.value)}
                                                placeholder={`Marking rubric for ${q.q_num} — describe what earns full marks, partial marks, and common mistakes...`}
                                                style={{ resize: 'vertical', fontFamily: 'inherit' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleSaveRubric}
                                className="btn btn-primary"
                                disabled={savingRubric}
                                style={{ width: '100%', marginTop: '1.5rem' }}>
                                {savingRubric ? 'Saving...' : 'Save Rubric & Continue →'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── STEP 2: Verify Rubric ── */}
            {step === 2 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>Verify Marking Rubric</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                        Review the rubric below. The AI will use this to grade every student essay.
                    </p>

                    <div style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h4 style={{ margin: 0, color: 'var(--primary)' }}>{assignmentTitle}</h4>
                            <span style={{ background: 'var(--primary)', color: 'white', padding: '0.3rem 0.8rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700 }}>
                                {totalMax} marks total
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                            {confirmedQuestions.map((q, i) => (
                                <div key={i} style={{
                                    background: 'white', borderRadius: '8px',
                                    border: '1px solid var(--border)', padding: '1rem'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <strong style={{ color: 'var(--text-main)' }}>{q.q_num}</strong>
                                        <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '0.9rem' }}>{q.max_marks} marks</span>
                                    </div>
                                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                        {q.rubric}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button onClick={() => setStep(1)} className="btn btn-secondary" style={{ flex: 1 }}>
                            ← Edit Rubric
                        </button>
                        <button onClick={() => setStep(3)} className="btn btn-primary" style={{ flex: 2 }}>
                            Confirm & Proceed to Upload →
                        </button>
                    </div>
                </div>
            )}

            {/* ── STEP 3: Bulk Upload ── */}
            {step === 3 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>Upload Student Essay Papers</h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                        Select all student files. Each filename will be used as the Student ID.
                        The AI will grade each paper against the rubric for <strong>{assignmentTitle}</strong> ({totalMax} marks).
                    </p>

                    <form onSubmit={handleBulkUpload}>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                            <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                                <label className="form-label">Grade</label>
                                <select className="form-input" value={grade} onChange={e => setGrade(e.target.value)} required>
                                    <option value="" disabled>Select...</option>
                                    {grades.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                            </div>
                            <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                                <label className="form-label">Subject</label>
                                <select className="form-input" value={subject} onChange={e => setSubject(e.target.value)} required>
                                    <option value="" disabled>Select...</option>
                                    {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                                <label className="form-label">Exam</label>
                                <select className="form-input" value={exam} onChange={e => setExam(e.target.value)} required>
                                    <option value="" disabled>Select...</option>
                                    {exams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Student Essay Files (PDF, JPG, PNG)</label>
                            <input
                                type="file"
                                className="form-input"
                                accept=".pdf,.jpg,.jpeg,.png"
                                multiple
                                onChange={e => setStudentFiles(e.target.files)}
                                required
                            />
                            <small style={{ color: 'var(--text-muted)' }}>
                                Select multiple files at once. Filenames will be used as Student IDs.
                            </small>
                        </div>

                        {/* Progress bar */}
                        {uploadingBulk && (
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Uploading & Queuing for AI...</span>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)' }}>{uploadProgress}%</span>
                                </div>
                                <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--primary)', transition: 'width 0.3s ease' }} />
                                </div>
                            </div>
                        )}

                        {/* Per-file results */}
                        {uploadResults.length > 0 && (
                            <div style={{ marginBottom: '1rem', maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
                                {uploadResults.map((r, i) => (
                                    <div key={i} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '0.5rem 0.8rem',
                                        borderBottom: i < uploadResults.length - 1 ? '1px solid var(--border)' : 'none',
                                        fontSize: '0.85rem'
                                    }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <FileText size={14} color="var(--text-muted)" /> {r.name}
                                        </span>
                                        <span style={{
                                            padding: '0.15rem 0.6rem', borderRadius: '12px', fontWeight: 600, fontSize: '0.8rem',
                                            background: r.status === 'queued' ? '#dcfce7' : '#fee2e2',
                                            color: r.status === 'queued' ? '#166534' : '#991b1b'
                                        }}>
                                            {r.status === 'queued' ? '✓ Queued' : '✗ Failed'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={() => setStep(2)} className="btn btn-secondary" style={{ flex: 1 }} disabled={uploadingBulk}>
                                ← Back
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={uploadingBulk} style={{ flex: 3 }}>
                                <Layers size={20} />
                                {uploadingBulk
                                    ? `Uploading ${uploadProgress}%...`
                                    : `Grade ${studentFiles ? studentFiles.length : 0} Essay Papers`}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

export default EssayGrader;
