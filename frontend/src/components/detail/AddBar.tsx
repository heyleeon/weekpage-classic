// Step composer (ui-spec §10.6): text input, type dropdown (icon only; the menu names them) that
// follows the auto classification (§19) until picked by hand, date chip (recognised date or a
// single-date calendar). Like the calendar input (§2.6), a date in the text is cut out on save, and
// a preview line inside the box shows what will be saved (「↳ 12/2 周三 续签证书」). The detail
// AddBar writes each step at once (「记一笔」 adds a note: who = 对方, date = today by default);
// the new-task popover collects them as drafts with the same control.

import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowElbowDownLeft";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, type Ref, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { Menu } from "@/components/ui/Menu";
import { MiniCalendar } from "@/components/ui/MiniCalendar";
import { StepPreview } from "@/components/ui/StepPreview";
import { notReady, useAttention } from "@/hooks/useAttention";
import { useDataStore } from "@/hooks/useDataStore";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { api } from "@/lib/api";
import { formatMD } from "@/lib/dates";
import { resolveStepInput } from "@/lib/stepInput";
import type { KeyPointKind } from "@/types/domain";
import { Floating, floatingCard } from "./Floating";
import styles from "./TaskDetail.module.css";

/** Type icons of the AddBar menu, shared with the timeline's type menu. */
export const KIND_ICON: Record<KeyPointKind, ReactNode> = {
  do: <CircleIcon size={12} />,
  wait: <HourglassIcon size={12} />,
  check: <BellIcon size={12} weight="fill" />,
  note: <NotePencilIcon size={12} />,
};

export type StepDraft = { kind: KeyPointKind; text: string; date: string | null };

/** Lets the owner take what is still typed in the box (a step written but not Entered) and move
 *  the caret into it. */
export type StepComposerHandle = { take: () => StepDraft | null; focus: () => void };

const ALL_KINDS = ["do", "wait", "check", "note"] as const;

type ComposerProps = {
  today: string;
  label: string;
  placeholder: string;
  /** Types offered in the menu (the new-task popover has no notes). */
  kinds?: readonly KeyPointKind[];
  /** Adds the step; true clears the box. */
  onAdd: (draft: StepDraft) => Promise<boolean> | boolean;
  /** Enter on an empty box (the popover submits the task). */
  onEmptyEnter?: () => void;
  ref?: Ref<StepComposerHandle>;
};

export function StepComposer({
  today,
  label,
  placeholder,
  kinds = ALL_KINDS,
  onAdd,
  onEmptyEnter,
  ref,
}: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [manualKind, setManualKind] = useState<KeyPointKind | null>(null);
  /** undefined = follow the text; null = cleared by hand. */
  const [manualDate, setManualDate] = useState<string | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLLabelElement>(null);
  const flagBox = useAttention(boxRef);
  const resolved = resolveStepInput(text, today, manualKind, manualDate);
  // A kind the host doesn't offer (a note in the popover) falls back to the classifier's step.
  const kind = kinds.includes(resolved.kind) ? resolved.kind : "do";
  const date = resolved.date;
  /** Only a date, nothing to do yet (「12.2」): Enter waits for the words, like the calendar. */
  const noText = resolved.cut && resolved.text === "";

  const reset = () => {
    setText("");
    setManualKind(null);
    setManualDate(undefined);
  };
  useImperativeHandle(ref, () => ({
    // The owner's submit takes whatever is typed; a lone date stays as typed rather than lost.
    take: () => {
      const typed = text.trim();
      if (!typed) return null;
      reset();
      return { kind, text: noText ? typed : resolved.text, date };
    },
    focus: () => inputRef.current?.focus(),
  }));

  const add = async () => {
    if (!text.trim()) {
      onEmptyEnter?.();
      return;
    }
    if (noText) {
      flagBox();
      return;
    }
    if (await onAdd({ kind, text: resolved.text, date })) reset();
    inputRef.current?.focus();
  };
  const enter = useImeSafeEnter(() => void add());

  const kindText = t(`detail.kind.${kind}`);
  /** Back to the text box once a menu / calendar closes, so Enter adds the step. The frame
   *  waits for the menu to unmount (it would otherwise take the focus back). */
  const refocus = () => requestAnimationFrame(() => inputRef.current?.focus());
  const pickKind = (k: KeyPointKind) => {
    setManualKind(k);
    setMenuOpen(false);
    refocus();
  };
  const canAdd = text.trim().length > 0;

  return (
    <div className={styles.addBar}>
      <label
        ref={boxRef}
        className={cx(styles.addInputWrap, resolved.cut && styles.addInputWrapPreview)}
      >
        <span className={styles.addInputLine}>
          <PlusIcon size={13} className={styles.addPlus} />
          <input
            ref={inputRef}
            className={styles.addInput}
            value={text}
            maxLength={200}
            aria-label={label}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            {...enter}
          />
          {canAdd && (
            <button
              type="button"
              className={cx(styles.addSubmit, noText && notReady)}
              aria-label={t("detail.addBar.submit")}
              aria-disabled={noText}
              title={t("detail.addBar.submit")}
              // Keep the caret in the text box.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void add()}
            >
              <ArrowElbowDownLeftIcon size={13} weight="bold" />
            </button>
          )}
        </span>
        {resolved.cut && date && (
          <StepPreview date={date} text={resolved.text} className={styles.addPreview} />
        )}
      </label>
      <Floating
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        up
        align="right"
        trigger={
          <button
            type="button"
            className={cx(styles.addPill, styles.kindPill, styles[`kindPill_${kind}`])}
            aria-haspopup="menu"
            aria-label={t("detail.addBar.kindLabel", { kind: kindText })}
            title={kindText}
            data-testid="addbar-kind"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {KIND_ICON[kind]}
            <CaretDownIcon size={10} className={styles.caret} />
          </button>
        }
      >
        <Menu
          label={t("detail.addBar.kindMenu")}
          autoFocus
          items={kinds.map((k) => ({
            key: k,
            label: k === "note" ? t("detail.addBar.noteOption") : t(`detail.kind.${k}`),
            icon: KIND_ICON[k],
            checked: kind === k,
            separatorBefore: k === "note",
            onSelect: () => pickKind(k),
          }))}
        />
      </Floating>
      <Floating
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        up
        align="right"
        trigger={
          <span className={styles.dateWrap}>
            <button
              type="button"
              className={cx(styles.addPill, styles.datePill)}
              data-testid="addbar-date"
              aria-label={
                date
                  ? t("detail.addBar.dateLabel", { date: formatMD(date) })
                  : t("detail.addBar.date")
              }
              onClick={() => setDateOpen((o) => !o)}
            >
              <CalendarBlankIcon size={13} />
              {date && <span>{formatMD(date)}</span>}
            </button>
            {date && (
              <button
                type="button"
                className={styles.dateClear}
                aria-label={t("detail.addBar.clearDate")}
                onClick={() => {
                  setManualDate(null);
                  refocus();
                }}
              >
                <XIcon size={9} />
              </button>
            )}
          </span>
        }
      >
        <div className={floatingCard}>
          <MiniCalendar
            today={today}
            value={date}
            allowPast={kind === "note"}
            onPick={(d) => {
              setManualDate(d);
              setDateOpen(false);
              refocus();
            }}
          />
        </div>
      </Floating>
    </div>
  );
}

/** Detail view AddBar: each step is written right away. */
export function AddBar({ taskId, today }: { taskId: string; today: string }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  return (
    <StepComposer
      today={today}
      label={t("detail.addBar.label")}
      placeholder={t("detail.addBar.placeholder")}
      onAdd={async (d) =>
        (await mutate(() =>
          api.addKeyPoint(taskId, { ...d, who: d.kind === "note" ? "them" : null }),
        )) !== null
      }
    />
  );
}
