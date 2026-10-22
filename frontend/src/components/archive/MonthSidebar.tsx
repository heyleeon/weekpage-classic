// 「这个月做完了」 sidebar (ui-spec §14.7): todos / tasks done and archived this month,
// auto insights, and the fixed archive rules box.

import { useTranslation } from "react-i18next";
import { useDataStore } from "@/hooks/useDataStore";
import { useToday } from "@/hooks/useToday";
import { monthStats } from "@/lib/archive";
import styles from "./ArchivePage.module.css";

/** The fixed archive rules box: `archive.sidebar.rules.<key>`, in this order. */
export const ARCHIVE_RULE_KEYS = ["todos", "tasks", "keyPoints"] as const;

export function MonthSidebar() {
  const { t } = useTranslation();
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  const stats = snap ? monthStats(snap, today) : { todos: 0, tasks: 0, insights: [] };
  const empty = stats.todos + stats.tasks === 0;
  return (
    <aside className={styles.sidebar} aria-label={t("archive.sidebar.title")}>
      <h2 className={styles.sideTitle}>{t("archive.sidebar.title")}</h2>
      <div className={styles.sideTiles}>
        <div className={styles.sideTile}>
          <span className={styles.sideNum}>{stats.todos}</span>
          <span className={styles.sideLabel}>{t("archive.sidebar.todos")}</span>
        </div>
        <div className={styles.sideTile}>
          <span className={`${styles.sideNum} ${styles.sideNumTask}`}>{stats.tasks}</span>
          <span className={styles.sideLabel}>{t("archive.sidebar.tasks")}</span>
        </div>
      </div>
      {!empty && stats.insights.length > 0 && (
        <ul className={styles.insights}>
          {stats.insights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className={styles.rules}>
        <div className={styles.rulesTitle}>{t("archive.sidebar.rulesTitle")}</div>
        {ARCHIVE_RULE_KEYS.map((k) => (
          <div key={k} className={styles.rule}>
            {t(`archive.sidebar.rules.${k}`)}
          </div>
        ))}
      </div>
    </aside>
  );
}
