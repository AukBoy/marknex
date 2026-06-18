import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UploadCloud, CheckCircle, AlertTriangle, FileText, Trash2, RefreshCcw, ArrowUpDown, Download, BookOpen, Lock, ChevronDown, ChevronRight, LayoutGrid, List, Eye } from 'lucide-react';
import { toImagesIfPdf } from '../utils/pdf';
import api from '../api';
import { useOptions } from '../hooks/useOptions';
import SearchBar from './SearchBar';
import { showToast } from '../hooks/useToast';
import { exportGradesCSV } from '../utils/csv';

function Dashboard() {
    const { grades, subjects, exams } = useOptions();
    const [scripts, setScripts] = useState([]);
    const [files, setFiles] = useState(null);
    const [studentId, setStudentId] = useState('');
    const [grade, setGrade] = useState('');
    const [exam, setExam] = useState('');
    const [subject, setSubject] = useState('');
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState('active');
    const [filterGrade, setFilterGrade] = useState('All');
    const [filterExam, setFilterExam] = useState('All');
    const [filterSubject, setFilterSubject] = useState('All');
    const [assignments, setAssignments] = useState([]);
    const [assignmentId, setAssignmentId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('date');
    const [filterStatus, setFilterStatus] = useState('All');
    const [minConfidence, setMinConfidence] = useState(0);
    const [displayMode, setDisplayMode] = useState('table');   // 'table' | 'cards'
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const navigate = useNavigate();

    // Textbook context selector
    const [allContexts, setAllContexts]     = useState([]);   // all saved textbooks
    const [contextId, setContextId]         = useState('');   // selected context ID
    const [textbookStrict, setTextbookStrict] = useState(false); // grade ONLY within textbook

    // Class + student roster selectors (pick from added students instead of typing)
    const [classes, setClasses]             = useState([]);
    const [selectedClassId, setSelectedClassId] = useState('');
    const [classStudents, setClassStudents] = useState([]);

    const fetchScripts = async () => {
        try {
            const res = await api.get('/scripts');
            setScripts(res.data);
        } catch (err) { console.error(err); }
    };

    const fetchAssignments = async () => {
        try {
            const res = await api.get('/assignments');
            setAssignments(res.data);
        } catch (err) { console.error(err); }
    };

    const fetchContexts = async () => {
        try {
            const res = await api.get('/subject-context');
            setAllContexts(res.data);
        } catch (err) { console.error(err); }
    };

    const fetchClasses = async () => {
        try {
            const res = await api.get('/classes');
            setClasses(res.data);
        } catch (err) { console.error(err); }
    };

    useEffect(() => {
        fetchScripts();
        fetchAssignments();
        fetchContexts();
        fetchClasses();
        const interval = setInterval(fetchScripts, 5000);
        return () => clearInterval(interval);
    }, []);

    // When a class is picked: load its students and auto-fill grade + subject.
    const handleSelectClass = async (id) => {
        setSelectedClassId(id);
        setStudentId('');
        setClassStudents([]);
        if (!id) return;
        const cls = classes.find(c => String(c.id) === String(id));
        if (cls) {
            if (cls.grade) setGrade(cls.grade);
            if (cls.subject) setSubject(cls.subject);
        }
        try {
            const res = await api.get(`/classes/${id}/students`);
            setClassStudents(res.data);
        } catch (err) { console.error(err); }
    };

    // When grade or subject changes, auto-select the matching textbook if one exists
    useEffect(() => {
        if (!grade || !subject) return;
        const match = allContexts.find(
            c => c.grade.toLowerCase() === grade.toLowerCase() &&
                 c.subject.toLowerCase() === subject.toLowerCase()
        );
        if (match) setContextId(String(match.id));
        else setContextId('');
    }, [grade, subject, allContexts]);

    // Filter contexts shown in dropdown: all of them, but put grade+subject matches first
    const sortedContexts = [...allContexts].sort((a, b) => {
        const aMatch = a.grade === grade && a.subject === subject ? -1 : 0;
        const bMatch = b.grade === grade && b.subject === subject ? -1 : 0;
        return aMatch - bMatch;
    });

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!files || files.length === 0) {
            showToast.error('Provide at least one file');
            return;
        }
        if (files.length === 1 && !studentId) {
            showToast.error('Provide Student ID for single file');
            return;
        }
        if (!grade || !exam || !subject) {
            showToast.error('Please select a Grade, Exam, and Subject');
            return;
        }

        setLoading(true);
        showToast.loading(`Uploading ${files.length} script(s)...`);
        try {
            for (let i = 0; i < files.length; i++) {
                const original = files[i];
                const sId = studentId ? studentId : original.name.replace(/\.[^/.]+$/, ""); // strip extension
                const pageImages = await toImagesIfPdf(original);

                const formData = new FormData();
                formData.append('student_id', sId);
                formData.append('grade', grade);
                formData.append('exam', exam);
                formData.append('subject', subject);
                if (assignmentId) formData.append('assignment_id', assignmentId);
                if (contextId)    formData.append('context_id', contextId);
                formData.append('textbook_strict', textbookStrict ? 'true' : 'false');
                for (const page of pageImages) formData.append('script', page);

                const resp = await api.post('/scripts/upload', formData);
                if (resp.data?.duplicate) {
                    showToast.info(`File "${original.name}" was previously graded — same marks applied`);
                }
            }
            setFiles(null);
            setStudentId('');
            setAssignmentId('');
            setSelectedClassId('');
            setClassStudents([]);
            document.getElementById('file-upload').value = '';
            showToast.success(`Successfully uploaded ${files.length} script(s)!`);
            fetchScripts(); // Refresh
        } catch (err) {
            console.error('Upload Error:', err);
            showToast.error('Upload failed: ' + (err.response?.data?.error || err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this evaluation? It will be moved to the recycle bin.")) return;
        try {
            await api.delete(`/scripts/${id}`);
            showToast.success('Script moved to recycle bin');
            fetchScripts();
        } catch (err) {
            showToast.error('Failed to delete script');
        }
    };

    const handleRestore = async (id) => {
        try {
            await api.put(`/scripts/${id}/restore`);
            showToast.success('Script restored successfully');
            fetchScripts();
        } catch (err) {
            showToast.error('Failed to restore script');
        }
    };

    const handleRegrade = async (id) => {
        if (!window.confirm('Re-grade this paper from scratch?')) return;
        try {
            await api.post(`/scripts/${id}/regrade`);
            showToast.loading('Re-grading started...');
            fetchScripts();
        } catch (err) {
            showToast.error('Re-grade failed: ' + (err.response?.data?.error || err.message));
        }
    };

    const displayedScripts = scripts
        .filter(s => {
            const matchesMode = viewMode === 'active' ? !s.is_deleted : s.is_deleted;
            const matchesGrade = filterGrade === 'All' || s.grade === filterGrade;
            const matchesExam = filterExam === 'All' || s.exam === filterExam;
            const matchesSubject = filterSubject === 'All' || s.subject === filterSubject;
            const matchesStatus = filterStatus === 'All' || s.status === filterStatus;
            const matchesConfidence = (s.confidence_score || 0) >= minConfidence;
            const matchesSearch = !searchQuery || s.student_id?.toLowerCase().includes(searchQuery.toLowerCase()) || s.filename?.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesMode && matchesGrade && matchesExam && matchesSubject && matchesStatus && matchesConfidence && matchesSearch;
        })
        .sort((a, b) => {
            if (sortBy === 'marks') {
                return (b.total_marks || 0) - (a.total_marks || 0);
            } else if (sortBy === 'confidence') {
                return (b.confidence_score || 0) - (a.confidence_score || 0);
            } else {
                // date (newest first)
                return new Date(b.upload_timestamp) - new Date(a.upload_timestamp);
            }
        });

    const getBadgeClass = (status) => {
        if (status === 'Pending') return 'badge-warning';
        if (status === 'Needs Review') return 'badge-danger';
        return 'badge-success';
    };

    // ── Presentation helpers (table + grouping) ──────────────────────────────
    const pctOf = (s) => (s.max_marks ? Math.round((s.total_marks / s.max_marks) * 100) : null);
    const scoreColor = (pct) =>
        pct == null ? 'var(--text-muted)' : pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    const toggleGroup = (key) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    const openReport = (s) => {
        if (s.status === 'Pending') return;
        navigate(s.status === 'Needs Review' ? `/review/${s.id}` : `/report/${s.id}`);
    };

    // At-a-glance summary over the currently filtered set.
    const gradedWithMarks = displayedScripts.filter(s => s.status !== 'Pending' && s.max_marks);
    const avgPct = gradedWithMarks.length
        ? Math.round(gradedWithMarks.reduce((sum, s) => sum + (s.total_marks / s.max_marks) * 100, 0) / gradedWithMarks.length)
        : null;
    const stats = {
        total: displayedScripts.length,
        needsReview: displayedScripts.filter(s => s.status === 'Needs Review').length,
        pending: displayedScripts.filter(s => s.status === 'Pending').length,
    };
    stats.evaluated = stats.total - stats.needsReview - stats.pending;

    // Group by "Exam — Subject (Grade)", preserving the current sort order.
    const groupOrder = [];
    const groupMap = {};
    for (const s of displayedScripts) {
        const key = `${s.exam || 'Unassigned'} — ${s.subject || 'No Subject'} (${s.grade || 'No Grade'})`;
        if (!groupMap[key]) { groupMap[key] = []; groupOrder.push(key); }
        groupMap[key].push(s);
    }
    const groups = groupOrder.map(key => {
        const items = groupMap[key];
        const wm = items.filter(s => s.status !== 'Pending' && s.max_marks);
        const avg = wm.length
            ? Math.round(wm.reduce((sum, s) => sum + (s.total_marks / s.max_marks) * 100, 0) / wm.length)
            : null;
        return { key, items, avg };
    });

    // Existing card layout, extracted so the Cards view still works unchanged.
    const renderCard = (script) => (
        <div key={script.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                    <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        Student: {script.student_id}
                    </h4>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: '12px', fontWeight: 600 }}>{script.grade || 'No Grade'}</span>
                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: 'var(--surface)', color: 'var(--text-main)', borderRadius: '12px', fontWeight: 600, border: '1px solid var(--border)' }}>{script.subject || 'No Subject'}</span>
                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: 'var(--border)', color: 'var(--text-main)', borderRadius: '12px', fontWeight: 600 }}>{script.exam || 'No Exam'}</span>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{script.filename}</p>
                </div>
                <span className={`badge ${getBadgeClass(script.status)}`}>
                    {script.status}
                </span>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                {script.status === 'Pending' ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <p style={{ margin: 0, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
                            <AlertTriangle size={18} /> AI is evaluating...
                        </p>
                        {viewMode === 'active' && (
                            <button onClick={() => handleDelete(script.id)} className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Delete">
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                ) : (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Score:</span>
                            <strong style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>{script.total_marks}/{script.max_marks || 10}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Confidence:</span>
                            <strong style={{ color: script.confidence_score < 75 ? 'var(--danger)' : 'var(--success)' }}>
                                {script.confidence_score}%
                            </strong>
                        </div>

                        {viewMode === 'deleted' ? (
                            <button onClick={() => handleRestore(script.id)} className="btn btn-success" style={{ width: '100%', background: 'var(--success)', color: 'white', border: 'none' }}>
                                <RefreshCcw size={18} /> Restore Script
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {script.status === 'Needs Review' ? (
                                    <Link to={`/review/${script.id}`} className="btn btn-secondary" style={{ flex: 1, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                                        <AlertTriangle size={18} /> Review Required
                                    </Link>
                                ) : (
                                    <Link to={`/report/${script.id}`} className="btn btn-primary" style={{ flex: 1 }}>
                                        <CheckCircle size={18} /> View Report
                                    </Link>
                                )}
                                <button onClick={() => handleRegrade(script.id)} className="btn btn-secondary" style={{ padding: '0 0.8rem' }} title="Re-grade">
                                    <RefreshCcw size={18} />
                                </button>
                                <button onClick={() => handleDelete(script.id)} className="btn btn-secondary" style={{ padding: '0 0.8rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Delete">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // Compact table row — the default, scannable presentation.
    const cellStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle' };
    const renderRow = (script) => {
        const pct = pctOf(script);
        const isPending = script.status === 'Pending';
        return (
            <tr
                key={script.id}
                className="mn-row"
                onClick={() => openReport(script)}
                style={{ borderTop: '1px solid var(--border)', cursor: isPending ? 'default' : 'pointer', transition: 'background 0.15s' }}
            >
                <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--text-main)' }}>{script.student_id}</td>
                <td style={cellStyle}>
                    {isPending ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                        <strong style={{ color: scoreColor(pct) }}>{script.total_marks}/{script.max_marks || 10}</strong>
                    )}
                </td>
                <td style={cellStyle}>
                    {isPending ? (
                        <span style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                            <AlertTriangle size={14} /> evaluating…
                        </span>
                    ) : (
                        <span style={{ color: script.confidence_score < 75 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{script.confidence_score}%</span>
                    )}
                </td>
                <td style={cellStyle}><span className={`badge ${getBadgeClass(script.status)}`}>{script.status}</span></td>
                <td style={{ ...cellStyle, color: 'var(--text-muted)', fontSize: '0.78rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={script.filename}>{script.filename}</td>
                <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {viewMode === 'deleted' ? (
                        <button onClick={() => handleRestore(script.id)} className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', color: 'var(--success)', borderColor: 'var(--success)', fontSize: '0.8rem' }} title="Restore">
                            <RefreshCcw size={15} /> Restore
                        </button>
                    ) : isPending ? (
                        <button onClick={() => handleDelete(script.id)} className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Delete">
                            <Trash2 size={15} />
                        </button>
                    ) : (
                        <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                            <button onClick={() => openReport(script)} className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem', color: script.status === 'Needs Review' ? 'var(--danger)' : 'var(--primary)', borderColor: script.status === 'Needs Review' ? 'var(--danger)' : 'var(--primary)' }} title={script.status === 'Needs Review' ? 'Review required' : 'View report'}>
                                {script.status === 'Needs Review' ? <AlertTriangle size={15} /> : <Eye size={15} />}
                            </button>
                            <button onClick={() => handleRegrade(script.id)} className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem' }} title="Re-grade">
                                <RefreshCcw size={15} />
                            </button>
                            <button onClick={() => handleDelete(script.id)} className="btn btn-secondary" style={{ padding: '0.3rem 0.55rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Delete">
                                <Trash2 size={15} />
                            </button>
                        </div>
                    )}
                </td>
            </tr>
        );
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>
            <style>{`
                .mn-row:hover { background: var(--primary-light); }
                .mn-group-head:hover { filter: brightness(0.97); }
            `}</style>
            <div className="dashboard-header">
                <div>
                    <h2 style={{ margin: 0, fontSize: '2rem' }}>Answer Scripts Dashboard</h2>
                    <p style={{ color: 'var(--text-muted)' }}>Upload, manage, and review student grades.</p>
                </div>
            </div>

            <div data-tour="upload" className="card" style={{ marginBottom: '2rem' }}>
                <h3 style={{ marginTop: 0 }}>Upload New Script</h3>
                <form onSubmit={handleUpload} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '120px' }}>
                        <label className="form-label">Grade</label>
                        <select className="form-input" value={grade} onChange={(e) => setGrade(e.target.value)} required>
                            <option value="" disabled>Select...</option>
                            {grades.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '120px' }}>
                        <label className="form-label">Subject</label>
                        <select className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} required>
                            <option value="" disabled>Select...</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '120px' }}>
                        <label className="form-label">Exam</label>
                        <select className="form-input" value={exam} onChange={(e) => setExam(e.target.value)} required>
                            <option value="" disabled>Select...</option>
                            {exams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
                        <label className="form-label">Link to Assignment (Optional)</label>
                        <select
                            className="form-input"
                            value={assignmentId}
                            onChange={(e) => setAssignmentId(e.target.value)}
                        >
                            <option value="">No Assignment (General AI)</option>
                            {assignments.map(a => (
                                <option key={a.id} value={a.id}>{a.title} ({a.total_max_marks}M)</option>
                            ))}
                        </select>
                    </div>

                    {/* ── Reference Textbook selector ── */}
                    <div className="form-group" style={{ marginBottom: 0, flex: '1 1 220px', minWidth: '220px' }}>
                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <BookOpen size={13} /> Reference Textbook
                        </label>
                        <select
                            className="form-input"
                            value={contextId}
                            onChange={e => setContextId(e.target.value)}
                        >
                            <option value="">— No textbook (general knowledge) —</option>
                            {sortedContexts.map(c => (
                                <option key={c.id} value={String(c.id)}>
                                    {c.label || `${c.grade} ${c.subject}`}
                                    {c.grade === grade && c.subject === subject ? ' ✓' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Strict mode toggle — only visible when a textbook is chosen */}
                    {contextId && (
                        <div className="form-group" style={{ marginBottom: 0, flex: '0 0 auto', alignSelf: 'flex-end', paddingBottom: '2px' }}>
                            <label style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                cursor: 'pointer', userSelect: 'none',
                                padding: '0.55rem 0.85rem',
                                border: `1px solid ${textbookStrict ? 'var(--primary)' : 'var(--border)'}`,
                                borderRadius: '8px',
                                background: textbookStrict ? 'rgba(79,70,229,0.08)' : 'transparent',
                                transition: 'all 0.2s',
                                whiteSpace: 'nowrap',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                color: textbookStrict ? 'var(--primary)' : 'var(--text-muted)',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={textbookStrict}
                                    onChange={e => setTextbookStrict(e.target.checked)}
                                    style={{ display: 'none' }}
                                />
                                <Lock size={13} />
                                Strict mode
                            </label>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', maxWidth: '160px' }}>
                                {textbookStrict ? '📚 Grade ONLY within this textbook' : 'Textbook used as context only'}
                            </div>
                        </div>
                    )}

                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
                        <label className="form-label">Class</label>
                        <select
                            className="form-input"
                            value={selectedClassId}
                            onChange={(e) => handleSelectClass(e.target.value)}
                        >
                            <option value="">— Select class —</option>
                            {classes.map(c => (
                                <option key={c.id} value={String(c.id)}>
                                    {c.name} {c.grade ? `(${c.grade})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
                        <label className="form-label">Student {files && files.length > 1 ? '(batch: by filename)' : ''}</label>
                        {selectedClassId && classStudents.length > 0 ? (
                            <select
                                className="form-input"
                                value={studentId}
                                onChange={(e) => setStudentId(e.target.value)}
                                disabled={files && files.length > 1}
                            >
                                <option value="">— Select student —</option>
                                {classStudents.map(s => (
                                    <option key={s.id} value={s.student_id}>
                                        {s.name || s.student_id} ({s.student_id})
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="text"
                                className="form-input"
                                placeholder={selectedClassId ? 'No students in class — type ID' : 'e.g., S10293'}
                                value={studentId}
                                onChange={(e) => setStudentId(e.target.value)}
                            />
                        )}
                    </div>

                    <div data-tour="file" className="form-group" style={{ marginBottom: 0, flex: 2, minWidth: '250px' }}>
                        <label className="form-label">Scan/Image (PDF, JPG, PNG)</label>
                        <input
                            id="file-upload"
                            type="file"
                            multiple
                            className="form-input"
                            accept=".pdf, .jpg, .jpeg, .png"
                            onChange={(e) => setFiles(e.target.files)}
                            required
                        />
                    </div>

                    <button data-tour="process" type="submit" className="btn btn-primary" disabled={loading} style={{ height: '48px', minWidth: '160px' }}>
                        <UploadCloud size={20} />
                        {loading ? 'Uploading...' : 'Process with AI'}
                    </button>
                </form>
            </div>

            <div data-tour="evaluations" style={{ background: 'var(--surface)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.3rem', color: 'var(--text-main)' }}>Recent Evaluations</h3>
                    <SearchBar
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Search by student ID or filename..."
                    />
                </div>

                {/* First row: 4 main filters */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Subject</label>
                        <select
                            className="form-input"
                            style={{ width: '100%', height: '36px', fontSize: '0.85rem', padding: '0.5rem' }}
                            value={filterSubject}
                            onChange={(e) => setFilterSubject(e.target.value)}
                        >
                            <option value="All">All Subjects</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Grade</label>
                        <select
                            className="form-input"
                            style={{ width: '100%', height: '36px', fontSize: '0.85rem', padding: '0.5rem' }}
                            value={filterGrade}
                            onChange={(e) => setFilterGrade(e.target.value)}
                        >
                            <option value="All">All Grades</option>
                            {grades.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Exam</label>
                        <select
                            className="form-input"
                            style={{ width: '100%', height: '36px', fontSize: '0.85rem', padding: '0.5rem' }}
                            value={filterExam}
                            onChange={(e) => setFilterExam(e.target.value)}
                        >
                            <option value="All">All Exams</option>
                            {exams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Status</label>
                        <select
                            className="form-input"
                            style={{ width: '100%', height: '36px', fontSize: '0.85rem', padding: '0.5rem' }}
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                        >
                            <option value="All">All Status</option>
                            <option value="Pending">Pending</option>
                            <option value="Needs Review">Needs Review</option>
                            <option value="Completed">Completed</option>
                        </select>
                    </div>
                </div>

                {/* Second row: Confidence & Sort */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Min Confidence</label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={minConfidence}
                                onChange={(e) => setMinConfidence(parseInt(e.target.value))}
                                style={{ flex: 1, height: '6px', borderRadius: '3px', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, minWidth: '40px' }}>{minConfidence}%</span>
                        </div>
                    </div>

                    <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Sort By</label>
                        <select
                            className="form-input"
                            style={{ width: '100%', height: '36px', fontSize: '0.85rem', padding: '0.5rem' }}
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                        >
                            <option value="date">Newest First</option>
                            <option value="marks">Highest Marks</option>
                            <option value="confidence">Highest Confidence</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', background: 'rgba(79, 70, 229, 0.08)', padding: '0.5rem', borderRadius: '10px' }}>
                        <button
                            onClick={() => setViewMode('active')}
                            className={`btn ${viewMode === 'active' ? 'btn-primary' : ''}`}
                            style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, background: viewMode === 'active' ? 'var(--primary)' : 'transparent', color: viewMode === 'active' ? 'white' : 'var(--text-muted)', border: 'none', boxShadow: viewMode === 'active' ? '0 4px 6px rgba(0,0,0,0.1)' : 'none', borderRadius: '8px', cursor: 'pointer' }}
                        >
                            Active ({scripts.filter(s => !s.is_deleted).length})
                        </button>
                        <button
                            onClick={() => setViewMode('deleted')}
                            className={`btn ${viewMode === 'deleted' ? 'btn-primary' : ''}`}
                            style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, background: viewMode === 'deleted' ? 'var(--primary)' : 'transparent', color: viewMode === 'deleted' ? 'white' : 'var(--text-muted)', border: 'none', boxShadow: viewMode === 'deleted' ? '0 4px 6px rgba(0,0,0,0.1)' : 'none', borderRadius: '8px', cursor: 'pointer' }}
                        >
                            Recycle Bin ({scripts.filter(s => s.is_deleted).length})
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(79, 70, 229, 0.08)', padding: '0.35rem', borderRadius: '10px' }}>
                            <button onClick={() => setDisplayMode('table')} title="Table view"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 600, background: displayMode === 'table' ? 'var(--primary)' : 'transparent', color: displayMode === 'table' ? 'white' : 'var(--text-muted)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                                <List size={15} /> Table
                            </button>
                            <button onClick={() => setDisplayMode('cards')} title="Card view"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 600, background: displayMode === 'cards' ? 'var(--primary)' : 'transparent', color: displayMode === 'cards' ? 'white' : 'var(--text-muted)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                                <LayoutGrid size={15} /> Cards
                            </button>
                        </div>
                        {displayedScripts.length > 0 && (
                            <button
                                onClick={() => {
                                    exportGradesCSV(displayedScripts, `grades_${new Date().toISOString().split('T')[0]}.csv`);
                                    showToast.success(`Exported ${displayedScripts.length} grades to CSV`);
                                }}
                                className="btn btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                            >
                                <Download size={16} /> Export CSV
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {stats.total > 0 && (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                    {[
                        { label: 'Papers', value: stats.total, color: 'var(--text-main)' },
                        { label: 'Evaluated', value: stats.evaluated, color: 'var(--success)' },
                        { label: 'Needs Review', value: stats.needsReview, color: 'var(--danger)' },
                        { label: 'Pending', value: stats.pending, color: 'var(--warning)' },
                        ...(avgPct != null ? [{ label: 'Avg Score', value: `${avgPct}%`, color: scoreColor(avgPct) }] : []),
                    ].map(st => (
                        <div key={st.label} style={{ flex: '1 1 120px', minWidth: '110px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.75rem 1rem' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: st.color }}>{st.value}</div>
                            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.03em' }}>{st.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {displayedScripts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)' }}>
                    {viewMode === 'active' ? (
                        <>
                            <FileText size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
                            <p>No scripts uploaded yet. Start by uploading a handwritten answer script above.</p>
                        </>
                    ) : (
                        <>
                            <Trash2 size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
                            <p>Recycle bin is empty.</p>
                        </>
                    )}
                </div>
            ) : (
                <div>
                    {groups.map(group => {
                        const collapsed = collapsedGroups[group.key];
                        return (
                            <div key={group.key} style={{ marginBottom: '1.25rem' }}>
                                <div className="mn-group-head" onClick={() => toggleGroup(group.key)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', padding: '0.65rem 0.9rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: collapsed ? '12px' : '12px 12px 0 0', userSelect: 'none' }}>
                                    {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{group.key}</span>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                        {group.items.length} paper{group.items.length !== 1 ? 's' : ''}
                                    </span>
                                    {group.avg != null && (
                                        <span style={{ marginLeft: 'auto', fontSize: '0.82rem', fontWeight: 700, color: scoreColor(group.avg) }}>avg {group.avg}%</span>
                                    )}
                                </div>

                                {!collapsed && (displayMode === 'cards' ? (
                                    <div className="scripts-grid" style={{ marginTop: '1rem' }}>
                                        {group.items.map(renderCard)}
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--surface)', textAlign: 'left' }}>
                                                    {['Student', 'Score', 'Confidence', 'Status', 'File'].map(h => (
                                                        <th key={h} style={{ ...cellStyle, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)', fontWeight: 700 }}>{h}</th>
                                                    ))}
                                                    <th style={{ ...cellStyle, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.items.map(renderRow)}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default Dashboard;
