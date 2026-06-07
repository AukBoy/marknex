import React, { useState, useEffect, useRef } from 'react';
import {
    Users, Calendar, BookOpen, Bell, ChevronLeft, ChevronRight,
    Plus, Trash2, Save, Loader, Printer, Download, CheckCircle,
    XCircle, Clock, AlertCircle, Sparkles, Send, FileText,
    Grid, Edit2, Check, X
} from 'lucide-react';
import api from '../api';
import { showToast } from '../hooks/useToast';
import './TeacherTools.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
const SLOT_COLORS = [
    '#4f46e5','#7c3aed','#db2777','#dc2626','#d97706',
    '#059669','#0891b2','#0369a1','#65a30d','#9333ea'
];
const STATUS_CONFIG = {
    present: { label: 'Present', color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: <CheckCircle size={15}/> },
    absent:  { label: 'Absent',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: <XCircle size={15}/> },
    late:    { label: 'Late',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: <Clock size={15}/> },
    excused: { label: 'Excused', color: '#6366f1', bg: 'rgba(99,102,241,0.1)', icon: <AlertCircle size={15}/> },
};

export default function TeacherTools() {
    const [tab, setTab] = useState('attendance');

    return (
        <div className="tt-container">
            <div className="tt-header">
                <h2>🏫 Teacher Tools</h2>
                <p>Attendance · Timetable · Lesson Plans · Parent Notices</p>
            </div>

            <div className="tt-tabs">
                {[
                    { id: 'attendance', label: 'Attendance',    icon: <Users size={15}/> },
                    { id: 'timetable',  label: 'Timetable',     icon: <Grid size={15}/> },
                    { id: 'lessons',    label: 'Lesson Plans',  icon: <BookOpen size={15}/> },
                    { id: 'notices',    label: 'Notices',       icon: <Bell size={15}/> },
                ].map(t => (
                    <button key={t.id} className={`tt-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            <div className="tt-body">
                {tab === 'attendance' && <AttendanceSection />}
                {tab === 'timetable'  && <TimetableSection />}
                {tab === 'lessons'    && <LessonSection />}
                {tab === 'notices'    && <NoticesSection />}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────
function AttendanceSection() {
    const [classes, setClasses]       = useState([]);
    const [classId, setClassId]       = useState('');
    const [students, setStudents]     = useState([]);
    const [date, setDate]             = useState(today());
    const [records, setRecords]       = useState({});  // studentId → status
    const [saved, setSaved]           = useState(false);
    const [saving, setSaving]         = useState(false);
    const [viewTab, setViewTab]       = useState('mark'); // 'mark' | 'report'
    const [report, setReport]         = useState([]);
    const [reportRange, setReportRange] = useState({ from: firstOfMonth(), to: today() });
    const [markedDates, setMarkedDates] = useState([]);

    useEffect(() => { fetchClasses(); }, []);
    useEffect(() => { if (classId) { fetchStudents(); fetchMarkedDates(); } }, [classId]);
    useEffect(() => { if (classId && date) loadAttendance(); }, [classId, date]);

    const fetchClasses = async () => {
        try { const r = await api.get('/classes'); setClasses(r.data); } catch {}
    };

    const fetchStudents = async () => {
        try {
            const r = await api.get(`/classes/${classId}/students`);
            setStudents(r.data);
            // Default everyone to present
            const defaults = {};
            r.data.forEach(s => { defaults[s.id] = 'present'; });
            setRecords(defaults);
        } catch {}
    };

    const fetchMarkedDates = async () => {
        try {
            const r = await api.get(`/attendance/dates?class_id=${classId}&month=${date.slice(0,7)}`);
            setMarkedDates(r.data);
        } catch {}
    };

    const loadAttendance = async () => {
        try {
            const r = await api.get(`/attendance?class_id=${classId}&date=${date}`);
            if (r.data.length > 0) {
                const m = {};
                r.data.forEach(a => { m[a.student_id] = a.status; });
                setRecords(prev => ({ ...prev, ...m }));
                setSaved(true);
            } else {
                setSaved(false);
            }
        } catch {}
    };

    const handleSave = async () => {
        if (!classId || students.length === 0) return;
        setSaving(true);
        try {
            const recs = students.map(s => ({ student_id: s.id, status: records[s.id] || 'present' }));
            await api.post('/attendance', { class_id: classId, date, records: recs });
            setSaved(true);
            showToast.success('Attendance saved!');
            fetchMarkedDates();
        } catch { showToast.error('Failed to save attendance'); }
        finally { setSaving(false); }
    };

    const markAll = (status) => {
        const m = {};
        students.forEach(s => { m[s.id] = status; });
        setRecords(m);
    };

    const fetchReport = async () => {
        if (!classId) return;
        try {
            const r = await api.get(`/attendance/report?class_id=${classId}&from=${reportRange.from}&to=${reportRange.to}`);
            setReport(r.data);
        } catch { showToast.error('Failed to load report'); }
    };

    const attendancePct = (row) => {
        if (!row.total_days) return 0;
        return Math.round((row.present / row.total_days) * 100);
    };

    const presentCount = students.filter(s => records[s.id] === 'present').length;
    const absentCount  = students.filter(s => records[s.id] === 'absent').length;

    return (
        <div className="tt-section">
            <div className="tt-section-controls">
                <select className="form-input tt-select" value={classId} onChange={e => setClassId(e.target.value)}>
                    <option value="">— Select Class —</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name} ({c.grade})</option>)}
                </select>
                <div className="tt-sub-tabs">
                    <button className={`tt-sub-tab ${viewTab === 'mark' ? 'active' : ''}`} onClick={() => setViewTab('mark')}>
                        <CheckCircle size={14}/> Mark Attendance
                    </button>
                    <button className={`tt-sub-tab ${viewTab === 'report' ? 'active' : ''}`} onClick={() => { setViewTab('report'); fetchReport(); }}>
                        <FileText size={14}/> Report
                    </button>
                </div>
            </div>

            {viewTab === 'mark' && (
                <>
                    <div className="tt-att-controls">
                        <input type="date" className="form-input" value={date}
                            onChange={e => { setDate(e.target.value); setSaved(false); }} />
                        <div style={{ display:'flex', gap:'0.4rem' }}>
                            <button className="btn btn-secondary tt-sm" onClick={() => markAll('present')}>✓ All Present</button>
                            <button className="btn btn-secondary tt-sm" onClick={() => markAll('absent')}>✗ All Absent</button>
                        </div>
                        {classId && students.length > 0 && (
                            <div className="tt-stats">
                                <span className="tt-stat present">{presentCount} Present</span>
                                <span className="tt-stat absent">{absentCount} Absent</span>
                                <span className="tt-stat late">{students.filter(s => records[s.id] === 'late').length} Late</span>
                            </div>
                        )}
                    </div>

                    {!classId ? (
                        <div className="tt-empty">Select a class to start marking attendance</div>
                    ) : students.length === 0 ? (
                        <div className="tt-empty">No students in this class yet. Add them in <strong>Manage Everything → Classes</strong>.</div>
                    ) : (
                        <>
                            <div className="tt-student-list">
                                {students.map((s, i) => {
                                    const status = records[s.id] || 'present';
                                    return (
                                        <div key={s.id} className={`tt-student-row ${status}`}>
                                            <div className="tt-student-num">{i + 1}</div>
                                            <div className="tt-student-info">
                                                <strong>{s.name}</strong>
                                                <small>{s.student_id}</small>
                                            </div>
                                            <div className="tt-status-btns">
                                                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                                                    <button
                                                        key={key}
                                                        className={`tt-status-btn ${status === key ? 'active' : ''}`}
                                                        style={status === key ? { background: cfg.bg, color: cfg.color, borderColor: cfg.color } : {}}
                                                        onClick={() => setRecords(prev => ({ ...prev, [s.id]: key }))}
                                                    >
                                                        {cfg.icon} {cfg.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ display:'flex', gap:'1rem', marginTop:'1rem' }}>
                                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                    {saving ? <><Loader size={15} className="spin"/> Saving…</> : <><Save size={15}/> Save Attendance</>}
                                </button>
                                {saved && <span style={{ color:'#10b981', display:'flex', alignItems:'center', gap:'0.4rem' }}><CheckCircle size={16}/> Saved for {date}</span>}
                            </div>
                        </>
                    )}
                </>
            )}

            {viewTab === 'report' && (
                <div className="tt-report">
                    <div className="tt-report-controls">
                        <label>From: <input type="date" className="form-input tt-date-sm" value={reportRange.from} onChange={e => setReportRange(p => ({...p, from: e.target.value}))}/></label>
                        <label>To: <input type="date" className="form-input tt-date-sm" value={reportRange.to} onChange={e => setReportRange(p => ({...p, to: e.target.value}))}/></label>
                        <button className="btn btn-primary tt-sm" onClick={fetchReport}>Load Report</button>
                    </div>

                    {report.length > 0 && (
                        <div className="tt-report-table-wrap">
                            <table className="tt-table">
                                <thead>
                                    <tr>
                                        <th>Student</th><th>ID</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Attendance %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.map(r => (
                                        <tr key={r.student_id} className={attendancePct(r) < 75 ? 'tt-row-warn' : ''}>
                                            <td><strong>{r.name}</strong></td>
                                            <td>{r.student_code}</td>
                                            <td className="tt-td-present">{r.present || 0}</td>
                                            <td className="tt-td-absent">{r.absent || 0}</td>
                                            <td className="tt-td-late">{r.late || 0}</td>
                                            <td>{r.excused || 0}</td>
                                            <td>
                                                <div className="tt-pct-bar">
                                                    <div className="tt-pct-fill" style={{ width: `${attendancePct(r)}%`, background: attendancePct(r) < 75 ? '#ef4444' : '#10b981' }}/>
                                                    <span>{attendancePct(r)}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {report.length === 0 && classId && <div className="tt-empty">No attendance data for this range. Select a class and load report.</div>}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// TIMETABLE
// ─────────────────────────────────────────────────────────────
function TimetableSection() {
    const [slots, setSlots]         = useState([]);
    const [editing, setEditing]     = useState(null); // { day, period } being edited
    const [form, setForm]           = useState({ subject:'', grade:'', class_name:'', room:'', start_time:'', end_time:'', color: SLOT_COLORS[0] });
    const [showForm, setShowForm]   = useState(false);

    useEffect(() => { fetchSlots(); }, []);

    const fetchSlots = async () => {
        try { const r = await api.get('/timetable'); setSlots(r.data); } catch {}
    };

    const slotAt = (day, period) => slots.find(s => s.day === day && s.period === period);

    const openAdd = (day, period) => {
        setEditing({ day, period, id: null });
        const existing = slotAt(day, period);
        if (existing) {
            setForm({ subject: existing.subject, grade: existing.grade, class_name: existing.class_name, room: existing.room, start_time: existing.start_time, end_time: existing.end_time, color: existing.color });
            setEditing({ day, period, id: existing.id });
        } else {
            setForm({ subject:'', grade:'', class_name:'', room:'', start_time:'', end_time:'', color: SLOT_COLORS[Math.floor(Math.random()*SLOT_COLORS.length)] });
        }
        setShowForm(true);
    };

    const handleSave = async () => {
        try {
            if (editing?.id) {
                await api.put(`/timetable/${editing.id}`, { ...form, day: editing.day, period: editing.period });
            } else {
                await api.post('/timetable', { ...form, day: editing.day, period: editing.period });
            }
            setShowForm(false); fetchSlots();
            showToast.success('Slot saved');
        } catch { showToast.error('Failed to save'); }
    };

    const handleDelete = async (id) => {
        try { await api.delete(`/timetable/${id}`); fetchSlots(); showToast.success('Slot removed'); setShowForm(false); }
        catch { showToast.error('Failed to delete'); }
    };

    return (
        <div className="tt-section">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                <p style={{ margin:0, color:'var(--text-muted)', fontSize:'0.9rem' }}>Click any cell to add or edit a class slot</p>
                <button className="btn btn-secondary tt-sm" onClick={() => window.print()}>
                    <Printer size={14}/> Print
                </button>
            </div>

            <div className="tt-grid-wrapper">
                <table className="tt-grid">
                    <thead>
                        <tr>
                            <th className="tt-grid-period">Period</th>
                            {DAYS.map(d => <th key={d}>{d}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {PERIODS.map(p => (
                            <tr key={p}>
                                <td className="tt-grid-period">{p}</td>
                                {DAYS.map(d => {
                                    const slot = slotAt(d, p);
                                    return (
                                        <td key={d} className="tt-cell" onClick={() => openAdd(d, p)}>
                                            {slot ? (
                                                <div className="tt-slot" style={{ background: slot.color + '22', borderLeft: `3px solid ${slot.color}` }}>
                                                    <strong style={{ color: slot.color }}>{slot.subject}</strong>
                                                    <small>{slot.grade} {slot.class_name}</small>
                                                    {slot.room && <small>📍 {slot.room}</small>}
                                                    {slot.start_time && <small>🕐 {slot.start_time}–{slot.end_time}</small>}
                                                </div>
                                            ) : (
                                                <div className="tt-cell-empty"><Plus size={14}/></div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Edit/Add modal */}
            {showForm && (
                <div className="tt-modal-overlay" onClick={() => setShowForm(false)}>
                    <div className="tt-modal" onClick={e => e.stopPropagation()}>
                        <div className="tt-modal-header">
                            <strong>{editing?.id ? 'Edit' : 'Add'} Slot — {editing?.day}, Period {editing?.period}</strong>
                            <button className="btn-icon" onClick={() => setShowForm(false)}><X size={16}/></button>
                        </div>
                        <div className="tt-modal-body">
                            <div className="tt-form-grid">
                                {[
                                    { label:'Subject', key:'subject', placeholder:'e.g. ICT' },
                                    { label:'Grade',   key:'grade',   placeholder:'e.g. Grade 6' },
                                    { label:'Class',   key:'class_name', placeholder:'e.g. 6A' },
                                    { label:'Room',    key:'room',    placeholder:'e.g. Lab 2' },
                                    { label:'Start',   key:'start_time', type:'time' },
                                    { label:'End',     key:'end_time',   type:'time' },
                                ].map(f => (
                                    <div key={f.key} className="tt-form-field">
                                        <label>{f.label}</label>
                                        <input type={f.type||'text'} className="form-input" placeholder={f.placeholder||''} value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))}/>
                                    </div>
                                ))}
                            </div>
                            <div className="tt-color-picker">
                                <label>Colour</label>
                                <div className="tt-colors">
                                    {SLOT_COLORS.map(c => (
                                        <button key={c} className={`tt-color-btn ${form.color === c ? 'selected' : ''}`}
                                            style={{ background: c }} onClick={() => setForm(p => ({...p, color: c}))}/>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="tt-modal-footer">
                            {editing?.id && <button className="btn btn-danger-outline" onClick={() => handleDelete(editing.id)}><Trash2 size={14}/> Delete</button>}
                            <button className="btn btn-primary" onClick={handleSave}><Save size={14}/> Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// LESSON PLANS
// ─────────────────────────────────────────────────────────────
function LessonSection() {
    const [plans, setPlans]         = useState([]);
    const [form, setForm]           = useState({ grade:'', subject:'', topic:'', duration:'45 minutes', language:'English', date:today() });
    const [generating, setGenerating] = useState(false);
    const [activePlan, setActivePlan] = useState(null);
    const [genError, setGenError]   = useState('');
    const [viewMode, setViewMode]   = useState('list'); // 'list' | 'create' | 'view'

    useEffect(() => { fetchPlans(); }, []);

    const fetchPlans = async () => {
        try { const r = await api.get('/lesson-plans'); setPlans(r.data); } catch {}
    };

    const handleGenerate = async () => {
        if (!form.grade || !form.subject || !form.topic) {
            setGenError('Grade, Subject and Topic are required');
            return;
        }
        setGenError('');
        setGenerating(true);
        try {
            const r = await api.post('/lesson-plans/generate', form, { timeout: 60000 });
            setActivePlan({ ...r.data.plan, _unsaved: true });
            setViewMode('view');
        } catch (err) {
            setGenError(err.response?.data?.error || 'Generation failed');
        } finally { setGenerating(false); }
    };

    const handleSave = async () => {
        if (!activePlan) return;
        try {
            await api.post('/lesson-plans', { ...form, plan: activePlan });
            setActivePlan(prev => ({ ...prev, _unsaved: false }));
            showToast.success('Lesson plan saved!');
            fetchPlans();
        } catch { showToast.error('Failed to save'); }
    };

    const loadPlan = async (id) => {
        try {
            const r = await api.get(`/lesson-plans/${id}`);
            setActivePlan(r.data.plan);
            setViewMode('view');
        } catch { showToast.error('Failed to load plan'); }
    };

    const deletePlan = async (id) => {
        if (!window.confirm('Delete this plan?')) return;
        try { await api.delete(`/lesson-plans/${id}`); fetchPlans(); showToast.success('Deleted'); }
        catch { showToast.error('Failed to delete'); }
    };

    return (
        <div className="tt-section">
            <div className="tt-sub-tabs" style={{ marginBottom:'1.5rem' }}>
                <button className={`tt-sub-tab ${viewMode==='list'?'active':''}`} onClick={() => setViewMode('list')}><FileText size={14}/> Saved Plans ({plans.length})</button>
                <button className={`tt-sub-tab ${viewMode==='create'?'active':''}`} onClick={() => setViewMode('create')}><Sparkles size={14}/> Generate New</button>
                {activePlan && <button className={`tt-sub-tab ${viewMode==='view'?'active':''}`} onClick={() => setViewMode('view')}><BookOpen size={14}/> View Plan</button>}
            </div>

            {viewMode === 'list' && (
                <div>
                    {plans.length === 0 ? (
                        <div className="tt-empty">No lesson plans yet. Click <strong>Generate New</strong> to create one.</div>
                    ) : (
                        <div className="tt-plan-list">
                            {plans.map(p => (
                                <div key={p.id} className="tt-plan-row">
                                    <div className="tt-plan-info">
                                        <strong>{p.title}</strong>
                                        <small>{p.grade} · {p.subject} · {p.topic} · {p.duration}</small>
                                        <small style={{ color:'var(--text-muted)' }}>{p.date || new Date(p.created_at).toLocaleDateString()}</small>
                                    </div>
                                    <div style={{ display:'flex', gap:'0.5rem' }}>
                                        <button className="btn btn-secondary tt-sm" onClick={() => loadPlan(p.id)}><BookOpen size={13}/> View</button>
                                        <button className="btn-icon" onClick={() => deletePlan(p.id)}><Trash2 size={14}/></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {viewMode === 'create' && (
                <div className="tt-create-plan">
                    <div className="tt-form-grid tt-form-grid-3">
                        {[
                            { label:'Grade *', key:'grade', placeholder:'e.g. Grade 6' },
                            { label:'Subject *', key:'subject', placeholder:'e.g. ICT' },
                            { label:'Duration', key:'duration', placeholder:'45 minutes' },
                        ].map(f => (
                            <div key={f.key} className="tt-form-field">
                                <label>{f.label}</label>
                                <input className="form-input" placeholder={f.placeholder} value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))}/>
                            </div>
                        ))}
                    </div>
                    <div className="tt-form-field" style={{ marginBottom:'1rem' }}>
                        <label>Topic * <small style={{ color:'var(--text-muted)' }}>(be specific, e.g. "Input Devices — Keyboard and Mouse")</small></label>
                        <input className="form-input" placeholder="e.g. Introduction to Computer Hardware" value={form.topic} onChange={e => setForm(p => ({...p, topic: e.target.value}))}/>
                    </div>
                    <div className="tt-form-grid" style={{ marginBottom:'1rem' }}>
                        <div className="tt-form-field">
                            <label>Date</label>
                            <input type="date" className="form-input" value={form.date} onChange={e => setForm(p => ({...p, date: e.target.value}))}/>
                        </div>
                        <div className="tt-form-field">
                            <label>Language</label>
                            <select className="form-input" value={form.language} onChange={e => setForm(p => ({...p, language: e.target.value}))}>
                                <option value="English">English</option>
                                <option value="Sinhala">සිංහල (Sinhala)</option>
                                <option value="Tamil">தமிழ் (Tamil)</option>
                            </select>
                        </div>
                    </div>

                    {genError && <div className="tt-error">{genError}</div>}

                    <button className="btn btn-primary" onClick={handleGenerate} disabled={generating} style={{ width:'100%', padding:'0.85rem' }}>
                        {generating ? <><Loader size={16} className="spin"/> Generating plan…</> : <><Sparkles size={16}/> Generate Lesson Plan with AI</>}
                    </button>
                </div>
            )}

            {viewMode === 'view' && activePlan && (
                <div className="tt-plan-view">
                    <div className="tt-plan-view-controls">
                        {activePlan._unsaved && (
                            <button className="btn btn-primary tt-sm" onClick={handleSave}><Save size={14}/> Save Plan</button>
                        )}
                        <button className="btn btn-secondary tt-sm" onClick={() => window.print()}><Printer size={14}/> Print</button>
                    </div>
                    <LessonPlanDoc plan={activePlan} />
                </div>
            )}
        </div>
    );
}

function LessonPlanDoc({ plan }) {
    return (
        <div className="tt-plan-doc">
            <div className="tt-plan-doc-header">
                <h2>{plan.title}</h2>
                <div className="tt-plan-meta">
                    <span>📚 {plan.subject}</span><span>·</span>
                    <span>🎓 {plan.grade}</span><span>·</span>
                    <span>⏱ {plan.duration}</span>
                    {plan.date && <><span>·</span><span>📅 {plan.date}</span></>}
                </div>
            </div>

            {plan.objectives?.length > 0 && (
                <div className="tt-plan-block">
                    <h4>🎯 Learning Objectives</h4>
                    <ul>{plan.objectives.map((o,i) => <li key={i}>{o}</li>)}</ul>
                </div>
            )}

            {plan.materials?.length > 0 && (
                <div className="tt-plan-block">
                    <h4>📦 Materials Needed</h4>
                    <div className="tt-materials">{plan.materials.map((m,i) => <span key={i} className="tt-material-chip">{m}</span>)}</div>
                </div>
            )}

            {plan.sections?.length > 0 && (
                <div className="tt-plan-block">
                    <h4>📋 Lesson Plan</h4>
                    <table className="tt-plan-table">
                        <thead>
                            <tr><th>Phase</th><th>Time</th><th>Teacher</th><th>Students</th></tr>
                        </thead>
                        <tbody>
                            {plan.sections.map((s, i) => (
                                <tr key={i}>
                                    <td><strong>{s.name}</strong><br/><small style={{ color:'var(--text-muted)' }}>{s.activity}</small></td>
                                    <td style={{ whiteSpace:'nowrap' }}>{s.duration}</td>
                                    <td>{s.teacher_action}</td>
                                    <td>{s.student_action}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {plan.assessment && (
                <div className="tt-plan-block">
                    <h4>✅ Assessment</h4>
                    <p>{plan.assessment}</p>
                </div>
            )}

            {plan.homework && (
                <div className="tt-plan-block">
                    <h4>📝 Homework</h4>
                    <p>{plan.homework}</p>
                </div>
            )}

            {plan.notes && (
                <div className="tt-plan-block tt-plan-notes">
                    <h4>💡 Teacher Notes</h4>
                    <p>{plan.notes}</p>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// NOTICES
// ─────────────────────────────────────────────────────────────
function NoticesSection() {
    const [notices, setNotices]     = useState([]);
    const [form, setForm]           = useState({ title:'', body:'', target_grade:'', target_class:'' });
    const [aiForm, setAiForm]       = useState({ type:'', grade:'', details:'', language:'English' });
    const [generating, setGenerating] = useState(false);
    const [tab, setTab]             = useState('compose'); // 'compose' | 'history'

    useEffect(() => { fetchNotices(); }, []);

    const fetchNotices = async () => {
        try { const r = await api.get('/notices'); setNotices(r.data); } catch {}
    };

    const handleGenerate = async () => {
        if (!aiForm.type) { showToast.error('Enter notice type'); return; }
        setGenerating(true);
        try {
            const r = await api.post('/notices/generate', aiForm, { timeout: 30000 });
            setForm(prev => ({ ...prev, title: r.data.title || prev.title, body: r.data.body || prev.body }));
            showToast.success('Notice drafted!');
        } catch { showToast.error('AI generation failed'); }
        finally { setGenerating(false); }
    };

    const handleSend = async () => {
        if (!form.title || !form.body) { showToast.error('Title and body required'); return; }
        try {
            await api.post('/notices', form);
            showToast.success('Notice saved!');
            setForm({ title:'', body:'', target_grade:'', target_class:'' });
            fetchNotices();
            setTab('history');
        } catch { showToast.error('Failed to save'); }
    };

    const deleteNotice = async (id) => {
        try { await api.delete(`/notices/${id}`); fetchNotices(); showToast.success('Deleted'); }
        catch { showToast.error('Failed to delete'); }
    };

    const NOTICE_TYPES = ['Exam reminder', 'Holiday notice', 'Parent meeting', 'Assignment due', 'Fee reminder', 'Event invitation', 'Progress update', 'Custom'];

    return (
        <div className="tt-section">
            <div className="tt-sub-tabs" style={{ marginBottom:'1.5rem' }}>
                <button className={`tt-sub-tab ${tab==='compose'?'active':''}`} onClick={() => setTab('compose')}><Send size={14}/> Compose</button>
                <button className={`tt-sub-tab ${tab==='history'?'active':''}`} onClick={() => setTab('history')}><FileText size={14}/> History ({notices.length})</button>
            </div>

            {tab === 'compose' && (
                <div className="tt-notice-compose">
                    {/* AI draft */}
                    <div className="tt-ai-draft-card">
                        <h4><Sparkles size={15}/> AI Draft a Notice</h4>
                        <div className="tt-form-grid">
                            <div className="tt-form-field">
                                <label>Notice Type</label>
                                <select className="form-input" value={aiForm.type} onChange={e => setAiForm(p => ({...p, type: e.target.value}))}>
                                    <option value="">— Select type —</option>
                                    {NOTICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div className="tt-form-field">
                                <label>Grade (optional)</label>
                                <input className="form-input" placeholder="e.g. Grade 6" value={aiForm.grade} onChange={e => setAiForm(p => ({...p, grade: e.target.value}))}/>
                            </div>
                            <div className="tt-form-field">
                                <label>Language</label>
                                <select className="form-input" value={aiForm.language} onChange={e => setAiForm(p => ({...p, language: e.target.value}))}>
                                    <option value="English">English</option>
                                    <option value="Sinhala">සිංහල</option>
                                    <option value="Tamil">தமிழ்</option>
                                </select>
                            </div>
                        </div>
                        <div className="tt-form-field" style={{ marginTop:'0.75rem' }}>
                            <label>Details (optional)</label>
                            <input className="form-input" placeholder="e.g. Exam on Friday 14th, bring pencils" value={aiForm.details} onChange={e => setAiForm(p => ({...p, details: e.target.value}))}/>
                        </div>
                        <button className="btn btn-secondary" style={{ marginTop:'0.75rem' }} onClick={handleGenerate} disabled={generating}>
                            {generating ? <><Loader size={14} className="spin"/> Drafting…</> : <><Sparkles size={14}/> Draft Notice</>}
                        </button>
                    </div>

                    {/* Compose form */}
                    <div className="tt-form-field" style={{ marginTop:'1.25rem' }}>
                        <label>Title *</label>
                        <input className="form-input" placeholder="Notice title" value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))}/>
                    </div>
                    <div className="tt-form-field" style={{ marginTop:'0.75rem' }}>
                        <label>Message *</label>
                        <textarea className="form-input" rows={6} placeholder="Type your notice here…" value={form.body} onChange={e => setForm(p => ({...p, body: e.target.value}))} style={{ resize:'vertical' }}/>
                    </div>
                    <div className="tt-form-grid" style={{ marginTop:'0.75rem' }}>
                        <div className="tt-form-field">
                            <label>Target Grade (optional)</label>
                            <input className="form-input" placeholder="e.g. Grade 6" value={form.target_grade} onChange={e => setForm(p => ({...p, target_grade: e.target.value}))}/>
                        </div>
                        <div className="tt-form-field">
                            <label>Target Class (optional)</label>
                            <input className="form-input" placeholder="e.g. 6A" value={form.target_class} onChange={e => setForm(p => ({...p, target_class: e.target.value}))}/>
                        </div>
                    </div>
                    <div style={{ display:'flex', gap:'0.75rem', marginTop:'1rem' }}>
                        <button className="btn btn-primary" onClick={handleSend}><Save size={14}/> Save Notice</button>
                        <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={14}/> Print</button>
                    </div>
                </div>
            )}

            {tab === 'history' && (
                <div>
                    {notices.length === 0 ? (
                        <div className="tt-empty">No notices saved yet.</div>
                    ) : (
                        <div className="tt-notice-list">
                            {notices.map(n => (
                                <div key={n.id} className="tt-notice-row">
                                    <div className="tt-notice-info">
                                        <strong>{n.title}</strong>
                                        <small>{n.target_grade && `${n.target_grade} `}{n.target_class && `· ${n.target_class} `}· {new Date(n.sent_at).toLocaleDateString()}</small>
                                        <p>{n.body}</p>
                                    </div>
                                    <button className="btn-icon" onClick={() => deleteNotice(n.id)}><Trash2 size={14}/></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── helpers ────────────────────────────────────────────────
function today() {
    return new Date().toISOString().slice(0, 10);
}
function firstOfMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
