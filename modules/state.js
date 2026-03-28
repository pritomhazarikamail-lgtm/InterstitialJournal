/**
 * modules/state.js — Shared UI filter state
 *
 * A single object owned by this module so every import
 * reads/writes the same reference.
 */

export const uiState = {
    currentMonth: new Date(),
    activeTag:    null,   // currently selected tag filter, null = all
    dateFrom:     null,   // date range filter start (YYYY-MM-DD string or null)
    dateTo:       null,   // date range filter end   (YYYY-MM-DD string or null)
};
