import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';
import { API_BASE } from '../api';

// Voice-guided onboarding tour. An animated assistant ("Max") spotlights each
// part of the dashboard and narrates it with the browser's SpeechSynthesis API
// (free, offline, no API key). Triggered for first-time users after signup.

// Animated face for the voice agent: gradient head, eyes that blink on a loop,
// and a mouth that flaps open/closed while `speaking` is true so it visibly
// "talks" along with the narration.
function AgentFace({ size = 88, speaking = false }) {
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 ${size * 0.13}px ${size * 0.34}px -${size * 0.07}px rgba(79, 70, 229, 0.5)`,
        }}>
            <svg viewBox="0 0 100 100" width={size * 0.7} height={size * 0.7} aria-hidden="true">
                {/* Eyes (blink as a group) */}
                <g style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'agentBlink 4.2s ease-in-out infinite' }}>
                    <circle cx="34" cy="42" r="7.5" fill="white" />
                    <circle cx="66" cy="42" r="7.5" fill="white" />
                    <circle cx="36" cy="43.5" r="3.2" fill="#1e1b4b" />
                    <circle cx="68" cy="43.5" r="3.2" fill="#1e1b4b" />
                </g>
                {/* Mouth: animates while talking, otherwise a calm closed line */}
                <ellipse cx="50" cy="70" rx="13" ry="8" fill="white" style={{
                    transformBox: 'fill-box', transformOrigin: 'center',
                    transform: speaking ? undefined : 'scaleY(0.16)',
                    animation: speaking ? 'agentTalk 0.42s ease-in-out infinite' : 'none',
                }} />
            </svg>
        </div>
    );
}

// The element each step spotlights (shared across all languages). `null` = no
// spotlight (the centred welcome/finish cards).
const SELECTORS = [
    null,
    '[data-tour="upload"]',
    '[data-tour="upload"]',
    '[data-tour="file"]',
    '[data-tour="process"]',
    '[data-tour="mcq"]',
    '[data-tour="essay"]',
    '[data-tour="assignments"]',
    '[data-tour="reports"]',
    '[data-tour="analytics"]',
    '[data-tour="settings"]',
    '[data-tour="evaluations"]',
    null,
];

// Languages Max can speak. `speech` is the BCP-47 tag handed to SpeechSynthesis.
const LANGS = {
    en: { label: 'English', speech: 'en-US' },
    si: { label: 'සිංහල', speech: 'si-LK' },
    ta: { label: 'தமிழ்', speech: 'ta-IN' },
};

// Per-language narration. Each array is index-aligned with SELECTORS above.
const CONTENT = {
    en: [
        { title: "Hi, I'm Max! 👋", text: "Welcome to MarkNex! I'm Max, your AI assistant. Let me give you a quick tour of how to grade your students' papers automatically. You can listen along, or click Next to move at your own pace." },
        { title: 'Upload a Script', text: "This is where it all starts. Upload a scanned answer script here and the AI will read it and grade it for you." },
        { title: 'Pick the Details', text: "First, choose the Grade, Subject and Exam for the paper. You can also link it to a marking scheme so the AI grades against your rubric." },
        { title: 'Choose the File', text: "Then select the scanned file — a PDF, JPG or PNG. You can even pick several files at once for batch grading." },
        { title: 'Let the AI Grade', text: "Press Process with AI. MarkNex reads the answers, assigns marks, and flags anything it's unsure about for your review." },
        { title: 'Bulk MCQ Grader', text: "Got a multiple-choice test? Use the Bulk MCQ Grader. Upload the answer key once, then grade the whole class in seconds." },
        { title: 'Bulk Essay Grader', text: "For written answers, the Bulk Essay Grader lets you define a rubric and grade every student's essay against it." },
        { title: 'Manage Assignments', text: "Here you set up reusable marking schemes and rubrics for your tests, so the AI knows exactly how to mark." },
        { title: 'Class Reports', text: "Class Reports give you a ranked leaderboard and class averages for any grade and exam." },
        { title: 'View Analytics', text: "Analytics shows class performance and reveals which questions your students struggled with the most." },
        { title: 'Settings', text: "In Settings you can adjust the AI confidence threshold — how sure the AI must be before a result skips manual review." },
        { title: 'Your Results', text: "All your graded papers appear here. Green means done; red means the AI would like you to double-check it." },
        { title: "You're All Set! 🎉", text: "That's the tour! You're ready to grade your first paper. You can replay this tour anytime from the help button. Happy grading!" },
    ],
    si: [
        { title: "ආයුබෝවන්, මම Max! 👋", text: "MarkNex වෙත සාදරයෙන් පිළිගනිමු! මම Max, ඔබේ AI සහායකයා. ඔබේ සිසුන්ගේ පිළිතුරු පත්‍ර ස්වයංක්‍රීයව ලකුණු කරන ආකාරය ගැන කෙටි හැඳින්වීමක් ලබා දෙන්නම්. ඔබට අසා සිටිය හැකිය, නැතහොත් ඔබේම වේගයෙන් ඉදිරියට යාමට Next ඔබන්න." },
        { title: 'පිළිතුරු පත්‍රයක් උඩුගත කරන්න', text: "සියල්ල ආරම්භ වන්නේ මෙතැනින්. ස්කෑන් කළ පිළිතුරු පත්‍රයක් මෙහි උඩුගත කරන්න, AI එය කියවා ඔබ වෙනුවෙන් ලකුණු කරයි." },
        { title: 'විස්තර තෝරන්න', text: "මුලින්ම, පත්‍රය සඳහා ශ්‍රේණිය, විෂයය සහ විභාගය තෝරන්න. AI ඔබේ ලකුණු කිරීමේ රීතියට අනුව ලකුණු කිරීමට ලකුණු දීමේ සැලැස්මකට ද සම්බන්ධ කළ හැකිය." },
        { title: 'ගොනුව තෝරන්න', text: "ඉන්පසු ස්කෑන් කළ ගොනුව තෝරන්න — PDF, JPG හෝ PNG. කණ්ඩායම් ලෙස ලකුණු කිරීම සඳහා ඔබට එකවර ගොනු කිහිපයක් ද තේරිය හැකිය." },
        { title: 'AI ට ලකුණු දීමට ඉඩ දෙන්න', text: "Process with AI ඔබන්න. MarkNex පිළිතුරු කියවා, ලකුණු ලබා දී, විශ්වාස නැති ඕනෑම දෙයක් ඔබේ සමාලෝචනය සඳහා සලකුණු කරයි." },
        { title: 'තොග MCQ ලකුණු කිරීම', text: "බහුවරණ පරීක්ෂණයක් තිබේද? තොග MCQ ලකුණු කිරීම භාවිතා කරන්න. පිළිතුරු යතුර එක් වරක් උඩුගත කර, මුළු පන්තියම තත්පර කිහිපයකින් ලකුණු කරන්න." },
        { title: 'තොග රචනා ලකුණු කිරීම', text: "ලිඛිත පිළිතුරු සඳහා, තොග රචනා ලකුණු කිරීම මගින් ඔබට රීතියක් නිර්වචනය කර සෑම සිසුවෙකුගේම රචනාව ඊට අනුව ලකුණු කළ හැකිය." },
        { title: 'පැවරුම් කළමනාකරණය', text: "මෙහිදී ඔබ ඔබේ පරීක්ෂණ සඳහා නැවත භාවිතා කළ හැකි ලකුණු දීමේ සැලසුම් සහ රීති සකසයි, එවිට AI ලකුණු කරන ආකාරය හරියටම දනී." },
        { title: 'පන්ති වාර්තා', text: "පන්ති වාර්තා මගින් ඕනෑම ශ්‍රේණියක් සහ විභාගයක් සඳහා ශ්‍රේණිගත නායකත්ව ලැයිස්තුවක් සහ පන්ති සාමාන්‍ය ලබා දෙයි." },
        { title: 'විශ්ලේෂණ බලන්න', text: "විශ්ලේෂණ මගින් පන්තියේ කාර්ය සාධනය පෙන්වන අතර ඔබේ සිසුන් වැඩිපුරම අපහසු වූ ප්‍රශ්න මොනවාද යන්න හෙළි කරයි." },
        { title: 'සැකසුම්', text: "සැකසුම් තුළ ඔබට AI විශ්වාසනීයත්ව සීමාව සකස් කළ හැකිය — ප්‍රතිඵලයක් අතින් සමාලෝචනය මඟ හැරීමට පෙර AI කොතරම් විශ්වාස විය යුතුද යන්න." },
        { title: 'ඔබේ ප්‍රතිඵල', text: "ඔබ ලකුණු කළ සියලුම පත්‍ර මෙහි දිස්වේ. කොළ පැහැය යනු අවසන්; රතු පැහැය යනු AI ඔබට එය නැවත පරීක්ෂා කිරීමට කැමති බවයි." },
        { title: "ඔබ සූදානම්! 🎉", text: "ඒක තමයි චාරිකාව! ඔබේ පළමු පත්‍රය ලකුණු කිරීමට ඔබ සූදානම්. උදව් බොත්තමෙන් ඕනෑම වේලාවක මෙම චාරිකාව නැවත බැලිය හැකිය. ලකුණු දීම සුබම වේවා!" },
    ],
    ta: [
        { title: "வணக்கம், நான் Max! 👋", text: "MarkNex க்கு வரவேற்கிறோம்! நான் Max, உங்கள் AI உதவியாளர். உங்கள் மாணவர்களின் விடைத்தாள்களை தானாகவே மதிப்பிடுவது எப்படி என்பதை விரைவாக சுற்றிக் காட்டுகிறேன். நீங்கள் கேட்டுக்கொண்டே இருக்கலாம், அல்லது உங்கள் சொந்த வேகத்தில் செல்ல Next ஐ அழுத்தவும்." },
        { title: 'விடைத்தாளைப் பதிவேற்றவும்', text: "எல்லாம் இங்கேதான் தொடங்குகிறது. ஸ்கேன் செய்த விடைத்தாளை இங்கே பதிவேற்றவும், AI அதைப் படித்து உங்களுக்காக மதிப்பிடும்." },
        { title: 'விவரங்களைத் தேர்வுசெய்க', text: "முதலில், தாளுக்கான வகுப்பு, பாடம் மற்றும் தேர்வைத் தேர்வுசெய்க. உங்கள் மதிப்பீட்டு விதிமுறையின்படி AI மதிப்பிட ஒரு மதிப்பெண் திட்டத்துடனும் இணைக்கலாம்." },
        { title: 'கோப்பைத் தேர்வுசெய்க', text: "பின்னர் ஸ்கேன் செய்த கோப்பைத் தேர்வுசெய்க — PDF, JPG அல்லது PNG. தொகுதி மதிப்பீட்டிற்கு ஒரே நேரத்தில் பல கோப்புகளையும் தேர்வுசெய்யலாம்." },
        { title: 'AI மதிப்பிட விடுங்கள்', text: "Process with AI ஐ அழுத்தவும். MarkNex விடைகளைப் படித்து, மதிப்பெண்களை வழங்கி, உறுதியில்லாத எதையும் உங்கள் மறுஆய்வுக்காகக் குறிக்கும்." },
        { title: 'மொத்த MCQ மதிப்பீடு', text: "பல தேர்வு வினாத்தாள் உள்ளதா? மொத்த MCQ மதிப்பீட்டைப் பயன்படுத்தவும். விடைக் குறியீட்டை ஒருமுறை பதிவேற்றி, முழு வகுப்பையும் சில நொடிகளில் மதிப்பிடவும்." },
        { title: 'மொத்த கட்டுரை மதிப்பீடு', text: "எழுத்து விடைகளுக்கு, மொத்த கட்டுரை மதிப்பீடு ஒரு விதிமுறையை வரையறுத்து ஒவ்வொரு மாணவரின் கட்டுரையையும் அதற்கேற்ப மதிப்பிட உதவுகிறது." },
        { title: 'பணிகளை நிர்வகிக்கவும்', text: "இங்கே உங்கள் தேர்வுகளுக்கு மீண்டும் பயன்படுத்தக்கூடிய மதிப்பெண் திட்டங்களையும் விதிமுறைகளையும் அமைக்கிறீர்கள், இதனால் AI எப்படி மதிப்பிடுவது என்பதைச் சரியாக அறியும்." },
        { title: 'வகுப்பு அறிக்கைகள்', text: "வகுப்பு அறிக்கைகள் எந்த வகுப்பு மற்றும் தேர்வுக்கும் தரவரிசை பட்டியலையும் வகுப்பு சராசரிகளையும் வழங்குகின்றன." },
        { title: 'பகுப்பாய்வைக் காண்க', text: "பகுப்பாய்வு வகுப்பின் செயல்திறனைக் காட்டுகிறது, மேலும் உங்கள் மாணவர்கள் எந்த வினாக்களில் அதிகம் சிரமப்பட்டார்கள் என்பதை வெளிப்படுத்துகிறது." },
        { title: 'அமைப்புகள்', text: "அமைப்புகளில் AI நம்பகத்தன்மை வரம்பைச் சரிசெய்யலாம் — ஒரு முடிவு கைமுறை மறுஆய்வைத் தவிர்ப்பதற்கு முன் AI எவ்வளவு உறுதியாக இருக்க வேண்டும் என்பது." },
        { title: 'உங்கள் முடிவுகள்', text: "நீங்கள் மதிப்பிட்ட அனைத்து தாள்களும் இங்கே தோன்றும். பச்சை என்றால் முடிந்தது; சிவப்பு என்றால் AI அதை மீண்டும் சரிபார்க்க விரும்புகிறது." },
        { title: "நீங்கள் தயார்! 🎉", text: "அதுதான் சுற்றுப்பயணம்! உங்கள் முதல் தாளை மதிப்பிட நீங்கள் தயார். உதவி பொத்தானில் இருந்து எந்த நேரத்திலும் இந்த சுற்றுப்பயணத்தை மீண்டும் பார்க்கலாம். மகிழ்ச்சியான மதிப்பீடு!" },
    ],
};

// Split a long narration into <=maxLen word-aligned pieces. Google's TTS
// endpoint only accepts short text (~200 chars) per request, so we read each
// chunk back-to-back.
function chunkText(text, maxLen = 180) {
    const out = [];
    let cur = '';
    for (const word of String(text).split(/\s+/)) {
        if (cur && (cur + ' ' + word).length > maxLen) { out.push(cur); cur = word; }
        else cur = cur ? cur + ' ' + word : word;
    }
    if (cur) out.push(cur);
    return out;
}

function TourGuide({ onClose }) {
    const [step, setStep] = useState(0);
    const [muted, setMuted] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [rect, setRect] = useState(null);
    const [started, setStarted] = useState(false);
    const [lang, setLang] = useState('en');
    const voicesRef = useRef([]);
    const audioRef = useRef(null); // <audio> used for online (Sinhala/Tamil) TTS

    const steps = CONTENT[lang];
    const current = { ...steps[step], selector: SELECTORS[step] };
    const isLast = step === steps.length - 1;

    // Load available speech voices (they populate asynchronously in some browsers).
    useEffect(() => {
        if (!('speechSynthesis' in window)) return;
        const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
        load();
        window.speechSynthesis.onvoiceschanged = load;
        return () => { window.speechSynthesis.onvoiceschanged = null; };
    }, []);

    // Stop any in-flight online TTS audio.
    const stopAudio = useCallback(() => {
        const a = audioRef.current;
        if (a) { a.onended = null; a.onerror = null; try { a.pause(); } catch { /* ignore */ } }
        audioRef.current = null;
    }, []);

    // Read text with an online TTS that supports the chosen language (used when
    // the OS has no local voice for it — e.g. Sinhala/Tamil on Windows). Plays
    // the narration chunk-by-chunk so longer passages aren't truncated.
    const speakOnline = useCallback((text, tl) => {
        const chunks = chunkText(text);
        if (!chunks.length) return;
        const a = new Audio();
        audioRef.current = a;
        setSpeaking(true);
        let i = 0;
        const playNext = () => {
            if (audioRef.current !== a) return;          // superseded by a newer call
            if (i >= chunks.length) { setSpeaking(false); audioRef.current = null; return; }
            const q = encodeURIComponent(chunks[i++]);
            // Same-origin proxy (see backend /api/tts) — avoids the browser's
            // ORB/CORS block on the public Google TTS endpoint.
            a.src = `${API_BASE}/api/tts?tl=${encodeURIComponent(tl)}&q=${q}`;
            a.play().catch(() => { if (audioRef.current === a) { setSpeaking(false); audioRef.current = null; } });
        };
        a.onended = playNext;
        a.onerror = () => { if (audioRef.current === a) { setSpeaking(false); audioRef.current = null; } };
        playNext();
    }, []);

    const speak = useCallback((text) => {
        // Cancel whatever is currently playing (either engine).
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        stopAudio();
        if (muted || !text) return;

        const speechLang = LANGS[lang].speech;          // e.g. 'si-LK'
        const prefix = speechLang.slice(0, 2).toLowerCase(); // e.g. 'si'
        const voices = ('speechSynthesis' in window)
            ? (voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices())
            : [];
        const localVoice =
            voices.find(v => v.lang && v.lang.toLowerCase().startsWith(prefix)) ||
            (lang === 'en'
                ? voices.find(v => /samantha|zira|jenny|aria|google us english|female/i.test(v.name)) ||
                  voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'))
                : null);

        // Use the offline browser voice only when one truly speaks this language.
        // Otherwise (Sinhala/Tamil with no installed voice) an English voice would
        // just mumble the Latin words and skip the script — so go online instead.
        if (localVoice && 'speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(text);
            u.rate = lang === 'en' ? 1 : 0.95; u.pitch = 1.05; u.lang = speechLang; u.voice = localVoice;
            u.onstart = () => setSpeaking(true);
            u.onend = () => setSpeaking(false);
            window.speechSynthesis.speak(u);
        } else {
            speakOnline(text, prefix);
        }
    }, [muted, lang, stopAudio, speakOnline]);

    // Position the spotlight on the current step's target and narrate it.
    useEffect(() => {
        if (!started) return;
        const updateRect = () => {
            if (current.selector) {
                const el = document.querySelector(current.selector);
                if (el) { setRect(el.getBoundingClientRect()); return; }
            }
            setRect(null);
        };
        if (current.selector) {
            const el = document.querySelector(current.selector);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const t = setTimeout(updateRect, 380);
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        speak(current.text);
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
        };
        // `current` is rebuilt each render, so depend on the primitives that
        // actually change the step/language instead of the object reference.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, started, lang, speak]);

    const stop = () => {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        stopAudio();
        setSpeaking(false);
    };

    const finish = () => { stop(); onClose(); };
    const next = () => { if (isLast) finish(); else setStep(s => s + 1); };
    const back = () => setStep(s => Math.max(0, s - 1));

    const toggleMute = () => {
        setMuted(m => {
            const nm = !m;
            if (nm) stop(); else speak(current.text);
            return nm;
        });
    };

    useEffect(() => () => stop(), []); // stop voice if unmounted

    // ── Welcome gate: the first click enables browser speech (user gesture) ──
    if (!started) {
        return (
            <div style={overlayStyle}>
                <div style={{ ...cardStyle, maxWidth: '440px', textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
                    <style>{faceKeyframes}</style>
                    <div style={{ width: 'fit-content', margin: '0 auto', animation: 'tourFloat 3s ease-in-out infinite' }}>
                        <AgentFace size={96} speaking={false} />
                    </div>
                    <h2 style={{ margin: '1.2rem 0 0.5rem', fontSize: '1.6rem' }}>Meet Max, your guide</h2>
                    <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.4rem' }}>
                        I'll walk you through MarkNex with a quick voice-guided tour.
                    </p>
                    <p style={{ color: 'var(--text-main)', fontWeight: 600, marginBottom: '1rem' }}>
                        Choose a language to begin:
                    </p>
                    {/* Each button picks the language AND starts the tour. The click is
                        the user gesture browsers require before speech can play. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.2rem' }}>
                        {Object.entries(LANGS).map(([code, { label }]) => (
                            <button
                                key={code}
                                onClick={() => { setLang(code); setStarted(true); }}
                                className="btn btn-primary"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1.05rem' }}
                            >
                                <Sparkles size={18} /> {label}
                            </button>
                        ))}
                    </div>
                    <button onClick={finish} className="btn btn-secondary" style={{ width: '100%' }}>
                        Skip for now
                    </button>
                </div>
            </div>
        );
    }

    const pad = 8;
    const spotlight = rect && {
        position: 'fixed',
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        borderRadius: '14px',
        boxShadow: '0 0 0 4px var(--primary), 0 0 0 9999px rgba(15, 23, 42, 0.72)',
        zIndex: 9999,
        pointerEvents: 'none',
        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
    };

    return (
        <>
            <style>{faceKeyframes}</style>

            {/* Click-blocking backdrop (only when no element is spotlit) */}
            {!rect && <div style={{ ...overlayStyle, background: 'rgba(15, 23, 42, 0.72)' }} />}

            {/* Spotlight ring around the current target */}
            {rect && <div style={spotlight} />}

            {/* Guide card */}
            <div style={guideCardStyle}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                    <div style={{ position: 'relative', flexShrink: 0, animation: 'tourFloat 3s ease-in-out infinite' }}>
                        <AgentFace size={52} speaking={speaking} />
                        {speaking && (
                            <div style={waveWrap}>
                                {[0, 1, 2].map(i => (
                                    <span key={i} style={{ ...waveBar, animation: `tourWave 0.6s ease-in-out ${i * 0.15}s infinite` }} />
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                            <strong style={{ fontSize: '1.05rem' }}>{current.title}</strong>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                {step + 1} / {steps.length}
                            </span>
                        </div>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.55 }}>
                            {current.text}
                        </p>
                    </div>
                </div>

                {/* Progress bar */}
                <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '1rem 0', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${((step + 1) / steps.length) * 100}%`, background: 'var(--primary)', transition: 'width 0.35s ease' }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} className="btn btn-secondary"
                        style={{ padding: '0.5rem', display: 'flex', alignItems: 'center' }}>
                        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <button onClick={finish} className="btn btn-secondary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
                        Skip
                    </button>
                    <div style={{ flex: 1 }} />
                    {step > 0 && (
                        <button onClick={back} className="btn btn-secondary"
                            style={{ padding: '0.5rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <ArrowLeft size={16} /> Back
                        </button>
                    )}
                    <button onClick={next} className="btn btn-primary"
                        style={{ padding: '0.5rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {isLast ? 'Finish' : 'Next'} {!isLast && <ArrowRight size={16} />}
                    </button>
                </div>
            </div>
        </>
    );
}

// ── styles ──
const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9990,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(2px)',
};
const cardStyle = {
    background: 'var(--surface)', borderRadius: '20px', padding: '2.5rem',
    boxShadow: '0 30px 60px -15px rgba(0,0,0,0.3)', border: '1px solid var(--border)',
};
const guideCardStyle = {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    width: 'min(540px, calc(100vw - 32px))', background: 'var(--surface)',
    borderRadius: '18px', padding: '1.3rem 1.5rem', zIndex: 10000,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)', border: '1px solid var(--border)',
    animation: 'fadeIn 0.4s ease',
};
const waveWrap = {
    position: 'absolute', bottom: '-6px', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: '2px', alignItems: 'flex-end', height: '12px',
    background: 'var(--surface)', padding: '2px 4px', borderRadius: '8px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
};
const waveBar = { width: '3px', height: '10px', background: 'var(--primary)', borderRadius: '2px' };

// Shared keyframes: gentle float, voice wave bars, eye blink, talking mouth.
const faceKeyframes = `
    @keyframes tourFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes tourWave { 0%,100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
    @keyframes agentBlink { 0%,90%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }
    @keyframes agentTalk { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1.1); } }
`;

export default TourGuide;
