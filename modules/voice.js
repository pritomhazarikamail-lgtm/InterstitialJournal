/**
 * modules/voice.js — Voice-to-text via Web Speech API
 *
 * Appends the transcribed text into #note-input and fires an 'input' event
 * so the char counter, draft saver, and slash-command detector stay in sync.
 * Hides the button silently if the API is unavailable (Firefox, older Safari).
 *
 * iOS Safari notes:
 *  • Requires HTTPS (satisfied by GitHub Pages / any PWA host).
 *  • Mic permission must be granted; on first tap iOS shows its own prompt.
 *  • `recognition.lang` must be set — without it iOS sometimes refuses to start.
 *  • Each session is one-shot; a new SpeechRecognition instance is created per
 *    tap so iOS doesn't reject a reused instance.
 */

import { showToast } from './toast.js';

export function initVoice() {
    const btn = document.getElementById('voice-btn');
    if (!btn) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { btn.style.display = 'none'; return; }

    let isListening = false;
    let _recognition = null;

    function _reset() {
        isListening    = false;
        btn.textContent = '🎤';
        btn.setAttribute('aria-label', 'Voice input');
        btn.classList.remove('voice-btn--active');
        _recognition   = null;
    }

    btn.addEventListener('click', () => {
        if (isListening) {
            _recognition?.stop();
            return;
        }

        // Create a fresh instance each tap — avoids iOS "already started" errors
        const rec = new SpeechRecognition();
        rec.continuous      = false;
        rec.interimResults  = false;
        // Use the page's language so iOS matches the device locale
        rec.lang            = navigator.language || 'en-US';
        _recognition        = rec;

        rec.onstart = () => {
            isListening = true;
            btn.textContent = '🔴';
            btn.setAttribute('aria-label', 'Stop voice input');
            btn.classList.add('voice-btn--active');
        };

        rec.onend = () => _reset();

        rec.onresult = e => {
            const text      = e.results[0][0].transcript;
            const noteInput = document.getElementById('note-input');
            if (!noteInput) return;
            const cur       = noteInput.value;
            noteInput.value = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + text;
            noteInput.dispatchEvent(new Event('input'));
            noteInput.focus();
        };

        rec.onerror = e => {
            _reset();
            switch (e.error) {
                case 'not-allowed':
                case 'service-not-allowed':
                    showToast('Microphone access denied — check your browser settings');
                    break;
                case 'no-speech':
                    showToast('No speech detected — try again');
                    break;
                case 'network':
                    showToast('Voice recognition needs an internet connection');
                    break;
                default:
                    showToast('Voice input error — try again');
            }
        };

        try {
            rec.start();
        } catch {
            _reset();
            showToast('Could not start voice input — try again');
        }
    });
}
