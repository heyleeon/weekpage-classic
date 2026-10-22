// 「变成任务」(inbox item → task, ui-spec §11) and 「新建任务」(§11.6, + 新任务 / mod+N).
// Same vocabulary as the task detail: title, start / due chips (∞ = no due date) over a range
// calendar, a bell for the day-before reminder, then the steps with the detail's composer.
// PopoverHost positions it and closes it on outside click / Esc.

import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { InfinityIcon } from "@phosphor-icons/react/dist/csr/Infinity";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/IconButton";
import { KeyPointMarker } from "@/components/ui/KeyPointMarker";
import { MiniCalendar } from "@/components/ui/MiniCalendar";
import { Popover } from "@/components/ui/Popover";
import { notReady, useAttention } from "@/hooks/useAttention";
import { useDataStore } from "@/hooks/useDataStore";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { shortestColumn } from "@/lib/board";
import { addDays, formatMD } from "@/lib/dates";
import { hasMod } from "@/lib/platform";
import { dueUrgent } from "@/lib/taskMath";
import { inboxTriageToast } from "@/lib/toasts";
import type { KeyPointInput, KeyPointStepKind } from "@/types/domain";
import { StepComposer, type StepComposerHandle, type StepDraft } from "./AddBar";
import styles from "./NewTaskPopover.module.css";
import { NEW_TASK_WIDTH } from "./openNewTask";
import {
  focusEnd,
  initialRange,
  pastPickable,
  pickDay,
  type RangeState,
  setNoDue,
} from "./rangePick";
import detail from "./TaskDetail.module.css";

export type NewTaskPopoverProps = {
  /** Set when turning an inbox item into a task. */
  fromInboxId?: string;
  /** Initial title (the inbox text, or empty for 「+ 新任务」). */
  title: string;
};

type Draft = StepDraft & { key: number; kind: KeyPointStepKind };

const STEP_KINDS = ["do", "wait", "check"] as const;

export default function NewTaskPopover({ fromInboxId, title: initialTitle }: NewTaskPopoverProps) {
  const { t } = useTranslation();
  const today = useToday();
  const close = useUiStore((s) => s.closePopover);
  const fromInbox = fromInboxId !== undefined;
  const [title, setTitle] = useState(initialTitle);
  const [range, setRange] = useState<RangeState>(() => initialRange(today));
  const [kps, setKps] = useState<Draft[]>([]);
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const flagTitle = useAttention(titleRef);
  const composer = useRef<StepComposerHandle>(null);
  const nextKey = useRef(1);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, []);

  const trimmed = title.trim();
  const ready = trimmed.length > 0;
  const dueDate = range.noDue ? null : range.end;

  const submit = async () => {
    if (busy) return;
    // No title yet: point at it instead of doing nothing.
    if (!ready) {
      flagTitle();
      return;
    }
    setBusy(true);
    const snap = useDataStore.getState().snap;
    const column = snap ? shortestColumn(snap, useUiStore.getState().columnHeights) : 0;
    // Text still sitting in the step box counts: people type a step and hit Create.
    const pending = composer.current?.take() ?? null;
    const drafts: StepDraft[] = pending ? [...kps, pending] : kps;
    const keyPoints: KeyPointInput[] = drafts.map((k) => ({
      kind: k.kind,
      text: k.text,
      date: k.date,
    }));
    const m = await useDataStore.getState().mutate(
      () =>
        api.createTask({
          title: trimmed,
          startDate: range.start,
          dueDate,
          remindDayBefore: dueDate !== null && remind,
          column,
          keyPoints,
          fromInboxId: fromInboxId ?? null,
        }),
      {
        toast: fromInbox
          ? inboxTriageToast("task")
          : { text: t("detail.newTask.created", { title: trimmed }) },
        highlight: (mut) =>
          mut.id ? { id: mut.id, reason: fromInbox ? "fromInbox" : "new" } : null,
      },
    );
    setBusy(false);
    if (m) close();
  };

  const addDraft = (d: StepDraft) => {
    const kind = d.kind === "note" ? "do" : d.kind;
    setKps((list) => [...list, { ...d, kind, key: nextKey.current++ }]);
    return true;
  };

  const titleEnter = useImeSafeEnter(() => composer.current?.focus());

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && hasMod(e) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    }
  };

  const heading = t(fromInbox ? "detail.newTask.headingFromInbox" : "detail.newTask.heading");
  const primary = t(fromInbox ? "detail.newTask.submitFromInbox" : "detail.newTask.submit");
  const pickingStart = range.picking === "start";
  const pickingDue = range.picking === "end" && !range.noDue;
  const remindDate = dueDate === null ? null : addDays(dueDate, -1);

  return (
    <Popover label={heading} width={NEW_TASK_WIDTH}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mod+Enter anywhere in the panel submits */}
      <div className={styles.body} onKeyDown={onPanelKey}>
        <div className={styles.titleRow}>
          <input
            ref={titleRef}
            className={styles.titleInput}
            value={title}
            maxLength={200}
            placeholder={t("detail.newTask.titlePlaceholder")}
            aria-label={t("detail.newTask.titleLabel")}
            onChange={(e) => setTitle(e.target.value)}
            {...titleEnter}
          />
          <IconButton
            label={t("common.actions.close")}
            variant="plain"
            size={22}
            icon={<XIcon size={14} />}
            onClick={close}
          />
        </div>

        <div className={styles.dates}>
          <div className={styles.chipRow}>
            <CalendarBlankIcon size={15} className={styles.calIcon} aria-hidden />
            <button
              type="button"
              className={cx(detail.dateChip, pickingStart && detail.chipOn)}
              data-testid="new-start"
              onClick={() => setRange((r) => focusEnd(r, "start"))}
            >
              <span className={detail.chipLabel}>{t("detail.newTask.start")}</span>
              <span className={detail.chipValue}>{formatMD(range.start)}</span>
            </button>
            <span className={detail.dueWrap}>
              <button
                type="button"
                className={cx(
                  detail.dateChip,
                  dueDate === null && detail.chipEmpty,
                  pickingDue && detail.chipOn,
                )}
                data-testid="new-due"
                aria-label={
                  dueDate === null
                    ? `${t("detail.newTask.due")}: ${t("detail.newTask.noDue")}`
                    : `${t("detail.newTask.due")} ${formatMD(dueDate)}`
                }
                onClick={() => setRange((r) => focusEnd(r.noDue ? setNoDue(r, false) : r, "end"))}
              >
                <span className={detail.chipLabel}>{t("detail.newTask.due")}</span>
                {dueDate === null ? (
                  <InfinityIcon size={14} className={detail.chipInfinity} />
                ) : (
                  <span
                    className={cx(
                      detail.chipValue,
                      dueUrgent({ status: "active", dueDate }, today) && detail.chipDue,
                    )}
                  >
                    {formatMD(dueDate)}
                  </span>
                )}
              </button>
              {dueDate !== null && (
                <button
                  type="button"
                  className={detail.dueClear}
                  aria-label={t("detail.newTask.noDue")}
                  title={t("detail.newTask.noDue")}
                  onClick={() => setRange((r) => setNoDue(r, true))}
                >
                  <XIcon size={9} />
                </button>
              )}
            </span>
            <span className={styles.spacer} />
            {remindDate !== null && (
              <button
                type="button"
                className={cx(detail.bellButton, remind && detail.bellOn)}
                aria-pressed={remind}
                aria-label={t("detail.newTask.remindOn", { date: formatMD(remindDate) })}
                title={t("detail.newTask.remindOn", { date: formatMD(remindDate) })}
                onClick={() => setRemind((on) => !on)}
              >
                <BellIcon size={14} weight={remind ? "fill" : "regular"} />
                {remind && <span>{formatMD(remindDate)}</span>}
              </button>
            )}
          </div>
          <MiniCalendar
            today={today}
            mode="range"
            range={{ start: range.start, end: dueDate }}
            onPick={(d) => setRange((r) => pickDay(r, d))}
            color="st"
            shape="cell"
            allowPast={pastPickable(range, today)}
          />
        </div>

        <div className={styles.steps}>
          {kps.length > 0 && (
            <ul className={styles.kpList}>
              {kps.map((k) => (
                <li key={k.key} className={styles.kpRow} data-kind={k.kind}>
                  <KeyPointMarker kind={k.kind === "do" ? "idle" : k.kind} size={15} />
                  <span className={styles.kpText}>{k.text}</span>
                  {k.date && <span className={styles.kpDate}>{formatMD(k.date)}</span>}
                  <button
                    type="button"
                    className={styles.kpRemove}
                    aria-label={t("detail.newTask.kpRemove", { text: k.text })}
                    onClick={() => setKps((list) => list.filter((x) => x.key !== k.key))}
                  >
                    <XIcon size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <StepComposer
            ref={composer}
            today={today}
            label={t("detail.newTask.kpLabel")}
            placeholder={t("detail.newTask.kpPlaceholder")}
            kinds={STEP_KINDS}
            onAdd={addDraft}
            onEmptyEnter={() => void submit()}
          />
        </div>

        <div className={styles.foot}>
          <Button variant="text" onClick={close}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="accent"
            className={cx(!ready && notReady)}
            aria-disabled={!ready}
            disabled={busy}
            onClick={() => void submit()}
          >
            {primary}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
