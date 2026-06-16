import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, Save, ArrowLeft, AlertTriangle, PenTool, Eraser, Download, Sparkles, Loader, RefreshCcw } from 'lucide-react';
import api, { fileUrl } from '../api';
import { showToast } from '../hooks/useToast';

function ReviewPanel() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [script, setScript] = useState(null);
    const [newMarks, setNewMarks] = useState('');
    const [report, setReport] = useState('');
    const [aiCorrections, setAiCorrections] = useState([]);
    const [questionAnalysis, setQuestionAnalysis] = useState([]);
    const [activeMistake, setActiveMistake] = useState(null);
    const scrollContainerRef = React.useRef(null);

    useEffect(() => {
        if (activeMistake !== null && aiCorrections[activeMistake] && scrollContainerRef.current) {
            const corr = aiCorrections[activeMistake];
            const container = scrollContainerRef.current;
            const targetY = (corr.y / 100) * container.scrollHeight;
            const targetX = (corr.x / 100) * container.scrollWidth;

            container.scrollTo({
                top: targetY - (container.clientHeight / 2),
                left: targetX - (container.clientWidth / 2),
                behavior: 'smooth'
            });
        }
    }, [activeMistake, aiCorrections]);
    
    // Canvas states
    const canvasRef = React.useRef(null);
    const containerRef = React.useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushColor, setBrushColor] = useState('#ef4444');
    const [brushSize, setBrushSize] = useState(3);
    const [isErasing, setIsErasing] = useState(false);
    const [hasCorrections, setHasCorrections] = useState(false);
    const [generatingFeedback, setGeneratingFeedback] = useState(false);
    const [regrading, setRegrading] = useState(false);

    const handleRegrade = async () => {
        if (!window.confirm('Re-grade this paper? The AI will re-read and re-evaluate from scratch.')) return;
        setRegrading(true);
        try {
            await api.post(`/scripts/${id}/regrade`);
            showToast.loading('Re-grading started — refreshing in a few seconds...');
            const poll = setInterval(async () => {
                try {
                    const res = await api.get('/scripts');
                    const s = res.data.find(x => x.id === parseInt(id));
                    if (s && s.status !== 'Pending') {
                        clearInterval(poll);
                        setScript(s);
                        setNewMarks(s.total_marks || '');
                        setReport(s.report || '');
                        try { setAiCorrections(JSON.parse(s.corrections || '[]')); } catch {}
                        try { setQuestionAnalysis(JSON.parse(s.question_analysis || '[]')); } catch {}
                        setRegrading(false);
                        showToast.success(`Re-graded: ${s.total_marks}/${s.max_marks}`);
                    }
                } catch {}
            }, 3000);
            setTimeout(() => { clearInterval(poll); setRegrading(false); }, 120000);
        } catch (err) {
            showToast.error('Re-grade failed: ' + (err.response?.data?.error || err.message));
            setRegrading(false);
        }
    };

    useEffect(() => {
        const fetchScript = async () => {
            try {
                const res = await api.get('/scripts');
                const found = res.data.find(s => s.id === parseInt(id));
                setScript(found);
                setNewMarks(found?.total_marks || '');
                setReport(found?.report || '');
                if (found?.corrections) {
                    try { setAiCorrections(JSON.parse(found.corrections)); } catch (e) {}
                }
                if (found?.question_analysis) {
                    try { setQuestionAnalysis(JSON.parse(found.question_analysis)); } catch (e) {}
                }
            } catch (err) {
                console.error(err);
            }
        };
        fetchScript();
    }, [id]);

    useEffect(() => {
        // Initialize canvas sizing if it's an image and has loaded
        if (script && !script.filepath.toLowerCase().endsWith('.pdf') && containerRef.current && canvasRef.current) {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            
            // Wait for image to naturally load to get dimensions
            const img = container.querySelector('img');
            if (img && img.complete) {
                canvas.width = img.width;
                canvas.height = img.height;
            } else if (img) {
                img.onload = () => {
                    canvas.width = img.width;
                    canvas.height = img.height;
                };
            }
        }
    }, [script]);

    const startDrawing = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        setIsDrawing(true);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        
        ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        ctx.strokeStyle = isErasing ? 'rgba(0,0,0,1)' : brushColor;
        
        if (isErasing) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = brushSize * 3;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = brushSize;
        }
        
        ctx.lineCap = 'round';
        ctx.stroke();
        setHasCorrections(true);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            // Optional: If you want to save the drawn canvas image itself back to the server,
            // you could extract it here using canvas.toDataURL() and send it as part of the PUT request,
            // but for now we just handle the grade and report override per original functionality.
            
            await api.put(`/scripts/${id}`, {
                total_marks: parseInt(newMarks),
                report: report,
                question_analysis: questionAnalysis
            });
            navigate('/dashboard');
        } catch (err) {
            alert('Failed to update marks');
        }
    };

    const updateQuestionMark = (idx, newVal) => {
        const updated = [...questionAnalysis];
        updated[idx].marks_awarded = parseInt(newVal) || 0;
        setQuestionAnalysis(updated);

        // Auto-update total marks
        const total = updated.reduce((sum, q) => sum + (q.marks_awarded || 0), 0);
        setNewMarks(total);
    };

    const generateFeedbackPDF = async () => {
        setGeneratingFeedback(true);
        try {
            const response = await api.post(`/scripts/${id}/feedback-pdf`, {}, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Feedback_${script.student_id}.pdf`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert('Feedback: ' + (err.response?.data?.message || err.message));
        } finally {
            setGeneratingFeedback(false);
        }
    };

    if (!script) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;

    return (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="btn"
                    style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </button>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={handleRegrade}
                        disabled={regrading}
                        className="btn"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--warning)', color: 'white', border: 'none' }}
                        title="Re-run AI grading from scratch">
                        {regrading ? (
                            <><Loader size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> Re-grading...</>
                        ) : (
                            <><RefreshCcw size={16} /> Re-grade</>
                        )}
                    </button>
                    <button
                        onClick={generateFeedbackPDF}
                        disabled={generatingFeedback}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        title="Generate AI feedback PDF for this student">
                        {generatingFeedback ? (
                            <><Loader size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating...</>
                        ) : (
                            <><Download size={16} /> Generate Feedback PDF</>
                        )}
                    </button>
                </div>
            </div>

            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                    <div>
                        <h2 style={{ margin: '0 0 0.5rem 0' }}>Manual Review Panel</h2>
                        <p style={{ margin: 0, color: 'var(--text-muted)' }}>Student: {script.student_id} | File: {script.filename}</p>
                    </div>
                    <span className="badge badge-danger" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}>
                        <AlertTriangle size={16} /> {script.flags} ({script.confidence_score}%)
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(300px, 1fr)', gap: '2rem' }}>
                    {/* Script Image Viewer */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0 }}>Scanned Answer Script</h3>
                            
                            {script && !script.filepath.toLowerCase().endsWith('.pdf') && (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: '#f8fafc', padding: '0.3rem 0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                                    <button 
                                        type="button"
                                        title="Draw"
                                        onClick={() => setIsErasing(false)}
                                        style={{ background: !isErasing ? 'var(--primary)' : 'transparent', color: !isErasing ? 'white' : 'var(--text-main)', border: 'none', padding: '0.4rem', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                    >
                                        <PenTool size={16} />
                                    </button>
                                    <button 
                                        type="button"
                                        title="Eraser"
                                        onClick={() => setIsErasing(true)}
                                        style={{ background: isErasing ? 'var(--text-main)' : 'transparent', color: isErasing ? 'white' : 'var(--text-main)', border: 'none', padding: '0.4rem', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                    >
                                        <Eraser size={16} />
                                    </button>
                                    <div style={{ height: '20px', width: '1px', background: 'var(--border)', margin: '0 0.5rem' }}></div>
                                    <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} style={{ width: '24px', height: '24px', padding: 0, border: 'none', cursor: 'pointer' }} disabled={isErasing} />
                                    <input type="range" min="1" max="10" value={brushSize} onChange={(e) => setBrushSize(e.target.value)} style={{ width: '60px' }} />
                                </div>
                            )}
                        </div>

                        <div ref={scrollContainerRef} style={{ width: '100%', height: '500px', backgroundColor: '#f1f5f9', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'auto', position: 'relative' }}>
                            <div ref={containerRef} style={{ position: 'relative', width: '100%', minHeight: '100%' }}>
                                {script.filepath.toLowerCase().endsWith('.pdf') ? (
                                    <iframe
                                        src={`${fileUrl(script.filepath)}#toolbar=0&navpanes=0`}
                                        style={{ width: '100%', height: '1200px', border: 'none', display: 'block' }}
                                        title="Student Script"
                                    />
                                ) : (
                                    <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: 'none' }}>
                                        <img
                                            src={fileUrl(script.filepath)}
                                            alt="Student Script"
                                            style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                                            onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.nextSibling.style.display = 'block'; }}
                                        />
                                        <canvas
                                            ref={canvasRef}
                                            onMouseDown={startDrawing}
                                            onMouseMove={draw}
                                            onMouseUp={stopDrawing}
                                            onMouseLeave={stopDrawing}
                                            style={{ position: 'absolute', top: 0, left: 0, zIndex: 20, cursor: isErasing ? 'cell' : 'crosshair', pointerEvents: 'auto' }}
                                        />
                                    </div>
                                )}
                                
                                {aiCorrections && aiCorrections.length > 0 && aiCorrections.map((corr, idx) => (
                                    <div 
                                        key={idx} 
                                        style={{ 
                                            position: 'absolute', 
                                            top: `${corr.y}%`, 
                                            left: `${corr.x}%`, 
                                            transform: 'translate(-50%, -50%)', 
                                            zIndex: activeMistake === idx ? 25 : 15,
                                            transition: 'all 0.3s ease'
                                        }} 
                                        title={corr.text}
                                        onClick={() => setActiveMistake(idx)}
                                    >
                                        <div style={{ 
                                            background: activeMistake === idx ? '#ef4444' : 'var(--danger)', 
                                            color: 'white', 
                                            width: activeMistake === idx ? '40px' : '24px', 
                                            height: activeMistake === idx ? '40px' : '24px', 
                                            borderRadius: '50%', 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center', 
                                            cursor: 'pointer', 
                                            fontWeight: 'bold', 
                                            boxShadow: activeMistake === idx ? '0 0 25px rgba(239, 68, 68, 0.7)' : '0 2px 4px rgba(0,0,0,0.2)',
                                            border: '2px solid white',
                                            animation: activeMistake === idx ? 'pulse 1.5s infinite' : 'none',
                                            transform: activeMistake === idx ? 'scale(1.1)' : 'scale(1)',
                                            fontSize: activeMistake === idx ? '20px' : '12px'
                                        }}>
                                            !
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'none', color: 'var(--text-muted)' }}>
                                <FileText size={48} style={{ margin: '0 auto', opacity: 0.5 }} />
                                <p>File not loaded.</p>
                            </div>
                        </div>
                        {hasCorrections && (
                            <p style={{ fontSize: '0.8rem', color: 'var(--warning)', margin: '0.5rem 0 0 0', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <AlertTriangle size={14} /> Note: Visual canvas corrections are active.
                            </p>
                        )}
                    </div>

                    {/* Teacher Adjustment Form */}
                    <div>
                        <h3 style={{ marginTop: 0 }}>Evaluate Details</h3>

                        {/* Two-stage grading: show exactly what the AI read from the
                            handwriting so the teacher can verify the OCR. */}
                        {script.transcription && (
                            <details style={{ marginBottom: '1rem', background: 'rgba(79,70,229,0.05)', border: '1px solid rgba(79,70,229,0.2)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem' }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <FileText size={15} /> What the AI read from the handwriting
                                </summary>
                                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: '0.88rem', color: 'var(--text-main)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
                                    {script.transcription}
                                </pre>
                                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' }}>
                                    💡 If this misread the handwriting, that's likely why the marks are off — correct the marks below.
                                </p>
                            </details>
                        )}

                        <form onSubmit={handleSave} style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>

                            <div className="form-group">
                                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    AI Assigned Marks (Out of {script.max_marks || 10})
                                </label>
                                <input
                                    type="number"
                                    className="form-input"
                                    value={newMarks}
                                    onChange={(e) => setNewMarks(e.target.value)}
                                    min="0"
                                    max={script.max_marks || 10}
                                    style={{ fontSize: '1.5rem', fontWeight: 'bold', padding: '1rem' }}
                                />
                            </div>

                            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                                <label className="form-label">Feedback / AI Report</label>
                                <textarea
                                    className="form-input"
                                    rows="6"
                                    value={report}
                                    onChange={(e) => setReport(e.target.value)}
                                    style={{ resize: 'vertical' }}
                                />
                            </div>

                            {questionAnalysis && questionAnalysis.length > 0 && (
                                <div style={{ marginBottom: '2rem' }}>
                                    <label className="form-label">Per-Question Analysis</label>
                                    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                        {questionAnalysis.map((q, idx) => (
                                            <div key={idx} style={{ padding: '1rem', borderBottom: idx === questionAnalysis.length - 1 ? 'none' : '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 100px', gap: '1rem', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        {q.q_num} 
                                                        <span style={{ fontSize: '0.8rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: q.status === 'Correct' ? '#dcfce7' : '#fee2e2', color: q.status === 'Correct' ? '#166534' : '#991b1b' }}>
                                                            {q.status}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{q.teacher_tip}</div>
                                                </div>
                                                <input 
                                                    type="number" 
                                                    className="form-input" 
                                                    value={q.marks_awarded} 
                                                    onChange={(e) => updateQuestionMark(idx, e.target.value)}
                                                    style={{ textAlign: 'center', fontWeight: 'bold' }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {aiCorrections && aiCorrections.length > 0 && (
                                <div style={{ marginBottom: '2rem' }}>
                                    <label className="form-label">Specific AI Corrections</label>
                                    <div style={{ maxHeight: '250px', overflowY: 'auto', background: 'white', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                        {aiCorrections.map((corr, idx) => (
                                            <div 
                                                key={idx}
                                                onClick={() => setActiveMistake(idx)}
                                                style={{ 
                                                    padding: '0.8rem', 
                                                    borderBottom: idx === aiCorrections.length - 1 ? 'none' : '1px solid var(--border)',
                                                    cursor: 'pointer',
                                                    background: activeMistake === idx ? '#fee2e2' : 'transparent',
                                                    fontSize: '0.9rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <div>
                                                    <strong style={{ color: 'var(--danger)' }}>Mistake:</strong> {corr.text}
                                                </div>
                                                {corr.correct_answer != null && corr.correct_answer !== '' && (
                                                    <div style={{ marginTop: '0.4rem', color: '#15803d', fontWeight: 600 }}>
                                                        ✓ Correct answer: {corr.correct_answer}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '1rem' }}>
                                <Save size={20} /> Save & Verify Marks
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ReviewPanel;
