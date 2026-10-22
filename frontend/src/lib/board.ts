// Task board helpers shared by new task / inbox → task and restore from archive.

import type { Snapshot } from "@/types/domain";

/** Estimated height of a card without key points (title row + time bar with its headline +
 *  footer: 136) plus the column gap (14), px. */
export const CARD_BASE_H = 150;
/** Height of one key point row in a card, px (ui-spec §8.6). */
export const KP_ROW_H = 24;
/** A card shows at most this many key point rows (ui-spec §8.6). */
export const KP_ROWS_MAX = 7;

/**
 * The column a new / restored task goes to: the shortest one, leftmost on ties.
 * `measured` = real column heights written by the task grid (`useUiStore.columnHeights`); without
 * them (archive page, grid not mounted) heights are estimated from the snapshot:
 * Σ (CARD_BASE_H + min(key points and notes, KP_ROWS_MAX) × KP_ROW_H) over live, unarchived tasks (notes
 * are card rows too since 2026-10-02).
 */
export function shortestColumn(
  snap: Snapshot,
  measured: [number, number, number] | null,
): 0 | 1 | 2 {
  const heights: [number, number, number] = measured ? [...measured] : [0, 0, 0];
  if (!measured) {
    const kpCount = new Map<string, number>();
    for (const kp of snap.keyPoints) {
      kpCount.set(kp.taskId, (kpCount.get(kp.taskId) ?? 0) + 1);
    }
    for (const t of snap.tasks) {
      if (t.archivedAt !== null) continue;
      const col = t.boardColumn;
      if (col !== 0 && col !== 1 && col !== 2) continue;
      heights[col] += CARD_BASE_H + Math.min(kpCount.get(t.id) ?? 0, KP_ROWS_MAX) * KP_ROW_H;
    }
  }
  let best: 0 | 1 | 2 = 0;
  for (const col of [1, 2] as const) {
    if (heights[col] < heights[best]) best = col;
  }
  return best;
}
