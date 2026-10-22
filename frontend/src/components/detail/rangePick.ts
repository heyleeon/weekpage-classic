// 「小日历点两下」 range selection (ui-spec §11.3). Pure state machine shared by the new-task
// popover and the detail view's start / due editor.

import { diffDays } from "@/lib/dates";

export type RangeEnd = "start" | "end";

export type RangeState = {
  start: string;
  end: string | null;
  /** The end the next click sets; null = the range is complete (next click starts over). */
  picking: RangeEnd | null;
  /** 「不设截止」: clicks only move the start. */
  noDue: boolean;
  /**
   * The range was completed by one click against the default start (today). A second click then
   * makes the two clicks the range (「点 10/5，再点 10/9」 → 10/5–10/9, ui-spec §11.3); with only
   * one click the range stays today → that day.
   */
  provisional: boolean;
  /** Still the opening state (start = today was not chosen by the user). */
  untouched: boolean;
};

/** Opening state: start = today, no due, picking the due date (§11.3 step 1). */
export function initialRange(today: string): RangeState {
  return {
    start: today,
    end: null,
    picking: "end",
    noDue: false,
    provisional: false,
    untouched: true,
  };
}

/** One click on a day (§11.3 step 2). */
export function pickDay(prev: RangeState, d: string): RangeState {
  const s = { ...prev, untouched: false };
  if (s.noDue) return { ...s, start: d, picking: "start", provisional: false };
  if (s.provisional && s.end !== null) {
    const [lo, hi] = d < s.end ? [d, s.end] : [s.end, d];
    return { ...s, start: lo, end: hi, picking: null, provisional: false };
  }
  if (s.picking === null) {
    return { ...s, start: d, end: null, picking: "end", provisional: false };
  }
  if (s.picking === "start") {
    const end = s.end !== null && d > s.end ? null : s.end;
    return { ...s, start: d, end, picking: "end", provisional: false };
  }
  // picking the end
  if (d >= s.start) {
    return { ...s, end: d, picking: null, provisional: prev.untouched };
  }
  return { ...s, start: d, end: null, picking: "end", provisional: false };
}

/**
 * Whether days before today can be clicked (§11.3, 2026-10-02): the start may lie in the past
 * (「前两天忘了见的人」), the due may not. Only one state would turn a past click into the due:
 * picking the due with the start already in the past; there the past greys out and the start
 * field takes the user back. Everywhere else a past click lands on the start.
 */
export function pastPickable(s: RangeState, today: string): boolean {
  return s.noDue || s.picking !== "end" || s.start >= today;
}

/** Clicking a date field switches the end being picked (§11.3 step 3). */
export function focusEnd(s: RangeState, which: RangeEnd): RangeState {
  if (s.noDue && which === "end") return s;
  return { ...s, picking: which, provisional: false, untouched: false };
}

/** 「不设截止」 on / off (§11.3 step 4). */
export function setNoDue(s: RangeState, noDue: boolean): RangeState {
  return noDue
    ? { ...s, noDue: true, end: null, picking: "start", provisional: false, untouched: false }
    : { ...s, noDue: false, picking: "end", provisional: false, untouched: false };
}

/** Days in the range, both ends included. */
export function rangeDays(start: string, end: string): number {
  return diffDays(start, end) + 1;
}
