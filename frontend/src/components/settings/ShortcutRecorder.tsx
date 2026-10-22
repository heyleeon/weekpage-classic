// 「呼出 WeekPage」 row of the settings panel (ui-spec §16.2–§16.3): keycaps of the combo in effect +
// 「录制」. While recording, the next keydown is captured before every other handler (so Esc
// cancels the recording instead of closing the panel) and a blur guard keeps the window open.
// A valid combo goes to Rust through `saveSettings`; Rust re-registers and rolls back on failure.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { formatAccelerator, keycaps, recordErrorText, recordKey } from "./accelerator";
import styles from "./settings.module.css";
import { useShortcutView } from "./useShortcutView";

export function Keycaps({ caps, waiting = false }: { caps: string[]; waiting?: boolean }) {
  if (waiting) {
    return (
      <span className={styles.keycaps} aria-hidden="true">
        <span className={cx(styles.keycap, styles.keycapWaiting)}>…</span>
      </span>
    );
  }
  return (
    <span className={styles.keycaps} data-testid="keycaps">
      {caps.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: caps are positional and never reordered
        <kbd key={i} className={styles.keycap}>
          {c}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutRecorder() {
  const { t } = useTranslation();
  const view = useShortcutView();
  const { mac, accelerator } = view;
  const [recording, setRecording] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Blur guard for exactly as long as we record (also released on unmount).
  useEffect(() => {
    if (!recording) return;
    void api.setBlurGuard(true).catch(() => undefined);
    return () => {
      void api.setBlurGuard(false).catch(() => undefined);
    };
  }, [recording]);

  const commit = useCallback(
    async (next: string) => {
      if (next === accelerator) return;
      await useDataStore.getState().saveSettings({ shortcut: next });
      const status = useUiStore.getState().shortcutStatus;
      if (status && status.accelerator === next && !status.error) {
        useUiStore.getState().showToast({
          text: t("settings.shortcut.changed", { combo: formatAccelerator(next, mac) }),
          opIds: [],
        });
        return;
      }
      // Rust kept (or restored) the old combo: show why, and re-read the stored setting.
      if (!status?.error) setLocalError(t("settings.shortcut.saveFailed"));
      await useDataStore.getState().refresh();
    },
    [accelerator, mac, t],
  );

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const r = recordKey(e, mac);
      if (r.kind === "pending") return;
      setRecording(false);
      if (r.kind === "cancel") return;
      if (r.kind !== "ok") {
        setLocalError(recordErrorText(r, mac));
        return;
      }
      void commit(r.accelerator);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, mac, commit]);

  const errorText = localError ?? view.errorText;

  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.label}>{t("settings.shortcut.label")}</span>
        </div>
        <div className={styles.control}>
          <Keycaps caps={keycaps(accelerator, mac)} waiting={recording} />
          <button
            type="button"
            className={cx(styles.record, recording && styles.recording)}
            aria-pressed={recording}
            onClick={() => {
              setLocalError(null);
              setRecording((r) => !r);
            }}
          >
            {recording ? t("settings.shortcut.recording") : t("settings.shortcut.record")}
          </button>
        </div>
      </div>
      {errorText && (
        <p className={styles.statusLine} role="alert">
          {errorText}
        </p>
      )}
      {view.conflict && (
        <p className={styles.conflictLine} data-testid="shortcut-conflict">
          {view.conflict}
        </p>
      )}
    </>
  );
}
