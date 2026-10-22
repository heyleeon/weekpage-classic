// Today pill (ui-spec §3): floating glass capsule at the bottom of the calendar page.
// 「⚠ 交会议 PPT 等 2 步逾期 | 4 件待办 | 🚩 课程作业 还剩 2 天 | 🔔 注册美卡 明天 去查 |
// 收件箱 3 件没整理 | 去任务页 →」 (the overdue part since 2026-10-02, ui-spec §9.3).
// Zero parts are hidden with their separator; clicking anywhere goes to the tasks page.

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { Fragment, type ReactNode, useMemo } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDataStore } from "@/hooks/useDataStore";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { todayPill } from "@/lib/todayPill";
import type { TodayPillView } from "@/types/domain";
import styles from "./TodayPill.module.css";

/** <Trans> slots of the `calendar.pill.*` strings: <b>…</b> = bold number, <task/> = task title.
 *  The title is a React text node, so user text is never parsed as markup. */
function slots(title?: string) {
  return { b: <b className={styles.num} />, task: <>{title}</> };
}

/** The visible parts of the pill, in order (exported for tests). */
export function pillParts(view: TodayPillView): { key: string; node: ReactNode }[] {
  const parts: { key: string; node: ReactNode }[] = [];
  if (view.overdue) {
    parts.push({
      key: "overdue",
      node: (
        <span className={styles.overdue}>
          <WarningCircleIcon weight="bold" size={12} className={styles.du} aria-hidden="true" />
          {view.overdue.count === 1 ? (
            <Trans i18nKey="calendar.pill.overdue" components={slots(view.overdue.title)} />
          ) : (
            <Trans
              i18nKey="calendar.pill.overdueMore"
              count={view.overdue.count}
              components={slots(view.overdue.title)}
            />
          )}
        </span>
      ),
    });
  }
  if (view.todos > 0) {
    parts.push({
      key: "todos",
      node: <Trans i18nKey="calendar.pill.todos" count={view.todos} components={slots()} />,
    });
  }
  if (view.due) {
    parts.push({
      key: "due",
      node: (
        <>
          <FlagIcon weight="fill" size={12} className={styles.du} aria-hidden="true" />
          {view.due.days === 0 ? (
            <Trans i18nKey="calendar.pill.dueToday" components={slots(view.due.title)} />
          ) : (
            <Trans
              i18nKey="calendar.pill.dueIn"
              count={view.due.days}
              components={slots(view.due.title)}
            />
          )}
        </>
      ),
    });
  }
  if (view.check) {
    const { title, more } = view.check;
    parts.push({
      key: "check",
      node: (
        <>
          <BellIcon weight="fill" size={12} className={styles.rm} aria-hidden="true" />
          {more > 0 ? (
            <Trans
              i18nKey="calendar.pill.checkMore"
              count={more}
              values={{ total: more + 1 }}
              components={slots(title)}
            />
          ) : (
            <Trans i18nKey="calendar.pill.check" components={slots(title)} />
          )}
        </>
      ),
    });
  }
  if (view.inbox > 0) {
    parts.push({
      key: "inbox",
      node: <Trans i18nKey="calendar.pill.inbox" count={view.inbox} components={slots()} />,
    });
  }
  return parts;
}

export function TodayPill() {
  const { t } = useTranslation();
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  const setPage = useUiStore((s) => s.setPage);
  const view = useMemo(() => (snap ? todayPill(snap, today) : null), [snap, today]);
  if (!view) return null;
  const parts = pillParts(view);
  return (
    <button
      type="button"
      className={styles.pill}
      data-testid="today-pill"
      onClick={() => setPage("tasks")}
    >
      {view.empty ? (
        <span className={styles.item}>{t("calendar.pill.empty")}</span>
      ) : (
        parts.map((p, i) => (
          <Fragment key={p.key}>
            {i > 0 && <span className={styles.sep} aria-hidden="true" />}
            <span className={styles.item} data-part={p.key}>
              {p.node}
            </span>
          </Fragment>
        ))
      )}
      <span className={styles.sep} aria-hidden="true" />
      <span className={styles.link}>
        {t("calendar.pill.goToTasks")} <ArrowRightIcon size={12} aria-hidden="true" />
      </span>
    </button>
  );
}
