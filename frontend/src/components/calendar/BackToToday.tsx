// 「回到今天」 (toolbar, calendar page only; ui-spec §1.3): a glass pill that shows up only while
// the view is away from today's home row. The arrow in the today-blue dot points to where today
// is: up = earlier weeks (the user scrolled later), down = later weeks. Click or T → home.
// Fades in on --duration-fast and out on --duration-exit (both 0 under reduced motion).

import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import type { HomeDirection } from "@/types/domain";
import styles from "./BackToToday.module.css";
import { backToToday, useHomeDirection } from "./calendarNav";

/** Matches --duration-exit (120ms): how long the pill stays mounted while it fades out. */
export const BACK_TO_TODAY_EXIT_MS = 120;

export default function BackToToday() {
  const { t } = useTranslation();
  const direction = useHomeDirection();
  // The direction on screen: kept through the fade-out after the view got home.
  const [shown, setShown] = useState<HomeDirection>(direction);
  if (direction !== null && direction !== shown) setShown(direction);
  const leaving = direction === null && shown !== null;

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setShown(null), BACK_TO_TODAY_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  if (shown === null) return null;
  const Arrow = shown === "up" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      className={cx(styles.button, leaving && styles.leaving)}
      title={t("shell.backToToday.tooltip")}
      aria-keyshortcuts="T"
      data-direction={shown}
      // While fading out it is already gone for keyboard and assistive tech.
      tabIndex={leaving ? -1 : undefined}
      aria-hidden={leaving || undefined}
      onClick={backToToday}
    >
      <span className={styles.dot} aria-hidden="true">
        <Arrow size={11} weight="bold" />
      </span>
      {t("shell.backToToday.label")}
    </button>
  );
}
