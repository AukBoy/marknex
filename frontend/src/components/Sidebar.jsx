import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, Edit3, BookOpen, Award, BarChart2, Scale, Settings, Grid3x3, ClipboardList, GraduationCap, PenTool, Brain } from 'lucide-react';

// Persistent left navigation for the authenticated app. Each item links to a
// route and carries the same data-tour anchors the voice tour spotlights, so
// onboarding keeps working now that navigation lives in the sidebar.
const NAV = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/mcq-grader', label: 'Bulk MCQ Grader', icon: CheckSquare, tour: 'mcq' },
    { to: '/essay-grader', label: 'Bulk Essay Grader', icon: Edit3, tour: 'essay' },
    { to: '/assignments', label: 'Manage Assignments', icon: BookOpen, tour: 'assignments' },
    { to: '/generate', label: 'Generate Papers', icon: ClipboardList },
    { to: '/quizzes', label: 'Online Quizzes', icon: PenTool },
    { to: '/tools', label: 'Teacher Tools', icon: GraduationCap },
    { to: '/class-report', label: 'Class Reports', icon: Award, tour: 'reports' },
    { to: '/insights', label: 'AI Insights', icon: Brain },
    { to: '/analytics', label: 'Analytics', icon: BarChart2, tour: 'analytics' },
    { to: '/agreement', label: 'AI vs Teacher', icon: Scale },
    { to: '/manage', label: 'Manage Everything', icon: Grid3x3 },
    { to: '/settings', label: 'Settings', icon: Settings, tour: 'settings' },
];

function Sidebar({ open = false, onClose = () => {} }) {
    return (
        <aside className={'sidebar' + (open ? ' open' : '')}>
            <p className="sidebar-heading">Menu</p>
            <nav className="sidebar-nav">
                {NAV.map(({ to, label, icon: Icon, tour }) => (
                    <NavLink
                        key={to}
                        to={to}
                        data-tour={tour}
                        onClick={onClose}
                        className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
                    >
                        <Icon size={19} />
                        <span>{label}</span>
                    </NavLink>
                ))}
            </nav>
        </aside>
    );
}

export default Sidebar;
