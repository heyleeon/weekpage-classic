// First-run hint at the bottom of the window (ui-spec §1.1): Carbon does not report a combo
// another app already grabbed, so the user is asked to try it once. On macOS an enabled system
// shortcut on the same combo (D4: ⌃⌥Space = next input source) is spelled out with where to
// turn it off. The text always follows the current setting. Closing it saves
// `onboardingShortcutHintSeen: true`, so it shows once.

import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { firstRunText } from "./accelerator";
import styles from "./settings.module.css";
import { useShortcutView } from "./useShortcutView";

export default function FirstRunHint() {
  const { t } = useTranslation();
  const seen = useDataStore((s) => s.snap?.settings.onboardingShortcutHintSeen ?? true);
  const save = useDataStore((s) => s.saveSettings);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const { mac, accelerator, conflict } = useShortcutView();

  if (seen || !accelerator) return null;
  return (
    <aside className={styles.hint} aria-label={t("settings.firstRun.label")} data-first-run-hint="">
      <InfoIcon size={16} aria-hidden="true" />
      <div className={styles.hintText}>
        <span>{firstRunText(accelerator, mac)}</span>
        {conflict && <span className={styles.hintConflict}>{conflict}</span>}
      </div>
      <div className={styles.hintActions}>
        <Button variant="text" size="sm" onClick={() => openOverlay({ kind: "settings" })}>
          {t("settings.firstRun.openSettings")}
        </Button>
        <Button
          variant="fill2"
          size="sm"
          onClick={() => void save({ onboardingShortcutHintSeen: true })}
        >
          {t("settings.firstRun.gotIt")}
        </Button>
      </div>
    </aside>
  );
}
