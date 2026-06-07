import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { HelpCircle, Moon, Sun } from 'lucide-react';
import Login from './components/Login';
import TourGuide from './components/TourGuide';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ReviewPanel from './components/ReviewPanel';
import Report from './components/Report';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import ClassReport from './components/ClassReport';
import Settings from './components/Settings';
import AssignmentManager from './components/AssignmentManager';
import MCQGrader from './components/MCQGrader';
import EssayGrader from './components/EssayGrader';
import AgreementDashboard from './components/AgreementDashboard';
import ManagementHub from './components/ManagementHub';
import PaperGenerator from './components/PaperGenerator';
import TeacherTools from './components/TeacherTools';
import StudentPortal from './components/StudentPortal';
import QuizMaker from './components/QuizMaker';
import ToastContainer from './components/ToastContainer';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import { useDarkMode } from './hooks/useDarkMode';
import './index.css';

const TOUR_SEEN_KEY = 'marknex_tour_seen';

function App() {
  const [auth, setAuth] = useState(false);
  const [role, setRole] = useState(localStorage.getItem('role') || 'Teacher');
  const [showTour, setShowTour] = useState(false);
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
        <StudentPortal onLogout={handleLogout} />
        <ToastContainer />
      </div>
    );
  }

  return (
    <Router>
      <div className="app-container">
        <header className="glass-header">
          <h1 className="logo-text">MarkNex</h1>
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
          {auth && <Sidebar />}
          <main className="main-content">
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
          </main>
        </div>

        {auth && showTour && <TourGuide onClose={finishTour} />}
        <ToastContainer />
        <KeyboardShortcuts />
      </div>
    </Router>
  );
}

export default App;
