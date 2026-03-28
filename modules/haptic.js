/**
 * modules/haptic.js — Haptic feedback wrapper
 * Safe no-op on devices / browsers that don't support navigator.vibrate.
 */

export function haptic(pattern = [10]) {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}
