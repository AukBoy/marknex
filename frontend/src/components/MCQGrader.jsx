import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, CheckCircle, ArrowLeft, FileText, CheckSquare, Layers } from 'lucide-react';
import { toImageIfPdf } from '../utils/pdf';
import api from '../api';
import { useOptions } from '../hooks/useOptions';

function MCQGrader() {
    const navigate = useNavigate();
    const { grades, subjects, exams } = useOptions();
    const [step, setStep] = useState(1);
    
    // Step 1 State
    const [masterFile, setMasterFile] = useState(null);
    const [extracting, setExtracting] = useState(false);
    const [extractedKey, setExtractedKey] = useState('');
    const [totalMarks, setTotalMarks] = useState(10);
    const [assignmentTitle, setAssignmentTitle] = useState('MCQ Quiz');
    
    // Step 2 State
    const [assignmentId, setAssignmentId] = useState(null);
    const [studentFiles, setStudentFiles] = useState(null);
    const [grade, setGrade] = useState('');
    const [exam, setExam] = useState('');
    const [subject, setSubject] = useState('');
    const [uploadingBulk, setUploadingBulk] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const handleExtractKey = async (e) => {
        e.preventDefault();
        if (!masterFile) return alert('Please select a master answer sheet.');
        setExtracting(true);
        try {
            const formData = new FormData();
            formData.append('master_sheet', masterFile);
            
            console.log('Uploading file:', masterFile.name, 'Size:', masterFile.size);
            const res = await api.post('/mcq/extract-key', formData);
            console.log('Response:', res.data);
            setExtractedKey(res.data.extracted_key);
            setStep(2);
        } catch (err) {
            console.error('Upload error:', err);
            console.error('Response:', err.response);
            alert('Failed to extract answer key. ' + (err.response?.data?.error || err.message));
        } finally {
            setExtracting(false);
        }
    };

    const handleCreateAssignment = async () => {
        if (!extractedKey) return alert('No answer key extracted.');
        setExtracting(true);
        try {
            // Create a specialized Assignment for this MCQ batch
            const res = await api.post('/assignments', {
                title: assignmentTitle,
                description: 'Auto-generated MCQ Assignment',
                questions: [{
                    q_num: 'MCQ Section',
                    max_marks: totalMarks,
                    rubric: extractedKey
                }]
            });
            setAssignmentId(res.data.id);
            setStep(3);
        } catch (err) {
            alert('Failed to create assignment mapping.');
        } finally {
            setExtracting(false);
        }
    };

    const handleBulkUpload = async (e) => {
        e.preventDefault();
        if (!studentFiles || studentFiles.length === 0) return alert('Please select student answer sheets.');
        if (!grade || !exam || !subject) return alert('Please fill in Grade, Subject, and Exam.');
        
        setUploadingBulk(true);
        setUploadProgress(0);
        
        try {
            for (let i = 0; i < studentFiles.length; i++) {
                const original = studentFiles[i];
                const sId = original.name.replace(/\.[^/.]+$/, ""); // Use filename as student ID
                const f = await toImageIfPdf(original); // PDFs → image so AI sees real layout

                const formData = new FormData();
                formData.append('student_id', sId);
                formData.append('grade', grade);
                formData.append('exam', exam);
                formData.append('subject', subject);
                formData.append('assignment_id', assignmentId);
                formData.append('script', f);

                await api.post('/scripts/upload', formData);
                setUploadProgress(Math.round(((i + 1) / studentFiles.length) * 100));
            }
            alert('All student sheets successfully submitted for grading!');
            navigate('/dashboard'); // Go back to dashboard to see results
        } catch (err) {
            alert('An error occurred during bulk upload.');
        } finally {
            setUploadingBulk(false);
        }
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease', maxWidth: '800px', margin: '0 auto' }}>
            <div className="dashboard-header" style={{ marginBottom: '2rem' }}>
                <button onClick={() => navigate('/dashboard')} className="btn btn-secondary" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ArrowLeft size={18} /> Back to Dashboard
                </button>
                <h2 style={{ margin: 0, fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <CheckSquare size={32} color="var(--primary)" /> Bulk MCQ Grader
                </h2>
                <p style={{ color: 'var(--text-muted)' }}>Automated grading for Multiple Choice Questions.</p>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ flex: 1, padding: '1rem', background: step >= 1 ? 'var(--primary)' : 'var(--surface)', color: step >= 1 ? 'white' : 'var(--text-muted)', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold' }}>1. Master Key</div>
                <div style={{ flex: 1, padding: '1rem', background: step >= 2 ? 'var(--primary)' : 'var(--surface)', color: step >= 2 ? 'white' : 'var(--text-muted)', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold' }}>2. Verify</div>
                <div style={{ flex: 1, padding: '1rem', background: step >= 3 ? 'var(--primary)' : 'var(--surface)', color: step >= 3 ? 'white' : 'var(--text-muted)', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold' }}>3. Bulk Upload</div>
            </div>

            <div className="card">
                {step === 1 && (
                    <form onSubmit={handleExtractKey}>
                        <h3>Upload Master Answer Sheet</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Upload a picture or PDF of the correct answer key. The AI will extract the answers automatically.</p>
                        
                        <div className="form-group">
                            <label className="form-label">Master Key File</label>
                            <input
                                type="file"
                                className="form-input"
                                accept=".pdf, .jpg, .jpeg, .png"
                                onChange={(e) => setMasterFile(e.target.files[0])}
                                required
                            />
                        </div>
                        
                        <button type="submit" className="btn btn-primary" disabled={extracting} style={{ width: '100%' }}>
                            <UploadCloud size={20} /> {extracting ? 'Extracting Key...' : 'Extract Answers'}
                        </button>
                    </form>
                )}

                {step === 2 && (
                    <div>
                        <h3>Verify Extracted Key</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Review the extracted answers. Make corrections if the AI missed anything.</p>
                        
                        <div className="form-group">
                            <label className="form-label">Quiz Title</label>
                            <input type="text" className="form-input" value={assignmentTitle} onChange={(e) => setAssignmentTitle(e.target.value)} />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Total Marks for this Quiz</label>
                            <input type="number" className="form-input" value={totalMarks} onChange={(e) => setTotalMarks(Number(e.target.value))} />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Extracted Answers (Edit if needed)</label>
                            <textarea 
                                className="form-input" 
                                rows="10" 
                                value={extractedKey} 
                                onChange={(e) => setExtractedKey(e.target.value)}
                                style={{ fontFamily: 'monospace' }}
                            ></textarea>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button onClick={() => setStep(1)} className="btn btn-secondary" style={{ flex: 1 }}>Back</button>
                            <button onClick={handleCreateAssignment} className="btn btn-primary" disabled={extracting} style={{ flex: 2 }}>
                                {extracting ? 'Saving...' : 'Confirm & Proceed'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <form onSubmit={handleBulkUpload}>
                        <h3>Upload Student Answer Sheets</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Select all the student answer sheets. The filenames will be used as their Student IDs.</p>

                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Grade</label>
                                <select className="form-input" value={grade} onChange={(e) => setGrade(e.target.value)} required>
                                    <option value="" disabled>Select...</option>
                                    {grades.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Subject</label>
                                <select className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} required>
                                    <option value="" disabled>Select...</option>
                                    {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Exam</label>
                                <select className="form-input" value={exam} onChange={(e) => setExam(e.target.value)} required>
                                    <option value="" disabled>Select...</option>
                                    {exams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Student Files (Bulk Select)</label>
                            <input
                                type="file"
                                className="form-input"
                                accept=".pdf, .jpg, .jpeg, .png"
                                multiple
                                onChange={(e) => setStudentFiles(e.target.files)}
                                required
                            />
                            <small style={{ color: 'var(--text-muted)' }}>You can select multiple files at once.</small>
                        </div>

                        {uploadingBulk && (
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Uploading & Queuing...</span>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{uploadProgress}%</span>
                                </div>
                                <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--primary)', transition: 'width 0.3s ease' }}></div>
                                </div>
                            </div>
                        )}

                        <button type="submit" className="btn btn-primary" disabled={uploadingBulk} style={{ width: '100%' }}>
                            <Layers size={20} /> {uploadingBulk ? 'Processing...' : `Upload & Mark ${studentFiles ? studentFiles.length : 0} Papers`}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

export default MCQGrader;
