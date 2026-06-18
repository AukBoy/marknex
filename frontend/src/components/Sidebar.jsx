import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, Edit3, BookOpen, Award, BarChart2, Scale, Settings, Grid3x3, ClipboardList, GraduationCap, PenTool, Brain } from 'lucide-react';

// Persistent left navigation for the authenticated app. Items are grouped into
// labelled sections so the 13 destinations are scannable instead of one long
// flat list. Each item keeps its data-tour anchor so onboarding still works.
const SECTIONS = [
    {
        heading: null, // top-level, no label
        items: [
            { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        ],
    },
    {
        heading: 'Grading',
        items: [
            { to: '/mcq-grader', label: 'Bulk MCQ Grader', icon: CheckSquare, tour: 'mcq' },
            { to: '/essay-grader', label: 'Bulk Essay Grader', icon: Edit3, tour: 'essay' },
            { to: '/assignments', label: 'Manage Assignments', icon: BookOpen, tour: 'assignments' },
        ],
    },
    {
        heading: 'Create',
        items: [
            { to: '/generate', label: 'Generate Papers', icon: ClipboardList },
            { to: '/quizzes', label: 'Online Quizzes', icon: PenTool },
            { to: '/tools', label: 'Teacher Tools', icon: GraduationCap },
        ],
    },
    {
        heading: 'Reports & Insights',
        items: [
            { to: '/class-report', label: 'Class Reports', icon: Award, tour: 'reports' },
            { to: '/analytics', label: 'Analytics', icon: BarChart2, tour: 'analytics' },
            { to: '/insights', label: 'AI Insights', icon: Brain },
            { to: '/agreement', label: 'AI vs Teacher', icon: Scale },
        ],
    },
    {
        heading: 'System',
        items: [
            { to: '/manage', label: 'Manage Everything', icon: Grid3x3 },
            { to: '/settings', label: 'Settings', icon: Settings, tour: 'settings' },
        ],
    },
];

function Sidebar({ open = false, onClose = () => {} }) {
    return (
        <aside className={'sidebar' + (open ? ' open' : '')}>
            {SECTIONS.map((section, i) => (
                <div key={section.heading || 'top'} className="sidebar-section">
                    {section.heading && <p className="sidebar-heading">{section.heading}</p>}
                    <nav className="sidebar-nav">
                        {section.items.map(({ to, label, icon: Icon, tour }) => (
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
                </div>
            ))}
        </aside>
    );
}

export default Sidebar;
