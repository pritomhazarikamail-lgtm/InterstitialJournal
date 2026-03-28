/**
 * modules/voice.js — Voice-to-text via Web Speech API
 *
 * Appends the transcribed text into #note-input and fires an 'input' event
 * so the char counter, draft saver, and slash-command detector stay in sync.
 * Hides the button silently if the API is unavailable (Firefox, older Safari).
 */

export function initVoice() {
    const btn = document.getElementById('voice-btn');
    if (!btn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { btn.style.display = 'none'; return; }

    const recognition      = new SpeechRecognition();
    recognition.continuous     = false;
    recognition.interimResults = false;

    let isListening = false;

    btn.addEventListener('click', () => {
        if (isListening) { recognition.stop(); return; }
        try { recognition.start(); } catch { /* already starting */ }
    });

    recognition.onstart = () => {
        isListening = true;
        btn.textContent = '🔴';
        btn.setAttribute('aria-label', 'Stop voice input');
        btn.classList.add('voice-btn--active');
    };

    recognition.onend = () => {
        isListening = false;
        btn.textContent = '🎤';
        btn.setAttribute('aria-label', 'Voice input');
        btn.classList.remove('voice-btn--active');
    };

    recognition.onresult = e => {
        const text      = e.results[0][0].transcript;
        const noteInput = document.getElementById('note-input');
        if (!noteInput) return;
        const cur       = noteInput.value;
        noteInput.value = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + text;
        noteInput.dispatchEvent(new Event('input'));
        noteInput.focus();
    };

    recognition.onerror = () => {
        isListening = false;
        btn.textContent = '🎤';
        btn.classList.remove('voice-btn--active');
    };
}
