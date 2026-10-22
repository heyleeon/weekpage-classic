// Tasks page (ui-spec §4–§9): left column (todos / inbox) | divider | task header + 3-column
// grid. Overlays (detail, new task, archive confirm) live in components/detail and are opened through
// useUiStore; the date picker popover is ./DatePickerPopover (mounted by PopoverHost).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDataStore } from "@/hooks/useDataStore";
import { useToday } from "@/hooks/useToday";
import { TaskGrid } from "./TaskGrid";
import { TaskHeader } from "./TaskHeader";
import styles from "./TasksPage.module.css";
import { TodoPanel } from "./TodoPanel";

export default function TasksPage() {
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  if (!snap) return <section className={styles.page} aria-busy="true" />;
  return (
    <section className={styles.page} aria-label={t("tasks.page")}>
      <TodoPanel snap={snap} today={today} />
      <div className={styles.main}>
        <TaskHeader snap={snap} today={today} scrolled={scrolled} />
        <TaskGrid snap={snap} today={today} onScrolledChange={setScrolled} />
      </div>
    </section>
  );
}
