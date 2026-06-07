const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'marknex.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Create tables
        db.serialize(() => {
            // Enforce referential integrity (off by default in SQLite) and use
            // WAL so background AI writes don't block dashboard reads.
            db.run('PRAGMA foreign_keys = ON');
            db.run('PRAGMA journal_mode = WAL');

            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                role TEXT
            )`);

            // Assignments table
            db.run(`CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                title TEXT,
                description TEXT,
                total_max_marks INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id)
            )`);

            // Questions table
            db.run(`CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER,
                q_num TEXT,
                max_marks INTEGER,
                rubric TEXT,
                FOREIGN KEY (assignment_id) REFERENCES assignments(id)
            )`);

            // Scripts table (Answer Scripts)
            db.run(`CREATE TABLE IF NOT EXISTS scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                assignment_id INTEGER,
                student_id TEXT,
                filename TEXT,
                filepath TEXT,
                upload_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'Pending',
                total_marks INTEGER,
                max_marks INTEGER DEFAULT 10,
                confidence_score REAL,
                flags TEXT,
                report TEXT,
                corrections TEXT,
                is_deleted INTEGER DEFAULT 0,
                grade TEXT,
                exam TEXT,
                subject TEXT,
                question_analysis TEXT,
                FOREIGN KEY (teacher_id) REFERENCES users(id),
                FOREIGN KEY (assignment_id) REFERENCES assignments(id)
            )`);

            // Add max_marks column to existing databases that don't have it yet
            db.run(`ALTER TABLE scripts ADD COLUMN max_marks INTEGER DEFAULT 10`, () => {});

            // Research/validation columns: snapshot the AI's original grade so we
            // can measure human-vs-AI agreement after a teacher reviews/edits it.
            // (ALTER fails harmlessly if the column already exists.)
            db.run(`ALTER TABLE scripts ADD COLUMN ai_total_marks INTEGER`, () => {});
            db.run(`ALTER TABLE scripts ADD COLUMN ai_confidence REAL`, () => {});
            db.run(`ALTER TABLE scripts ADD COLUMN reviewed_at DATETIME`, () => {});

            // Settings table
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`, () => {
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('confidence_threshold', '75')`);
            });

            // Classes: a teacher's classroom roster (e.g., "Grade 10 Math A").
            db.run(`CREATE TABLE IF NOT EXISTS classes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                name TEXT,
                grade TEXT,
                subject TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id),
                UNIQUE(teacher_id, name)
            )`);

            // Students: per-class roster. A student has a name/ID and belongs to one class.
            db.run(`CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id INTEGER,
                student_id TEXT,
                name TEXT,
                email TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id),
                UNIQUE(class_id, student_id)
            )`);

            // Student login credentials. A teacher creates an account for a student;
            // the student then logs in and sees only their own results/attendance.
            // (ALTER fails harmlessly if the column already exists.)
            db.run(`ALTER TABLE students ADD COLUMN username TEXT`, () => {});
            db.run(`ALTER TABLE students ADD COLUMN password TEXT`, () => {});
            db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(username) WHERE username IS NOT NULL`);

            // Exams: per-class assessments (e.g., "Term 1 Final", "Unit Test 3").
            db.run(`CREATE TABLE IF NOT EXISTS exams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id INTEGER,
                title TEXT,
                description TEXT,
                exam_date DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id)
            )`);

            // Teacher-managed dropdown options (Grade / Subject / Exam). Each
            // teacher can add, rename and remove their own values; defaults are
            // seeded on first fetch (see GET /api/options).
            db.run(`CREATE TABLE IF NOT EXISTS options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                type TEXT,
                value TEXT,
                sort_order INTEGER DEFAULT 0,
                UNIQUE(teacher_id, type, value),
                FOREIGN KEY (teacher_id) REFERENCES users(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_options_teacher ON options(teacher_id, type)`);

            // Subject Contexts: stores extracted curriculum content from uploaded
            // notebooks/syllabuses. Matched by (grade, subject) and injected into
            // the grading prompt so the AI grades against the teacher's own syllabus.
            db.run(`CREATE TABLE IF NOT EXISTS subject_contexts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                grade TEXT,
                subject TEXT,
                label TEXT,
                filename TEXT,
                content TEXT,
                topics TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_contexts_teacher ON subject_contexts(teacher_id, grade, subject)`);

            // Fine-tuning export: every reviewed script can be exported as a
            // training example. This view makes that query fast.
            db.run(`CREATE VIEW IF NOT EXISTS fine_tuning_examples AS
                SELECT s.id, s.student_id, s.subject, s.grade, s.exam,
                       s.total_marks, s.max_marks, s.confidence_score,
                       s.report, s.question_analysis,
                       u.username AS teacher
                FROM scripts s
                JOIN users u ON s.teacher_id = u.id
                WHERE s.reviewed_at IS NOT NULL
                  AND s.is_deleted = 0`);

            // Indexes for the columns every query filters/sorts on.
            // Generated exam papers — created from textbook contexts by the AI.
            db.run(`CREATE TABLE IF NOT EXISTS generated_papers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                context_id INTEGER,
                title TEXT,
                grade TEXT,
                subject TEXT,
                config TEXT,
                paper TEXT,
                answer_key TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id),
                FOREIGN KEY (context_id) REFERENCES subject_contexts(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_papers_teacher ON generated_papers(teacher_id)`);

            // ── Attendance tracking ──────────────────────────────────────────
            db.run(`CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                class_id INTEGER,
                student_id INTEGER,
                date TEXT,
                status TEXT DEFAULT 'present',
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id),
                FOREIGN KEY (class_id) REFERENCES classes(id),
                FOREIGN KEY (student_id) REFERENCES students(id),
                UNIQUE(class_id, student_id, date)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance(class_id, date)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_teacher ON attendance(teacher_id)`);

            // ── Timetable ────────────────────────────────────────────────────
            db.run(`CREATE TABLE IF NOT EXISTS timetable_slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                day TEXT,
                period INTEGER,
                start_time TEXT,
                end_time TEXT,
                subject TEXT,
                grade TEXT,
                class_name TEXT,
                room TEXT,
                color TEXT DEFAULT '#4f46e5',
                FOREIGN KEY (teacher_id) REFERENCES users(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_slots(teacher_id)`);

            // ── Lesson Plans ─────────────────────────────────────────────────
            db.run(`CREATE TABLE IF NOT EXISTS lesson_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                title TEXT,
                grade TEXT,
                subject TEXT,
                topic TEXT,
                date TEXT,
                duration TEXT,
                plan TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_plans_teacher ON lesson_plans(teacher_id)`);

            // ── Online MCQ Quizzes ───────────────────────────────────────────
            db.run(`CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                class_id INTEGER,
                title TEXT,
                grade TEXT,
                subject TEXT,
                questions TEXT,
                time_limit INTEGER DEFAULT 0,
                is_published INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id),
                FOREIGN KEY (class_id) REFERENCES classes(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_quizzes_teacher ON quizzes(teacher_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_quizzes_class ON quizzes(class_id)`);

            // Quiz attempts — one row per student submission.
            db.run(`CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER,
                student_id INTEGER,
                answers TEXT,
                score INTEGER,
                total INTEGER,
                submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (quiz_id) REFERENCES quizzes(id),
                FOREIGN KEY (student_id) REFERENCES students(id),
                UNIQUE(quiz_id, student_id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON quiz_attempts(quiz_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_attempts_student ON quiz_attempts(student_id)`);

            // ── Notices (parent communication) ───────────────────────────────
            db.run(`CREATE TABLE IF NOT EXISTS notices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER,
                title TEXT,
                body TEXT,
                target_grade TEXT,
                target_class TEXT,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES users(id)
            )`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_notices_teacher ON notices(teacher_id)`);

            db.run(`CREATE INDEX IF NOT EXISTS idx_scripts_teacher ON scripts(teacher_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_scripts_assignment ON scripts(assignment_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_scripts_teacher_timestamp ON scripts(teacher_id, upload_timestamp)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_questions_assignment ON questions(assignment_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments(teacher_id)`);
        });
    }
});

module.exports = db;
