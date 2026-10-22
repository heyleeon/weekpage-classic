// The single toast (ui-spec §15.3): 6 s, paused while hovered, merges same-kind actions,
// 「撤销」 (or mod+Z) undoes every op of the toast, then 「已撤销」 for 1.5 s. A "notice" toast
// (refused move, failed write: nothing happened) shows an info icon instead of the ✓.

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { type CSSProperties, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import styles from "./ToastHost.module.css";

export function ToastHost() {
  const { t } = useTranslation();
  const toast = useUiStore((s) => s.toast);
  const page = useUiStore((s) => s.page);
  const undoToast = useUiStore((s) => s.undoToast);
  const pause = useUiStore((s) => s.pauseToast);
  const resume = useUiStore((s) => s.resumeToast);
  const hintSeen = useDataStore((s) => s.snap?.settings.onboardingShortcutHintSeen ?? true);
  // A toast already showing when the host mounts (language switch re-keys the paper) stays put
  // instead of rising in again.
  const [mountedWith] = useState(toast);

  // While the first-run hint sits at the bottom of the paper (§1.1), the toast rises above it
  // instead of covering it: lift = the room the hint takes from the paper's bottom edge.
  const [lift, setLift] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the toast / page / hint changes
  useLayoutEffect(() => {
    const hint = hintSeen ? null : document.querySelector<HTMLElement>("[data-first-run-hint]");
    const paper = document.querySelector<HTMLElement>("[data-paper]");
    if (!hint || !paper) {
      setLift(0);
      return;
    }
    setLift(Math.max(0, paper.getBoundingClientRect().bottom - hint.getBoundingClientRect().top));
  }, [toast, page, hintSeen]);

  useEffect(() => {
    if (!toast || !Number.isFinite(toast.until)) return;
    const ms = Math.max(0, toast.until - Date.now());
    const timer = window.setTimeout(() => {
      if (useUiStore.getState().toast === toast) useUiStore.getState().dismissToast();
    }, ms);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  const canUndo = !toast.undone && toast.opIds.length > 0;
  const base = page === "calendar" ? "var(--toast-bottom-calendar)" : "var(--toast-bottom)";
  const style: CSSProperties | undefined =
    lift > 0 ? { bottom: `calc(${base} + ${Math.round(lift)}px)` } : undefined;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        styles.host,
        page === "calendar" ? styles.bottomCalendar : styles.bottom,
        toast === mountedWith && styles.instant,
      )}
      style={style}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {toast.tone === "notice" ? (
        <InfoIcon size={14} className={cx(styles.icon, styles.iconNotice)} data-tone="notice" />
      ) : (
        <CheckIcon size={14} className={styles.icon} />
      )}
      <span className={styles.text}>{toast.text}</span>
      {canUndo && (
        <button type="button" className={styles.undo} onClick={() => void undoToast()}>
          {t("common.actions.undo")}
        </button>
      )}
    </div>
  );
}
