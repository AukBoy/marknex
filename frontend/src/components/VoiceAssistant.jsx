import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, X, Volume2, VolumeX, Bot, Loader } from 'lucide-react';
import api from '../api';
import './VoiceAssistant.css';

// Floating Sinhala/Tamil/English voice help assistant for teachers.
// Uses the browser Web Speech API for speech-to-text and text-to-speech,
// and the backend /assistant/ask endpoint (GPT-4o) for answers.
export default function VoiceAssistant() {
    const [open, setOpen]         = useState(false);
    const [lang, setLang]         = useState('Sinhala');   // Sinhala | Tamil | English
    const [listening, setListening] = useState(false);
    const [loading, setLoading]   = useState(false);
    const [input, setInput]       = useState('');
    const [speakOn, setSpeakOn]   = useState(true);
    const [messages, setMessages] = useState([
        { role: 'bot', text: 'ආයුබෝවන්! 👋 මම MarkNex සහායකයා. පද්ධතිය ගැන ඕනෑම ප්‍රශ්නයක් අහන්න. (Ask me anything about the system — by voice or text.)' },
    ]);

    const recognitionRef = useRef(null);
    const scrollRef      = useRef(null);
    const [micError, setMicError] = useState('');

    const LOCALE = { Sinhala: 'si-LK', Tamil: 'ta-LK', English: 'en-US' };

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, loading]);

    // ── Speech-to-text ──
    const startListening = async () => {
        setMicError('');
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            setMicError('🎤 Voice input needs Google Chrome. Please type your question instead.');
            return;
        }

        // Voice APIs require a secure context (HTTPS) — localhost is exempt.
        if (!window.isSecureContext && location.hostname !== 'localhost') {
            setMicError('🎤 Voice needs a secure (https) connection. Type your question instead.');
            return;
        }

        // Ask for microphone permission up-front so we get a clear failure reason.
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop()); // we only needed the permission
        } catch (permErr) {
            setMicError('🎤 Microphone blocked. Click the 🔒/camera icon in the address bar → allow microphone, then try again.');
            return;
        }

        const run = (locale, isFallback) => {
            const rec = new SR();
            rec.lang = locale;
            rec.interimResults = false;
            rec.maxAlternatives = 1;

            rec.onresult = (e) => {
                const transcript = e.results[0][0].transcript;
                setInput(transcript);
                setListening(false);
                ask(transcript);
            };
            rec.onerror = (e) => {
                setListening(false);
                // If the chosen language isn't supported, retry once in English.
                if (e.error === 'language-not-supported' && !isFallback) {
                    setMicError('සිංහල හඬ හඳුනාගැනීම මෙම browser එකේ නැත — English වලින් උත්සාහ කරමි…');
                    setTimeout(() => { setListening(true); run('en-US', true); }, 400);
                    return;
                }
                const map = {
                    'not-allowed': '🎤 Microphone permission denied. Allow it in the address bar.',
                    'service-not-allowed': '🎤 Microphone permission denied.',
                    'no-speech': '🤫 Didn\'t hear anything. Tap the mic and speak.',
                    'audio-capture': '🎤 No microphone found on this device.',
                    'network': '🌐 Network error — voice needs an internet connection.',
                    'language-not-supported': 'This language isn\'t supported for voice. Please type instead.',
                };
                setMicError(map[e.error] || `Voice error: ${e.error}. Please type instead.`);
            };
            rec.onend = () => setListening(false);

            recognitionRef.current = rec;
            try { rec.start(); }
            catch { setListening(false); setMicError('Could not start the microphone. Please type instead.'); }
        };

        setListening(true);
        run(LOCALE[lang], false);
    };

    const stopListening = () => {
        recognitionRef.current?.stop();
        setListening(false);
    };

    // ── Text-to-speech ──
    const speak = (text) => {
        if (!speakOn || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = LOCALE[lang];
        // Prefer a voice matching the locale if the OS has one.
        const match = window.speechSynthesis.getVoices().find(v => v.lang === LOCALE[lang]);
        if (match) u.voice = match;
        u.rate = 0.95;
        window.speechSynthesis.speak(u);
    };

    // ── Ask the backend ──
    const ask = async (qOverride) => {
        const question = (qOverride ?? input).trim();
        if (!question) return;
        setInput('');
        setMessages(m => [...m, { role: 'user', text: question }]);
        setLoading(true);
        try {
            const { data } = await api.post('/assistant/ask', { question, language: lang });
            setMessages(m => [...m, { role: 'bot', text: data.answer }]);
            speak(data.answer);
        } catch (err) {
            const msg = err.response?.data?.error || 'Sorry, something went wrong.';
            setMessages(m => [...m, { role: 'bot', text: msg }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {/* Floating launcher button */}
            {!open && (
                <button className="va-fab" onClick={() => setOpen(true)} aria-label="Help assistant">
                    <Bot size={24} />
                    <span className="va-fab-pulse" />
                </button>
            )}

            {/* Panel */}
            {open && (
                <div className="va-panel">
                    <div className="va-header">
                        <div className="va-title">
                            <Bot size={18} />
                            <span>MarkNex සහායකයා</span>
                        </div>
                        <div className="va-header-actions">
                            <select className="va-lang" value={lang} onChange={e => setLang(e.target.value)}>
                                <option value="Sinhala">සිංහල</option>
                                <option value="Tamil">தமிழ்</option>
                                <option value="English">English</option>
                            </select>
                            <button className="va-icon-btn" onClick={() => setSpeakOn(s => !s)} title={speakOn ? 'Mute voice' : 'Enable voice'}>
                                {speakOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                            </button>
                            <button className="va-icon-btn" onClick={() => { stopListening(); window.speechSynthesis?.cancel(); setOpen(false); }}>
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    <div className="va-messages" ref={scrollRef}>
                        {messages.map((m, i) => (
                            <div key={i} className={`va-msg ${m.role}`}>
                                {m.role === 'bot' && <Bot size={15} className="va-msg-icon" />}
                                <div className="va-bubble">{m.text}</div>
                            </div>
                        ))}
                        {loading && (
                            <div className="va-msg bot">
                                <Bot size={15} className="va-msg-icon" />
                                <div className="va-bubble va-typing"><span /><span /><span /></div>
                            </div>
                        )}
                    </div>

                    {listening && <div className="va-listening">🎤 අහගෙන සිටිමි… (Listening…)</div>}
                    {micError && <div className="va-mic-error">{micError}</div>}

                    <div className="va-input-bar">
                        <button
                            className={`va-mic ${listening ? 'active' : ''}`}
                            onClick={listening ? stopListening : startListening}
                            title="Speak your question">
                            {listening ? <MicOff size={18} /> : <Mic size={18} />}
                        </button>
                        <input
                            className="va-text"
                            placeholder="ප්‍රශ්නයක් ටයිප් කරන්න…"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && ask()}
                        />
                        <button className="va-send" onClick={() => ask()} disabled={loading || !input.trim()}>
                            {loading ? <Loader size={16} className="va-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
