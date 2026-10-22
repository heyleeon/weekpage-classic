// The page area under the toolbar (ui-spec §1.3): the calendar and tasks pages side by side, each
// in its own slot keyed by page (usePageSwipe moves them; the one not shown is parked, clipped and
// inert). The archive page is mounted only while shown. Only the live page takes input; while the
// pages move, the shield takes clicks and the wheel.

import { memo } from "react";
import ArchivePage from "@/components/archive/ArchivePage";
import CalendarPage from "@/components/calendar/CalendarPage";
import TasksPage from "@/components/tasks/TasksPage";
import { useUiStore } from "@/hooks/useUiStore";
import type { Page } from "@/types/domain";
import styles from "./PageStage.module.css";
import { usePageSwipe } from "./usePageSwipe";

/** Memoised: a page switch only flips the slots' `inert`, it never re-renders a page. */
const PageView = memo(function PageView({ page }: { page: Page }) {
  if (page === "calendar") return <CalendarPage />;
  if (page === "tasks") return <TasksPage />;
  return <ArchivePage />;
});

export function PageStage() {
  const page = useUiStore((s) => s.page);
  const stage = usePageSwipe(page);
  return (
    <div ref={stage.stageRef} className={styles.stage} data-page-stage="">
      {stage.pages.map((p) => (
        <div
          key={p}
          ref={stage.slotRef(p)}
          className={styles.slot}
          data-page-slot={p}
          inert={p !== page || undefined}
        >
          <PageView page={p} />
        </div>
      ))}
      <div className={styles.shield} aria-hidden="true" />
    </div>
  );
}
