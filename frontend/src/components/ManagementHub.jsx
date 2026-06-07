import React, { useState, useEffect, useRef } from 'react';
import {
    Plus, Trash2, Users, BookOpen, Calendar,
    Download, Upload, Brain, ChevronDown, ChevronUp,
    FileText, Loader, CheckCircle, Database, Zap,
    Key, Lock, UserCheck, X
} from 'lucide-react';
import api, { API_BASE } from '../api';
import { showToast } from '../hooks/useToast';
import { parseCSV, downloadStudentTemplate, exportStudentsCSV } from '../utils/csv';
import './ManagementHub.css';

// ─────────────────────────────────────────────────────────────────
// ManagementHub — three top-level sections:
//   1. Classes & Roster   (classes → students → exams)
//   2. Textbooks          (upload curriculum → AI extracts knowledge)
//   3. Fine-tuning Data   (export reviewed scripts as JSONL)
// ─────────────────────────────────────────────────────────────────

function ManagementHub() {
    const [section, setSection] = useState('classes');   // 'classes' | 'textbooks' | 'finetune'

    return (
        <div className="management-hub" style={{ animation: 'fadeIn 0.5s ease' }}>
            <div className="hub-header">
                <h2>Manage Everything</h2>
                <p>Classes, textbooks, and AI training data in one place</p>
            </div>

            {/* Top-level section switcher */}
            <div style={{ padding: '0 2rem' }}>
                <div className="hub-section-tabs">
                    <button
                        className={`hub-section-btn ${section === 'classes' ? 'active' : ''}`}
                        onClick={() => setSection('classes')}
                    >
                        <Users size={16} /> Classes &amp; Roster
                    </button>
                    <button
                        className={`hub-section-btn ${section === 'textbooks' ? 'active' : ''}`}
                        onClick={() => setSection('textbooks')}
                    >
                        <Brain size={16} /> Textbooks &amp; Curriculum
                    </button>
                    <button
                        className={`hub-section-btn ${section === 'finetune' ? 'active' : ''}`}
                        onClick={() => setSection('finetune')}
                    >
                        <Zap size={16} /> Fine-tuning Data
                    </button>
                </div>
            </div>

            {section === 'classes'   && <ClassesSection />}
            {section === 'textbooks' && <TextbooksSection />}
            {section === 'finetune'  && <FineTuningSection />}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// SECTION 1 — Classes & Roster
// ═══════════════════════════════════════════════════════════════
function ClassesSection() {
    const [classes, setClasses]           = useState([]);
    const [selectedClass, setSelectedClass] = useState(null);
    const [students, setStudents]         = useState([]);
    const [exams, setExams]               = useState([]);
    const [assignments, setAssignments]   = useState([]);
    const [loading, setLoading]           = useState(false);
    const [activeTab, setActiveTab]       = useState('students');
    const [classForm, setClassForm]       = useState({ name: '', grade: '', subject: '' });
    const [studentForm, setStudentForm]   = useState({ student_id: '', name: '', email: '', username: '', password: '' });
    const [credEditId, setCredEditId]     = useState(null);
    const [credForm, setCredForm]         = useState({ username: '', password: '' });
    const [examForm, setExamForm]         = useState({ title: '', description: '', exam_date: '' });

    useEffect(() => { fetchClasses(); fetchAssignments(); }, []);

    const fetchClasses = async () => {
        try {
            const res = await api.get('/classes');
            setClasses(res.data);
            if (res.data.length && !selectedClass) {
                setSelectedClass(res.data[0]);
                fetchStudents(res.data[0].id);
                fetchExams(res.data[0].id);
            }
        } catch (err) { console.error(err); }
    };
    const fetchStudents = async (id) => {
        try { const r = await api.get(`/classes/${id}/students`); setStudents(r.data); } catch {}
    };
    const fetchExams = async (id) => {
        try { const r = await api.get(`/classes/${id}/exams`); setExams(r.data); } catch {}
    };
    const fetchAssignments = async () => {
        try { const r = await api.get('/assignments'); setAssignments(r.data); } catch {}
    };
    const handleSelectClass = (cls) => {
        setSelectedClass(cls);
        fetchStudents(cls.id);
        fetchExams(cls.id);
    };
    const addClass = async () => {
        if (!classForm.name.trim()) return showToast.error('Class name required');
        setLoading(true);
        try {
            await api.post('/classes', classForm);
            setClassForm({ name: '', grade: '', subject: '' });
            showToast.success('Class added');
            fetchClasses();
        } catch (err) { showToast.error(err.response?.data?.error || 'Failed to add class'); }
        finally { setLoading(false); }
    };
    const deleteClass = async (id) => {
        if (!window.confirm('Delete this class and all its data?')) return;
        try { await api.delete(`/classes/${id}`); fetchClasses(); showToast.success('Class deleted'); }
        catch { showToast.error('Failed to delete class'); }
    };
    const addStudent = async () => {
        if (!studentForm.student_id.trim()) return showToast.error('Student ID required');
        if (!selectedClass) return showToast.error('Select a class first');
        if (studentForm.username.trim() && !studentForm.password.trim())
            return showToast.error('Enter a password for the login account');
        setLoading(true);
        try {
            await api.post(`/classes/${selectedClass.id}/students`, studentForm);
            setStudentForm({ student_id: '', name: '', email: '', username: '', password: '' });
            fetchStudents(selectedClass.id);
            showToast.success(studentForm.username.trim() ? 'Student + login account created' : 'Student added');
        } catch (err) { showToast.error(err.response?.data?.error || 'Failed'); }
        finally { setLoading(false); }
    };
    const deleteStudent = async (id) => {
        try { await api.delete(`/students/${id}`); fetchStudents(selectedClass.id); }
        catch { showToast.error('Failed to delete student'); }
    };
    const openCredEditor = (s) => {
        setCredEditId(s.id);
        setCredForm({ username: s.username || '', password: '' });
    };
    const saveCredentials = async (id) => {
        if (!credForm.username.trim()) return showToast.error('Username required');
        try {
            await api.put(`/students/${id}/credentials`, credForm);
            setCredEditId(null);
            fetchStudents(selectedClass.id);
            showToast.success('Login account saved');
        } catch (err) { showToast.error(err.response?.data?.error || 'Failed'); }
    };
    const addExam = async () => {
        if (!examForm.title.trim()) return showToast.error('Exam title required');
        if (!selectedClass) return showToast.error('Select a class first');
        setLoading(true);
        try {
            await api.post(`/classes/${selectedClass.id}/exams`, examForm);
            setExamForm({ title: '', description: '', exam_date: '' });
            fetchExams(selectedClass.id);
            showToast.success('Exam added');
        } catch (err) { showToast.error(err.response?.data?.error || 'Failed'); }
        finally { setLoading(false); }
    };
    const deleteExam = async (id) => {
        try { await api.delete(`/exams/${id}`); fetchExams(selectedClass.id); }
        catch { showToast.error('Failed to delete exam'); }
    };
    const handleImportStudents = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !selectedClass) return;
        try {
            const { rows } = await parseCSV(file);
            let n = 0;
            for (const row of rows) {
                if (!row.student_id) continue;
                try { await api.post(`/classes/${selectedClass.id}/students`, { student_id: row.student_id, name: row.name || '', email: row.email || '' }); n++; }
                catch (err) { if (err.response?.status !== 409) console.error(err); }
            }
            showToast.success(`Imported ${n} student(s)`);
            fetchStudents(selectedClass.id);
            e.target.value = '';
        } catch (err) { showToast.error('CSV import failed: ' + err.message); }
    };

    return (
        <div className="hub-layout">
            {/* Sidebar */}
            <div className="hub-sidebar">
                <div className="sidebar-section">
                    <h3>Classes</h3>
                    <div className="class-list">
                        {classes.map(cls => (
                            <div key={cls.id} className={`class-item ${selectedClass?.id === cls.id ? 'active' : ''}`} onClick={() => handleSelectClass(cls)}>
                                <div className="class-info">
                                    <strong>{cls.name}</strong>
                                    <small>{cls.grade} • {cls.subject}</small>
                                </div>
                                <button onClick={e => { e.stopPropagation(); deleteClass(cls.id); }} className="btn-icon" title="Delete"><Trash2 size={14} /></button>
                            </div>
                        ))}
                        {classes.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No classes yet</p>}
                    </div>
                    <div className="form-compact" style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                        <input className="form-input" placeholder="Class name" value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                        <input className="form-input" placeholder="Grade (e.g. Grade 10)" value={classForm.grade} onChange={e => setClassForm({ ...classForm, grade: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                        <input className="form-input" placeholder="Subject (e.g. ICT)" value={classForm.subject} onChange={e => setClassForm({ ...classForm, subject: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                        <button onClick={addClass} disabled={loading} className="btn btn-primary" style={{ width: '100%' }}><Plus size={16} /> Add Class</button>
                    </div>
                </div>
            </div>

            {/* Main */}
            <div className="hub-main">
                {selectedClass ? (
                    <>
                        <div className="hub-class-header">
                            <h3>{selectedClass.name}</h3>
                            <small>{selectedClass.grade} • {selectedClass.subject}</small>
                        </div>
                        <div className="hub-tabs">
                            <div className="tab-buttons">
                                {[['students', <Users size={16} />, `Students (${students.length})`],
                                  ['exams',    <Calendar size={16} />, `Exams (${exams.length})`],
                                  ['assignments', <BookOpen size={16} />, `Assignments (${assignments.length})`]
                                ].map(([id, icon, label]) => (
                                    <button key={id} className={`tab-btn ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
                                        {icon} {label}
                                    </button>
                                ))}
                            </div>

                            {activeTab === 'students' && (
                                <div className="tab-content">
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <button onClick={downloadStudentTemplate} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}><Download size={14} /> Template</button>
                                        <label style={{ cursor: 'pointer' }}>
                                            <input type="file" accept=".csv" onChange={handleImportStudents} style={{ display: 'none' }} />
                                            <div className="btn btn-secondary" style={{ fontSize: '0.85rem' }}><Upload size={14} /> Import CSV</div>
                                        </label>
                                        {students.length > 0 && (
                                            <button onClick={() => { exportStudentsCSV(students, selectedClass.name); showToast.success('Roster exported'); }} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}><Download size={14} /> Export</button>
                                        )}
                                    </div>
                                    <div className="list-section">
                                        {students.map(s => (
                                            <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '0.5rem', overflow: 'hidden' }}>
                                                <div className="list-item" style={{ border: 'none', borderRadius: 0, marginBottom: 0 }}>
                                                    <div>
                                                        <strong>{s.name || s.student_id}</strong>
                                                        <small>
                                                            {s.student_id}{s.email && ` • ${s.email}`}
                                                            {s.username
                                                                ? <span style={{ color: '#10b981', marginLeft: '0.5rem', fontWeight: 600 }}><UserCheck size={11} style={{ verticalAlign: 'middle' }} /> @{s.username}</span>
                                                                : <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>• no login</span>}
                                                        </small>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                        <button onClick={() => openCredEditor(s)} className="btn-icon" title={s.username ? 'Edit login' : 'Create login account'} style={{ color: s.username ? '#10b981' : 'var(--primary)' }}>
                                                            <Key size={14} />
                                                        </button>
                                                        <button onClick={() => deleteStudent(s.id)} className="btn-icon"><Trash2 size={14} /></button>
                                                    </div>
                                                </div>
                                                {credEditId === s.id && (
                                                    <div style={{ padding: '0.75rem', background: 'rgba(79,70,229,0.05)', borderTop: '1px solid var(--border)' }}>
                                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                            <Lock size={12} /> {s.username ? 'Update' : 'Create'} login account
                                                        </div>
                                                        <input className="form-input" placeholder="Username" value={credForm.username} onChange={e => setCredForm({ ...credForm, username: e.target.value })} style={{ marginBottom: '0.4rem' }} />
                                                        <input className="form-input" type="password" placeholder={s.username ? 'New password (leave blank to keep)' : 'Password'} value={credForm.password} onChange={e => setCredForm({ ...credForm, password: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                            <button onClick={() => saveCredentials(s.id)} className="btn btn-primary" style={{ flex: 1, fontSize: '0.83rem' }}><CheckCircle size={14} /> Save</button>
                                                            <button onClick={() => setCredEditId(null)} className="btn btn-secondary" style={{ fontSize: '0.83rem' }}><X size={14} /></button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {students.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No students in this class</p>}
                                    </div>
                                    <div className="form-compact" style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                                        <input className="form-input" placeholder="Student ID *" value={studentForm.student_id} onChange={e => setStudentForm({ ...studentForm, student_id: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                        <input className="form-input" placeholder="Name" value={studentForm.name} onChange={e => setStudentForm({ ...studentForm, name: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                        <input className="form-input" placeholder="Email (optional)" value={studentForm.email} onChange={e => setStudentForm({ ...studentForm, email: e.target.value })} style={{ marginBottom: '0.75rem' }} />
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <Key size={12} /> Student login account (optional)
                                        </div>
                                        <input className="form-input" placeholder="Username" value={studentForm.username} onChange={e => setStudentForm({ ...studentForm, username: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                        <input className="form-input" type="password" placeholder="Password" value={studentForm.password} onChange={e => setStudentForm({ ...studentForm, password: e.target.value })} style={{ marginBottom: '0.75rem' }} />
                                        <button onClick={addStudent} disabled={loading} className="btn btn-primary" style={{ width: '100%' }}><Plus size={16} /> Add Student</button>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'exams' && (
                                <div className="tab-content">
                                    <div className="list-section">
                                        {exams.map(ex => (
                                            <div key={ex.id} className="list-item">
                                                <div>
                                                    <strong>{ex.title}</strong>
                                                    <small>{ex.description || '—'}</small>
                                                    {ex.exam_date && <small>📅 {new Date(ex.exam_date).toLocaleDateString()}</small>}
                                                </div>
                                                <button onClick={() => deleteExam(ex.id)} className="btn-icon"><Trash2 size={14} /></button>
                                            </div>
                                        ))}
                                        {exams.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No exams yet</p>}
                                    </div>
                                    <div className="form-compact" style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                                        <input className="form-input" placeholder="Exam title" value={examForm.title} onChange={e => setExamForm({ ...examForm, title: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                        <input className="form-input" placeholder="Description" value={examForm.description} onChange={e => setExamForm({ ...examForm, description: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                        <input className="form-input" type="date" value={examForm.exam_date} onChange={e => setExamForm({ ...examForm, exam_date: e.target.value })} style={{ marginBottom: '0.5rem' }} />
                                        <button onClick={addExam} disabled={loading} className="btn btn-primary" style={{ width: '100%' }}><Plus size={16} /> Add Exam</button>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'assignments' && (
                                <div className="tab-content">
                                    <div className="list-section">
                                        {assignments.map(a => (
                                            <div key={a.id} className="list-item">
                                                <div><strong>{a.title}</strong><small>{a.description || '—'} • {a.total_max_marks}M</small></div>
                                            </div>
                                        ))}
                                        {assignments.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No assignments yet</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>
                        Create or select a class to manage students, exams, and assignments.
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2 — Textbooks & Curriculum
// ═══════════════════════════════════════════════════════════════
function TextbooksSection() {
    const [classes, setClasses]           = useState([]);
    // Grades & subjects come ONLY from the teacher's added classes.
    const grades   = [...new Set(classes.map(c => c.grade).filter(Boolean))];
    const subjects = [...new Set(classes.map(c => c.subject).filter(Boolean))];
    const [contexts, setContexts]         = useState([]);
    const [uploading, setUploading]       = useState(false);
    const [expanded, setExpanded]         = useState(null);
    const [form, setForm]                 = useState({ grade: '', subject: '', label: '', language: 'English' });
    const [errors, setErrors]             = useState({});
    const [file, setFile]                 = useState(null);
    const [progressStep, setProgressStep] = useState(0);   // 0=idle 1=upload 2=extract 3=analyse 4=save
    const [liveLog, setLiveLog]           = useState([]);  // real-time SSE messages
    const fileRef                         = useRef();
    const logEndRef                       = useRef();

    // Auto-scroll live log
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [liveLog]);

    // Progress step labels
    const STEPS = [
        '',
        '📤 Uploading file…',
        '📖 Reading all pages…',
        '🧠 Analysing curriculum…',
        '💾 Saving…',
    ];

    useEffect(() => { fetchContexts(); fetchClasses(); }, []);

    const fetchClasses = async () => {
        try { const r = await api.get('/classes'); setClasses(r.data); }
        catch { console.error('Failed to load classes'); }
    };

    const fetchContexts = async () => {
        try { const r = await api.get('/subject-context'); setContexts(r.data); }
        catch { console.error('Failed to load contexts'); }
    };

    const validate = () => {
        const e = {};
        if (!form.grade.trim())   e.grade   = 'Grade is required';
        if (!form.subject.trim()) e.subject = 'Subject is required';
        if (!file)                e.file    = 'Please select a textbook file';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleUpload = async () => {
        if (!validate()) return;

        setUploading(true);
        setProgressStep(1);

        const data = new FormData();
        data.append('file', file);
        data.append('grade', form.grade.trim());
        data.append('subject', form.subject.trim());
        data.append('label', form.label.trim() || `${form.grade.trim()} ${form.subject.trim()}`);
        data.append('language', form.language || 'English');

        try {
            // 1. Start the job — server responds immediately with a jobId
            const res = await api.post('/subject-context', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000,
            });

            const { jobId } = res.data;
            if (!jobId) throw new Error('No jobId returned from server');

            // 2. Connect to the SSE progress stream. We use fetch + ReadableStream
            // (not EventSource) so we can send the Authorization header. The URL
            // MUST be absolute to the backend — a relative path would hit the
            // static frontend server instead.
            const token = localStorage.getItem('token');
            const sseRes = await fetch(`${API_BASE}/api/subject-context/progress/${jobId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!sseRes.ok || !sseRes.body) throw new Error('Could not connect to progress stream');

            const reader = sseRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finished = false;

            while (!finished) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let event;
                    try { event = JSON.parse(line.slice(6)); }
                    catch { continue; } // skip malformed line only

                    if (event.type === 'progress') {
                        const msg = event.message || '';
                        if (msg.includes('Reading PDF') || msg.includes('Reading image')) setProgressStep(2);
                        else if (msg.includes('Analysing') || msg.includes('Extracted')) setProgressStep(3);
                        else if (msg.includes('Saving') || msg.includes('Merged') || msg.includes('Found')) setProgressStep(4);
                        setLiveLog(prev => [...prev.slice(-20), msg]);
                    } else if (event.type === 'done') {
                        showToast.success(`✅ ${event.result?.message || 'Curriculum saved!'}`);
                        setForm({ grade: '', subject: '', label: '', language: 'English' });
                        setErrors({});
                        setFile(null);
                        if (fileRef.current) fileRef.current.value = '';
                        setLiveLog([]);
                        fetchContexts();
                        finished = true;
                        break;
                    } else if (event.type === 'error') {
                        throw new Error(event.message || 'Processing failed');
                    }
                }
            }
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Upload failed';
            showToast.error(msg);
            setErrors({ file: msg });
        } finally {
            setUploading(false);
            setProgressStep(0);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Remove this curriculum context?')) return;
        try {
            await api.delete(`/subject-context/${id}`);
            showToast.success('Curriculum removed');
            fetchContexts();
        } catch { showToast.error('Failed to delete'); }
    };

    return (
        <div style={{ padding: '0 2rem 2rem', maxWidth: 900 }}>

            {/* How it works banner */}
            <div className="info-banner">
                <Brain size={20} style={{ flexShrink: 0 }} />
                <div>
                    <strong>How it works</strong>
                    <p>
                        Upload any textbook, syllabus, or notebook (PDF or image).
                        The AI reads every page, extracts all topics and key knowledge,
                        and stores it. When you mark a student paper for the same
                        <strong> Grade + Subject</strong>, the AI automatically uses
                        that curriculum — so grading is aligned to your exact syllabus.
                    </p>
                </div>
            </div>

            {/* Upload form */}
            <div className="tb-upload-card">
                <h3 style={{ margin: '0 0 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Upload size={18} /> Upload a Textbook
                </h3>

                <div className="tb-form-grid">
                    <div className="tb-form-field">
                        <label>Grade <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <select
                            className={`form-input${errors.grade ? ' input-error' : ''}`}
                            value={form.grade}
                            onChange={e => { setForm({ ...form, grade: e.target.value }); setErrors(p => ({ ...p, grade: '' })); }}
                            disabled={uploading}
                        >
                            <option value="">— Select grade —</option>
                            {grades.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        {errors.grade && <span className="field-error">{errors.grade}</span>}
                    </div>
                    <div className="tb-form-field">
                        <label>Subject <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <select
                            className={`form-input${errors.subject ? ' input-error' : ''}`}
                            value={form.subject}
                            onChange={e => { setForm({ ...form, subject: e.target.value }); setErrors(p => ({ ...p, subject: '' })); }}
                            disabled={uploading}
                        >
                            <option value="">— Select subject —</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {errors.subject && <span className="field-error">{errors.subject}</span>}
                    </div>
                    <div className="tb-form-field">
                        <label>Label (optional)</label>
                        <input
                            className="form-input"
                            placeholder="e.g. Grade 6 ICT Term 1"
                            value={form.label}
                            onChange={e => setForm({ ...form, label: e.target.value })}
                            disabled={uploading}
                        />
                    </div>
                    <div className="tb-form-field">
                        <label>Textbook Language</label>
                        <select
                            className="form-input"
                            value={form.language}
                            onChange={e => setForm({ ...form, language: e.target.value })}
                            disabled={uploading}
                        >
                            <option value="English">English</option>
                            <option value="Sinhala">සිංහල (Sinhala)</option>
                            <option value="Tamil">தமிழ் (Tamil)</option>
                        </select>
                    </div>
                </div>

                <div
                    className={`tb-file-zone${errors.file && !file ? ' file-zone-error' : ''}`}
                    onClick={() => !uploading && fileRef.current?.click()}
                >
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff,.bmp"
                        style={{ display: 'none' }}
                        onChange={e => { setFile(e.target.files?.[0] || null); setErrors(p => ({ ...p, file: '' })); }}
                        disabled={uploading}
                    />
                    {file ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <FileText size={24} style={{ color: 'var(--primary)' }} />
                            <div>
                                <strong style={{ color: 'var(--text-main)' }}>{file.name}</strong>
                                <small style={{ color: 'var(--text-muted)' }}>
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                    {file.size > 10 * 1024 * 1024 && <span style={{ color: '#f59e0b', marginLeft: '0.5rem' }}>⚠ Large file — analysis may take 1–2 min</span>}
                                </small>
                            </div>
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center' }}>
                            <Upload size={32} style={{ color: errors.file ? 'var(--danger)' : 'var(--text-muted)', marginBottom: '0.5rem' }} />
                            <p style={{ color: errors.file ? 'var(--danger)' : 'var(--text-muted)', margin: 0 }}>
                                {errors.file ? errors.file : <>Click to select a textbook or notebook<br /><small>PDF, PNG, JPG, WEBP, TIFF, BMP</small></>}
                            </p>
                        </div>
                    )}
                </div>

                {/* Progress during upload */}
                {uploading && (
                    <div className="tb-progress-steps">
                        {/* Step indicators */}
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            {STEPS.slice(1).map((msg, i) => {
                                const step    = i + 1;
                                const done    = progressStep > step;
                                const current = progressStep === step;
                                return (
                                    <div key={step} className={`tb-progress-step ${done ? 'done' : current ? 'active' : 'pending'}`}>
                                        <div className="tb-step-dot">
                                            {done ? <CheckCircle size={12} /> : current ? <Loader size={12} className="spin" /> : <span>{step}</span>}
                                        </div>
                                        <span>{msg}</span>
                                    </div>
                                );
                            })}
                        </div>
                        {/* Live log */}
                        {liveLog.length > 0 && (
                            <div className="tb-live-log">
                                {liveLog.map((msg, i) => (
                                    <div key={i} className={`tb-log-line ${i === liveLog.length - 1 ? 'latest' : ''}`}>
                                        {msg}
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        )}
                    </div>
                )}

                <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="btn btn-primary"
                    style={{ marginTop: '1rem', width: '100%', padding: '0.75rem' }}
                >
                    {uploading
                        ? <><Loader size={16} className="spin" /> Analyzing… please wait</>
                        : <><Brain size={16} /> Analyze &amp; Save Curriculum</>}
                </button>
            </div>

            {/* Saved curricula */}
            <h3 style={{ margin: '2rem 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Database size={18} /> Saved Curricula
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 400 }}>— automatically used when grading</span>
            </h3>

            {contexts.length === 0 && (
                <div style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 12 }}>
                    No curricula uploaded yet. Upload a textbook above to get started.
                </div>
            )}

            <div className="tb-context-list">
                {contexts.map(ctx => (
                    <div key={ctx.id} className="tb-context-card">
                        <div className="tb-context-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                                <div className="tb-badge grade">{ctx.grade}</div>
                                <div className="tb-badge subject">{ctx.subject}</div>
                                <div style={{ minWidth: 0 }}>
                                    <strong style={{ color: 'var(--text-main)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ctx.label}
                                    </strong>
                                    <small style={{ color: 'var(--text-muted)' }}>
                                        {ctx.filename} • {ctx.topics?.length || 0} topics extracted
                                    </small>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                                <span className="tb-badge active"><CheckCircle size={12} /> Active</span>
                                <button
                                    className="btn-icon"
                                    onClick={() => setExpanded(expanded === ctx.id ? null : ctx.id)}
                                    title="Show topics"
                                >
                                    {expanded === ctx.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                                <button className="btn-icon" onClick={() => handleDelete(ctx.id)} title="Remove"><Trash2 size={16} /></button>
                            </div>
                        </div>

                        {expanded === ctx.id && ctx.topics?.length > 0 && (
                            <div className="tb-topics">
                                <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Extracted Topics
                                </p>
                                <div className="tb-topic-grid">
                                    {ctx.topics.map((t, i) => (
                                        <div key={i} className="tb-topic-item">
                                            <strong>{t.name}</strong>
                                            {t.outcomes?.length > 0 && (
                                                <ul>{t.outcomes.slice(0, 3).map((o, j) => <li key={j}>{o}</li>)}</ul>
                                            )}
                                            {t.keywords?.length > 0 && (
                                                <div className="tb-keywords">
                                                    {t.keywords.slice(0, 6).map((k, j) => <span key={j} className="tb-keyword">{k}</span>)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3 — Fine-tuning Data
// ═══════════════════════════════════════════════════════════════
function FineTuningSection() {
    const [downloading, setDownloading] = useState(false);

    const handleExport = async () => {
        setDownloading(true);
        try {
            const res = await api.get('/fine-tuning/export', { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `marknex_finetune_${Date.now()}.jsonl`;
            a.click();
            URL.revokeObjectURL(url);
            showToast.success('Fine-tuning data exported');
        } catch (err) {
            const text = await err.response?.data?.text?.();
            let msg = 'Export failed';
            try { msg = JSON.parse(text || '{}').error || msg; } catch {}
            showToast.error(msg);
        } finally { setDownloading(false); }
    };

    return (
        <div style={{ padding: '0 2rem 2rem', maxWidth: 800 }}>
            <div className="info-banner" style={{ '--banner-color': '#f59e0b' }}>
                <Zap size={20} style={{ flexShrink: 0, color: '#f59e0b' }} />
                <div>
                    <strong>What is fine-tuning?</strong>
                    <p>
                        Fine-tuning teaches the AI to grade exactly the way <em>you</em> grade.
                        The more student scripts your teachers review and correct,
                        the better the AI learns your school's standards.
                    </p>
                </div>
            </div>

            <div className="ft-steps">
                {[
                    { n: 1, title: 'Grade scripts with AI', desc: 'Upload student answer papers — the AI grades them automatically.' },
                    { n: 2, title: 'Teachers review & correct', desc: 'Open any "Needs Review" script and adjust the marks if the AI got it wrong.' },
                    { n: 3, title: 'Export training data', desc: 'Click below to download a JSONL file of all reviewed scripts — ready for OpenAI fine-tuning.' },
                    { n: 4, title: 'Submit to OpenAI', desc: 'Run: openai api fine_tuning.jobs.create -m gpt-4o -f training_data.jsonl' },
                    { n: 5, title: 'Set your model ID', desc: 'Add FINE_TUNED_MODEL_ID=your-model-id to backend/.env and restart the server.' },
                ].map(step => (
                    <div key={step.n} className="ft-step">
                        <div className="ft-step-num">{step.n}</div>
                        <div>
                            <strong>{step.title}</strong>
                            <p>{step.desc}</p>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={handleExport}
                disabled={downloading}
                className="btn btn-primary"
                style={{ padding: '0.85rem 2rem', fontSize: '1rem', marginTop: '1.5rem' }}
            >
                {downloading
                    ? <><Loader size={16} className="spin" /> Preparing export...</>
                    : <><Download size={16} /> Download Training Data (.jsonl)</>}
            </button>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                Only scripts that teachers have reviewed and corrected are included.
                Aim for 50+ examples before fine-tuning.
            </p>
        </div>
    );
}

export default ManagementHub;
