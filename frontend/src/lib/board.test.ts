import { describe, expect, it } from "vitest";
import type { Snapshot } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import { CARD_BASE_H, KP_ROW_H, shortestColumn } from "./board";

const demo = fixture as Snapshot;

describe("shortestColumn", () => {
  it("prefers measured heights", () => {
    expect(shortestColumn(demo, [300, 200, 250])).toBe(1);
    expect(shortestColumn(demo, [300, 300, 100])).toBe(2);
  });

  it("takes the leftmost column on ties", () => {
    expect(shortestColumn(demo, [200, 200, 200])).toBe(0);
    expect(shortestColumn(demo, [300, 200, 200])).toBe(1);
  });

  it("estimates from the demo snapshot (→ column 0)", () => {
    // col0: 3 cards, 5 key points; col1: 3 cards, 9 → 9; col2: 3 cards, 7 → 5 + 3
    expect(shortestColumn(demo, null)).toBe(0);
  });

  it("ignores archived tasks, counts notes as rows, caps rows at 5", () => {
    const snap: Snapshot = {
      ...demo,
      tasks: [
        { ...demo.tasks[0], id: "a", boardColumn: 0, archivedAt: null },
        { ...demo.tasks[0], id: "b", boardColumn: 1, archivedAt: null },
        { ...demo.tasks[0], id: "c", boardColumn: 1, archivedAt: 1 },
        { ...demo.tasks[0], id: "d", boardColumn: 2, archivedAt: null },
      ],
      keyPoints: [
        ...Array.from({ length: 9 }, (_, i) => ({
          ...demo.keyPoints[0],
          id: `a${i}`,
          taskId: "a",
          kind: "do" as const,
        })),
        { ...demo.keyPoints[0], id: "n1", taskId: "b", kind: "note" as const },
        { ...demo.keyPoints[0], id: "n2", taskId: "b", kind: "note" as const },
        { ...demo.keyPoints[0], id: "d1", taskId: "d", kind: "wait" as const },
      ],
    };
    // heights: a = base + 7 rows (9 capped), b = base + 2 rows (two notes; c archived), d = base + 1 row
    expect(CARD_BASE_H + 7 * KP_ROW_H).toBeGreaterThan(CARD_BASE_H + 2 * KP_ROW_H);
    expect(shortestColumn(snap, null)).toBe(2);
  });

  it("empty board → column 0", () => {
    expect(shortestColumn({ ...demo, tasks: [], keyPoints: [] }, null)).toBe(0);
  });
});
