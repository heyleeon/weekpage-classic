// Esc priority chain (ui-spec §15.4): the active layer with the highest
// priority handles Esc; with no layer left Esc hides the window. IME composition is never
// interrupted. Mount `useEscDispatcher()` once (AppFrame); register layers with `useEscLayer`.

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

export const ESC_PRIORITY = {
  drag: 60,
  inlineInput: 50,
  popover: 40,
  modal: 30,
  selection: 20,
  archiveBack: 10,
} as const;

type Layer = { id: number; priority: number; handler: () => void };

const layers: Layer[] = [];
let nextId = 1;

/** Registers a layer; returns its unregister function. Later registrations win ties. */
export function pushEscLayer(priority: number, handler: () => void): () => void {
  const layer = { id: nextId++, priority, handler };
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

/** Number of registered layers (tests). */
export function escLayerCount(): number {
  return layers.length;
}

/** Handles one Escape keydown. Returns what happened (tests). */
export function dispatchEscape(e: KeyboardEvent): "ignored" | "layer" | "hide" {
  if (e.key !== "Escape") return "ignored";
  if (e.isComposing || e.keyCode === 229) return "ignored";
  let top: Layer | null = null;
  for (const l of layers) {
    if (!top || l.priority > top.priority || (l.priority === top.priority && l.id > top.id)) {
      top = l;
    }
  }
  e.preventDefault();
  if (top) {
    top.handler();
    return "layer";
  }
  void api.windowHide().catch(() => undefined);
  return "hide";
}

/** One global listener for the whole window. */
export function useEscDispatcher(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      dispatchEscape(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** While `active`, Esc calls `onEsc` if this is the top-priority layer. */
export function useEscLayer(active: boolean, onEsc: () => void, priority: number): void {
  const handler = useRef(onEsc);
  handler.current = onEsc;
  useEffect(() => {
    if (!active) return;
    return pushEscLayer(priority, () => handler.current());
  }, [active, priority]);
}
