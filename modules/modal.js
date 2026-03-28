/**
 * modules/modal.js — Custom modal (replaces browser prompt() / confirm())
 */

const modalOverlay  = document.getElementById('modal-overlay');
const modalTitle    = document.getElementById('modal-title');
const modalMessage  = document.getElementById('modal-message');
const modalTextarea = document.getElementById('modal-textarea');
const modalCancel   = document.getElementById('modal-cancel');
const modalConfirm  = document.getElementById('modal-confirm');
let _modalResolve   = null;
let _prevFocus      = null;

export function showModal({ title, message, defaultValue, isDanger = false, confirmText }) {
    // If a modal is already open, close it before opening the new one
    if (_modalResolve) closeModal(null);

    return new Promise(resolve => {
        _prevFocus    = document.activeElement;
        _modalResolve = resolve;
        modalTitle.textContent = title;

        if (message) { modalMessage.textContent = message; modalMessage.classList.remove('hidden'); }
        else { modalMessage.classList.add('hidden'); }

        if (defaultValue !== undefined) {
            modalTextarea.value = defaultValue;
            modalTextarea.classList.remove('hidden');
            requestAnimationFrame(() => { modalTextarea.focus(); modalTextarea.select(); });
        } else {
            modalTextarea.classList.add('hidden');
        }

        modalConfirm.className   = `modal-btn ${isDanger ? 'modal-btn-danger' : 'modal-btn-confirm'}`;
        modalConfirm.textContent = confirmText || (isDanger ? 'Delete' : 'Save');
        modalOverlay.classList.add('visible');
    });
}

export function closeModal(result) {
    modalOverlay.classList.remove('visible');
    if (_modalResolve) { _modalResolve(result); _modalResolve = null; }
    if (_prevFocus && typeof _prevFocus.focus === 'function') {
        _prevFocus.focus();
        _prevFocus = null;
    }
}

// ── Event wiring (self-contained) ──────────────────────────────────────────
modalConfirm.addEventListener('click', () =>
    closeModal(modalTextarea.classList.contains('hidden') ? true : modalTextarea.value.trim())
);
modalCancel.addEventListener('click', () => closeModal(null));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(null); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('visible')) closeModal(null);
});
