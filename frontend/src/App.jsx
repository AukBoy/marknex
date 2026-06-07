import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { HelpCircle, Moon, Sun, Menu, X } from 'lucide-react';
import Login from './components/Login';
import TourGuide from './components/TourGuide';
import Sidebar from './components/Sidebar';
import VoiceAssistant from './components/VoiceAssistant';
import ToastContainer from './components/ToastContainer';
import KeyboardShortcuts from './components/KeyboardShortcuts';

// Route screens are code-split: each loads its own chunk on demand, so the
// initial bundle stays small and pages load fast (esp. on mobile / free tier).
const Dashboard          = lazy(() => import('./components/Dashboard'));
const ReviewPanel        = lazy(() => import('./components/ReviewPanel'));
const Report             = lazy(() => import('./components/Report'));
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const ClassReport        = lazy(() => import('./components/ClassReport'));
const Settings           = lazy(() => import('./components/Settings'));
const AssignmentManager  = lazy(() => import('./components/AssignmentManager'));
const MCQGrader          = lazy(() => import('./components/MCQGrader'));
const EssayGrader        = lazy(() => import('./components/EssayGrader'));
const AgreementDashboard = lazy(() => import('./components/AgreementDashboard'));
const ManagementHub      = lazy(() => import('./components/ManagementHub'));
const PaperGenerator     = lazy(() => import('./components/PaperGenerator'));
const TeacherTools       = lazy(() => import('./components/TeacherTools'));
const StudentPortal      = lazy(() => import('./components/StudentPortal'));
const QuizMaker          = lazy(() => import('./components/QuizMaker'));

// Shown while a route chunk is loading.
function PageLoader() {
    return (
        <div className="page-loader">
            <div className="spinner" />
            <span>Loading…</span>
        </div>
    );
}
import { useDarkMode } from './hooks/useDarkMode';
import './index.css';

const TOUR_SEEN_KEY = 'marknex_tour_seen';

function App() {
  const [auth, setAuth] = useState(false);
  const [role, setRole] = useState(localStorage.getItem('role') || 'Teacher');
  const [showTour, setShowTour] = useState(false);
  const [navOpen, setNavOpen] = useState(false);   // mobile drawer
  const { isDark, toggle: toggleDarkMode } = useDarkMode();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) setAuth(true);
  }, []);

  const handleLogin = (token, isNewUser = false, userRole = 'Teacher') => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', userRole);
    setRole(userRole);
    setAuth(true);
    // Students don't get the teacher onboarding tour.
    if (userRole !== 'Student' && (isNewUser || !localStorage.getItem(TOUR_SEEN_KEY))) {
      setShowTour(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    setAuth(false);
    setRole('Teacher');
    setShowTour(false);
  };

  const isStudent = auth && role === 'Student';

  const finishTour = () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    setShowTour(false);
  };

  const replayTour = () => setShowTour(true);

  // Students get a dedicated portal — no teacher sidebar, tools, or routes.
  if (isStudent) {
    return (
      <div className="app-container">
        <Suspense fallback={<PageLoader />}>
          <StudentPortal onLogout={handleLogout} />
        </Suspense>
        <ToastContainer />
      </div>
    );
  }

  return (
    <Router>
      <div className="app-container">
        <header className="glass-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {auth && (
              <button
                className="nav-hamburger"
                onClick={() => setNavOpen(o => !o)}
                aria-label="Menu">
                {navOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            )}
            <h1 className="logo-text">MarkNex</h1>
          </div>
          {auth && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={toggleDarkMode}
                className="logout-button gap-hover"
                title={isDark ? "Light mode" : "Dark mode"}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                onClick={replayTour}
                className="logout-button gap-hover"
                title="Replay the guided tour"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <HelpCircle size={18} /> Tour
              </button>
              <button onClick={handleLogout} className="logout-button gap-hover">
                Logout
              </button>
            </div>
          )}
        </header>

        <div className="app-body">
          {auth && <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />}
          {auth && navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
          <main className="main-content">
          <Suspense fallback={<PageLoader />}>
          <Routes>
        <Route path="/" element={!auth ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" />} />
            <Route path="/dashboard" element={auth ? <Dashboard /> : <Navigate to="/" />} />
            <Route path="/review/:id" element={auth ? <ReviewPanel /> : <Navigate to="/" />} />
            <Route path="/report/:id" element={auth ? <Report /> : <Navigate to="/" />} />
            <Route path="/class-report" element={auth ? <ClassReport /> : <Navigate to="/" />} />
            <Route path="/analytics" element={auth ? <AnalyticsDashboard /> : <Navigate to="/" />} />
            <Route path="/agreement" element={auth ? <AgreementDashboard /> : <Navigate to="/" />} />
            <Route path="/settings" element={auth ? <Settings /> : <Navigate to="/" />} />
            <Route path="/assignments" element={auth ? <AssignmentManager /> : <Navigate to="/" />} />
            <Route path="/mcq-grader" element={auth ? <MCQGrader /> : <Navigate to="/" />} />
            <Route path="/essay-grader" element={auth ? <EssayGrader /> : <Navigate to="/" />} />
            <Route path="/manage" element={auth ? <ManagementHub /> : <Navigate to="/" />} />
            <Route path="/generate" element={auth ? <PaperGenerator /> : <Navigate to="/" />} />
            <Route path="/tools" element={auth ? <TeacherTools /> : <Navigate to="/" />} />
            <Route path="/quizzes" element={auth ? <QuizMaker /> : <Navigate to="/" />} />
          </Routes>
          </Suspense>
          </main>
        </div>

        {auth && showTour && <TourGuide onClose={finishTour} />}
        {auth && role !== 'Student' && <VoiceAssistant />}
        <ToastContainer />
        <KeyboardShortcuts />
      </div>
    </Router>
  );
}

export default App;
