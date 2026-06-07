import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, CheckCircle, AlertTriangle, FileText, Trash2, RefreshCcw, ArrowUpDown, Download, BookOpen, Lock } from 'lucide-react';
import { toImageIfPdf } from '../utils/pdf';
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
                const f = await toImageIfPdf(original); // PDFs → image so AI sees real layout

                const formData = new FormData();
                formData.append('student_id', sId);
                formData.append('grade', grade);
                formData.append('exam', exam);
                formData.append('subject', subject);
                if (assignmentId) formData.append('assignment_id', assignmentId);
                if (contextId)    formData.append('context_id', contextId);
                formData.append('textbook_strict', textbookStrict ? 'true' : 'false');
                formData.append('script', f);

                await api.post('/scripts/upload', formData);
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

    return (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>
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
                <div className="scripts-grid">
                    {displayedScripts.map(script => (
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
                                                <button onClick={() => handleDelete(script.id)} className="btn btn-secondary" style={{ padding: '0 0.8rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Delete">
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Dashboard;
