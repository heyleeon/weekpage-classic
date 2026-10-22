// Toolbar 「归档 N」 (ui-spec §14.1), shown on the task and archive pages. N = done and archived
// this month (todos + tasks); hidden at 0. On the archive page it is the selected (ink) state and
// leads back to the task page. Also hosts mod+N (new task) for both pages.

import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { useDataStore } from "@/hooks/useDataStore";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { archiveBadgeCount } from "@/lib/archive";
import { useNewTaskHotkey } from "../detail/openNewTask";
import styles from "./ArchiveToolbarButton.module.css";

export default function ArchiveToolbarButton() {
  const { t } = useTranslation();
  const page = useUiStore((s) => s.page);
  const setPage = useUiStore((s) => s.setPage);
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  useNewTaskHotkey();
  const onArchive = page === "archive";
  const count = snap ? archiveBadgeCount(snap, today) : 0;
  return (
    <button
      type="button"
      className={cx(styles.button, onArchive && styles.selected)}
      aria-pressed={onArchive}
      title={t(onArchive ? "archive.toolbar.back" : "archive.toolbar.open")}
      onClick={() => setPage(onArchive ? "tasks" : "archive")}
    >
      <ArchiveIcon size={15} />
      <span>
        {t("archive.toolbar.label")}
        {!onArchive && count > 0 && (
          <>
            {" "}
            <span className={styles.count}>{count}</span>
          </>
        )}
      </span>
    </button>
  );
}
