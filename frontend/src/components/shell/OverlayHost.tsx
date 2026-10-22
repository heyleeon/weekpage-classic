// One modal overlay at a time (ui-spec §15.1): scrim over the paper, Esc / scrim click close it.
// The overlay components render their own <Modal> panel.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ArchiveConfirm from "@/components/detail/ArchiveConfirm";
import TaskDetail from "@/components/detail/TaskDetail";
import SettingsPanel from "@/components/settings/SettingsPanel";
import { cx } from "@/components/ui/cx";
import { closeOpenSwipeRow } from "@/components/ui/SwipeRow";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import type { Overlay } from "@/types/domain";
import styles from "./OverlayHost.module.css";

function content(overlay: Overlay) {
  switch (overlay.kind) {
    case "taskDetail":
      return (
        <TaskDetail
          taskId={overlay.taskId}
          focusKeyPointId={overlay.focusKeyPointId}
          readOnly={overlay.readOnly ?? false}
        />
      );
    case "archiveConfirm":
      return <ArchiveConfirm taskId={overlay.taskId} />;
    case "settings":
      return <SettingsPanel />;
  }
}

/** Matches --duration-exit: the closing overlay plays its entrance backwards (§15.1). */
const EXIT_MS = 120;

export function OverlayHost() {
  const { t } = useTranslation();
  const overlay = useUiStore((s) => s.overlay);
  const close = useUiStore((s) => s.closeOverlay);
  const dropped = useUiStore((s) => s.overlayDropped);
  useEscLayer(overlay !== null, close, ESC_PRIORITY.modal);
  // A row swiped open behind the scrim closes: its Esc layer outranks the modal's.
  useEffect(() => {
    if (overlay) closeOpenSwipeRow();
  }, [overlay]);
  // The last overlay stays mounted for one exit beat after it closes (switching from one overlay
  // straight to another swaps at once; a drop on window hide skips the beat).
  const [shown, setShown] = useState<Overlay | null>(overlay);
  if (overlay !== null && overlay !== shown) setShown(overlay);
  if (overlay === null && dropped && shown !== null) setShown(null);
  const leaving = overlay === null && shown !== null;
  // An overlay that is already open when this host mounts was not just opened: App re-keys the
  // paper on a language switch (settings panel open). Show it in place instead of replaying the
  // scrim / panel entrance, which would blink. Overlays opened later animate as usual.
  const [mountedWith] = useState(overlay);
  const instant = shown !== null && shown === mountedWith;
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setShown(null), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  if (!shown) return null;
  return (
    <div
      className={cx(styles.layer, leaving && styles.leaving, instant && styles.instant)}
      data-testid="overlay-layer"
      aria-hidden={leaving || undefined}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("shell.closeOverlay")}
        className={styles.scrim}
        data-testid="overlay-scrim"
        onClick={close}
      />
      <div className={styles.center}>{content(shown)}</div>
    </div>
  );
}
