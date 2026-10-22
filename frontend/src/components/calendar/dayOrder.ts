// Day order after a drop (ui-spec §2.7): where the dragged item lands, the new
// order of the day (same day: reordered; another day: inserted), and the local snapshot patch
// applied before `setDayOrder`. Pure functions.

import { dayItemKeys } from "@/lib/calendar";
import type { CalItem, Snapshot } from "@/types/domain";

/**
 * Insertion index among the *other* items of the day (the dragged one removed) for a pointer at
 * `y`: the number of other items whose vertical midpoint is above the pointer.
 */
export function insertIndexAt(otherMids: number[], y: number): number {
  let i = 0;
  for (const mid of otherMids) {
    if (y > mid) i++;
  }
  return i;
}

/** The day's items with `activeKey` moved to `index` (counted among the other items). */
export function reorderItems<T extends { key: string }>(
  items: T[],
  activeKey: string,
  index: number,
): T[] {
  const active = items.find((i) => i.key === activeKey);
  if (!active) return items;
  const others = items.filter((i) => i.key !== activeKey);
  const at = Math.max(0, Math.min(index, others.length));
  return [...others.slice(0, at), active, ...others.slice(at)];
}

/** True when moving `activeKey` to `index` leaves the order unchanged. */
export function isSameOrder(items: { key: string }[], activeKey: string, index: number): boolean {
  return items.findIndex((i) => i.key === activeKey) === index;
}

/** Keys handed to `setDayOrder` after a drop: every item of the day, in the new order. */
export function droppedDayKeys(items: CalItem[], activeKey: string, index: number): string[] {
  return dayItemKeys(reorderItems(items, activeKey, index));
}

/** Keys for the target day of a cross-day drop: its items with `key` inserted at `index`. */
export function insertedDayKeys(items: CalItem[], key: string, index: number): string[] {
  const keys = dayItemKeys(items).filter((k) => k !== key);
  const at = Math.max(0, Math.min(index, keys.length));
  return [...keys.slice(0, at), key, ...keys.slice(at)];
}

/** Optimistic snapshot: the day's manual order replaced by `keys` (before the command returns). */
export function withDayOrder(snap: Snapshot, date: string, keys: string[], now: number): Snapshot {
  const existing = snap.dayOrders.find((o) => o.date === date);
  const row = existing
    ? { ...existing, itemKeys: keys, updatedAt: now }
    : { id: `local:${date}`, date, itemKeys: keys, createdAt: now, updatedAt: now };
  return {
    ...snap,
    dayOrders: [...snap.dayOrders.filter((o) => o.date !== date), row],
  };
}
