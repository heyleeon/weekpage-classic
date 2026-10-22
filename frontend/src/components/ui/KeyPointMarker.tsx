// Key point / note marker (ui-spec §9.1–§9.2): 15px in cards, 16px in the detail timeline.

import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { ExclamationMarkIcon } from "@phosphor-icons/react/dist/csr/ExclamationMark";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil";
import { useTranslation } from "react-i18next";
import { t as tr } from "@/i18n";
import type { MarkerKind, NoteMarkerKind } from "@/types/domain";
import { cx } from "./cx";
import styles from "./KeyPointMarker.module.css";

/** Accessible marker name in the active language (i18n `tasks.marker.*`). */
export function markerLabel(kind: MarkerKind | NoteMarkerKind): string {
  return tr(`tasks.marker.${kind}`);
}

/** Same names as a record (kept for existing callers); every read uses the active language. */
export const MARKER_LABEL: Readonly<Record<MarkerKind | NoteMarkerKind, string>> = {
  get done() {
    return markerLabel("done");
  },
  get overdue() {
    return markerLabel("overdue");
  },
  get wait() {
    return markerLabel("wait");
  },
  get check() {
    return markerLabel("check");
  },
  get idle() {
    return markerLabel("idle");
  },
  get noteThem() {
    return markerLabel("noteThem");
  },
  get noteMe() {
    return markerLabel("noteMe");
  },
};

export type KeyPointMarkerProps = {
  kind: MarkerKind | NoteMarkerKind;
  size?: 15 | 16;
  /** Clicking toggles done (cards); omit for a static marker. */
  onClick?: () => void;
  /** Accessible name for the button form, e.g. 「勾掉 做 10 页初稿」. */
  label?: string;
  /** `aria-keyshortcuts` of the button form (the row's Delete / Backspace, SwipeRow). */
  keyShortcuts?: string;
};

function glyph(kind: MarkerKind | NoteMarkerKind, size: number) {
  switch (kind) {
    case "done":
      return <CheckIcon size={Math.round(size * 0.6)} weight="bold" />;
    case "wait":
      return <HourglassIcon size={Math.round(size * 0.53)} weight="bold" />;
    case "check":
      return <BellIcon size={Math.round(size * 0.47)} weight="fill" />;
    case "noteThem":
      return <EnvelopeSimpleIcon size={Math.round(size * 0.55)} />;
    case "noteMe":
      return <NotePencilIcon size={Math.round(size * 0.55)} />;
    case "overdue":
      return <ExclamationMarkIcon size={Math.round(size * 0.6)} weight="bold" />;
    default:
      return null;
  }
}

export function KeyPointMarker({
  kind,
  size = 15,
  onClick,
  label,
  keyShortcuts,
}: KeyPointMarkerProps) {
  const { t } = useTranslation();
  const cls = cx(styles.marker, styles[kind]);
  const style = { width: size, height: size };
  const name = label ?? t(`tasks.marker.${kind}`);
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        onClick={onClick}
        aria-label={name}
        aria-keyshortcuts={keyShortcuts}
      >
        {glyph(kind, size)}
      </button>
    );
  }
  return (
    <span className={cls} style={style} role="img" aria-label={name}>
      {glyph(kind, size)}
    </span>
  );
}
