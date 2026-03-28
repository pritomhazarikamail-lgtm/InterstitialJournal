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

export function showModal({ title, message, defaultValue, isDanger = false }) {
    return new Promise(resolve => {
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
        modalConfirm.textContent = isDanger ? 'Delete' : 'Save';
        modalOverlay.classList.add('visible');
    });
}

export function closeModal(result) {
    modalOverlay.classList.remove('visible');
    if (_modalResolve) { _modalResolve(result); _modalResolve = null; }
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
