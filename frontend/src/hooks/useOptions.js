import { useState, useEffect, useCallback } from 'react';
import api from '../api';

// Loads the teacher-managed Grade / Subject / Exam lists. Components that only
// need to populate dropdowns can read the string arrays (grades/subjects/exams);
// the management UI uses the raw {id, value} objects and `refresh`.
export function useOptions() {
    const [raw, setRaw] = useState({ grades: [], subjects: [], exams: [] });

    const refresh = useCallback(async () => {
        try {
            const res = await api.get('/options');
            setRaw({
                grades: res.data.grades || [],
                subjects: res.data.subjects || [],
                exams: res.data.exams || [],
            });
        } catch (err) {
            console.error('Failed to load options', err);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    return {
        raw,
        grades: raw.grades.map(o => o.value),
        subjects: raw.subjects.map(o => o.value),
        exams: raw.exams.map(o => o.value),
        refresh,
    };
}

export default useOptions;
