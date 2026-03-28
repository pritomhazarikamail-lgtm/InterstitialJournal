/**
 * modules/toast.js — Ephemeral toast notifications
 */

const toastEl   = document.getElementById('toast');
let _toastTimer = null;

export function showToast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}
