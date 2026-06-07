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

    const LOCALE = { Sinhala: 'si-LK', Tamil: 'ta-LK', English: 'en-US' };

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, loading]);

    // ── Speech-to-text ──
    const startListening = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            alert('Voice input is not supported in this browser. Please use Chrome, or type your question.');
            return;
        }
        const rec = new SR();
        rec.lang = LOCALE[lang];
        rec.interimResults = false;
        rec.maxAlternatives = 1;

        rec.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            setInput(transcript);
            setListening(false);
            ask(transcript);
        };
        rec.onerror = () => setListening(false);
        rec.onend = () => setListening(false);

        recognitionRef.current = rec;
        setListening(true);
        rec.start();
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
