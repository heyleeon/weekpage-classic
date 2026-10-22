// 「查看历史」 inside the detail panel (ui-spec §10.7): newest first, one line per entry. Lines are
// i18n `detail.history.*` text in the language active at call time.

import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { wallTime } from "@/lib/clock";
import { formatMD } from "@/lib/dates";
import type { TaskEvent, TaskStatus } from "@/types/domain";
import styles from "./TaskDetail.module.css";

const TASK_STATUSES: readonly TaskStatus[] = ["active", "waiting", "done"];

function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function dateText(v: unknown): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? formatMD(v)
    : t("detail.history.noDue");
}

function statusText(v: unknown): string {
  return isTaskStatus(v) ? t(`detail.status.${v}`) : str(v);
}

/** 「9/30 15:20」 in the app's time zone. */
export function historyTime(at: number): string {
  const w = wallTime(at);
  const hh = String(w.h).padStart(2, "0");
  const mm = String(w.mi).padStart(2, "0");
  return `${w.mo}/${w.d} ${hh}:${mm}`;
}

/** One history line, e.g. 「状态 等待中 → 已完成」「勾掉「提交申请」」 (§10.7). */
export function historyText(e: TaskEvent): string {
  let p: Json = {};
  try {
    const parsed: unknown = JSON.parse(e.payload);
    if (parsed && typeof parsed === "object") p = parsed as Json;
  } catch {
    // keep {}
  }
  switch (e.type) {
    case "created":
      return t(p.fromInbox === true ? "detail.history.createdFromInbox" : "detail.history.created");
    case "renamed":
      return t("detail.history.renamed", { from: str(p.from), to: str(p.to) });
    case "status":
      return t("detail.history.status", { from: statusText(p.from), to: statusText(p.to) });
    case "dates": {
      const from = (p.from ?? {}) as Json;
      const to = (p.to ?? {}) as Json;
      const parts: string[] = [];
      if (from.startDate !== to.startDate) {
        parts.push(
          t("detail.history.start", {
            from: dateText(from.startDate),
            to: dateText(to.startDate),
          }),
        );
      }
      if (from.dueDate !== to.dueDate) {
        parts.push(
          t("detail.history.due", { from: dateText(from.dueDate), to: dateText(to.dueDate) }),
        );
      }
      return parts.length > 0 ? parts.join(" · ") : t("detail.history.datesChanged");
    }
    case "remind":
      return t(p.to === true ? "detail.history.remindOn" : "detail.history.remindOff");
    case "kp_added":
      return t("detail.history.kpAdded", { text: str(p.text) });
    case "kp_edited": {
      const to = (p.to ?? {}) as Json;
      const from = (p.from ?? {}) as Json;
      return from.text !== to.text
        ? t("detail.history.kpRenamed", { from: str(from.text), to: str(to.text) })
        : t("detail.history.kpEdited", { text: str(to.text) });
    }
    case "kp_done":
      return t("detail.history.kpDone", { text: str(p.text) });
    case "kp_undone":
      return t("detail.history.kpUndone", { text: str(p.text) });
    case "kp_current":
      return t(p.current === true ? "detail.history.kpCurrent" : "detail.history.kpNotCurrent", {
        text: str(p.text),
      });
    case "kp_deleted":
      return t(p.kind === "note" ? "detail.history.noteDeleted" : "detail.history.kpDeleted", {
        text: str(p.text),
      });
    case "note_added":
      return t("detail.history.noteAdded", {
        who: t(p.who === "me" ? "detail.who.me" : "detail.who.them"),
        text: str(p.text),
      });
    case "archived":
      return p.summary
        ? t("detail.history.archivedWithSummary", { summary: str(p.summary) })
        : t("detail.history.archived");
    case "restored":
      return t("detail.history.restored");
  }
  return e.type;
}

export function HistoryView({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TaskEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listTaskHistory(taskId)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e: unknown) => {
        api.log("error", `list_task_history failed: ${e instanceof Error ? e.message : String(e)}`);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  return (
    <div className={styles.history}>
      <button type="button" className={styles.back} onClick={onBack}>
        <CaretLeftIcon size={12} />
        {t("detail.history.back")}
      </button>
      {failed ? (
        <div className={styles.historyEmpty}>{t("detail.history.failed")}</div>
      ) : rows === null ? null : rows.length === 0 ? (
        <div className={styles.historyEmpty}>{t("detail.history.empty")}</div>
      ) : (
        <ul className={styles.historyList}>
          {rows.map((r) => (
            <li key={r.id} className={styles.historyRow}>
              <span className={styles.historyTime}>{historyTime(r.at)}</span>
              <span className={styles.historyText}>{historyText(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
