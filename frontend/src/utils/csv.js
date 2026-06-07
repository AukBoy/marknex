// CSV Export utility
export function downloadCSV(filename, headers, rows) {
    const csv = [
        headers.join(','),
        ...rows.map(row => headers.map(h => {
            const val = row[h];
            // Escape quotes and wrap in quotes if contains comma
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val || '';
        }).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// CSV Import utility
export function parseCSV(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const csv = e.target.result;
                const lines = csv.split('\n').filter(line => line.trim());
                if (lines.length < 2) {
                    reject(new Error('CSV must have at least headers and one data row'));
                    return;
                }

                // Parse headers
                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

                // Parse rows
                const rows = [];
                for (let i = 1; i < lines.length; i++) {
                    // Simple CSV parsing (handles basic cases)
                    const values = parseCSVLine(lines[i]);
                    if (values.length > 0 && values.some(v => v.trim())) { // Skip empty rows
                        const row = {};
                        headers.forEach((header, idx) => {
                            row[header] = values[idx]?.trim() || '';
                        });
                        rows.push(row);
                    }
                }

                resolve({ headers, rows });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

// Helper to parse CSV line (handles quoted values)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current);
    return result;
}

// Export grades as CSV
export function exportGradesCSV(scripts, filename = 'grades.csv') {
    const headers = ['Student ID', 'Name', 'Grade', 'Subject', 'Exam', 'Marks', 'Max Marks', 'Percentage', 'Confidence', 'Status', 'Upload Date'];
    const rows = scripts
        .filter(s => !s.is_deleted && s.status !== 'Pending')
        .map(s => ({
            'Student ID': s.student_id,
            'Name': s.student_id,
            'Grade': s.grade || '',
            'Subject': s.subject || '',
            'Exam': s.exam || '',
            'Marks': s.total_marks || 0,
            'Max Marks': s.max_marks || 10,
            'Percentage': s.max_marks ? ((s.total_marks || 0) / s.max_marks * 100).toFixed(1) : '0',
            'Confidence': s.confidence_score || 0,
            'Status': s.status || 'Unknown',
            'Upload Date': s.upload_timestamp ? new Date(s.upload_timestamp).toLocaleDateString() : ''
        }));

    downloadCSV(filename, headers, rows);
}

// Export students roster as CSV
export function exportStudentsCSV(students, className, filename) {
    const headers = ['Student ID', 'Name', 'Email'];
    const rows = students.map(s => ({
        'Student ID': s.student_id,
        'Name': s.name || '',
        'Email': s.email || ''
    }));

    downloadCSV(filename || `${className}_roster.csv`, headers, rows);
}

// Template for bulk student import
export function downloadStudentTemplate() {
    const template = 'student_id,name,email\nS001,John Doe,john@school.com\nS002,Jane Smith,jane@school.com';
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'students_template.csv';
    link.click();
}
