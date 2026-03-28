/**
 * modules/toast.js — Ephemeral toast notifications
 */

const toastEl   = document.getElementById('toast');
let _toastTimer = null;

export function showToast(msg, ms = 2600) {
    clearTimeout(_toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    _toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/**
 * Toast with an inline Undo button.
 * onUndo is called immediately if the user taps Undo before ms expires.
 */
export function showUndoToast(msg, onUndo, ms = 5000) {
    clearTimeout(_toastTimer);
    toastEl.textContent = '';
    toastEl.classList.add('show');

    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;

    const undoBtn = document.createElement('button');
    undoBtn.className   = 'toast-undo-btn';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
        clearTimeout(_toastTimer);
        toastEl.classList.remove('show');
        onUndo();
    }, { once: true });

    toastEl.append(msgSpan, ' ', undoBtn);
    _toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}
