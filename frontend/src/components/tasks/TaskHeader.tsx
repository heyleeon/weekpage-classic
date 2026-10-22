// Right column title row (ui-spec §4.4): 「任务」 9 件 · 1 件逾期 …… 「+ 新任务」.
// N = every unarchived task (done ones included); the overdue part hides at 0.

import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useTranslation } from "react-i18next";
import { newTaskAnchor } from "@/components/detail/openNewTask";
import { useUiStore } from "@/hooks/useUiStore";
import { displayStatus } from "@/lib/taskMath";
import type { Snapshot } from "@/types/domain";
import styles from "./TaskHeader.module.css";

export function TaskHeader({
  snap,
  today,
  scrolled = false,
}: {
  snap: Snapshot;
  today: string;
  /** Cards are scrolled under the header: the title sits on glass to stay readable. */
  scrolled?: boolean;
}) {
  const { t } = useTranslation();
  const openPopover = useUiStore((s) => s.openPopover);
  const live = snap.tasks.filter((t) => t.archivedAt === null);
  const overdue = live.filter((t) => displayStatus(t, today) === "overdue").length;

  return (
    <div className={styles.header} data-scrolled={scrolled || undefined}>
      <div className={styles.titleGroup}>
        <span className={styles.titleGlass} aria-hidden="true" />
        <h2 className={styles.title}>{t("tasks.header.title")}</h2>
        <span className={styles.count}>{t("tasks.header.count", { count: live.length })}</span>
        {overdue > 0 && (
          <>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className={styles.overdue}>{t("tasks.header.overdue", { count: overdue })}</span>
          </>
        )}
      </div>
      <button
        type="button"
        className={styles.newTask}
        data-new-task-button=""
        onClick={(e) =>
          // Same anchor as mod+N: below the button, right-aligned with it (§11.6).
          openPopover({ kind: "newTask", title: "", anchor: newTaskAnchor(e.currentTarget) })
        }
      >
        <PlusIcon size={12} />
        {t("tasks.header.newTask")}
      </button>
    </div>
  );
}
