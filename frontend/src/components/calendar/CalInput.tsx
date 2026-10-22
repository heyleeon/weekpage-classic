// Double-click input (ui-spec §2.6, §2.8): auto-growing one-line textarea with a live preview line
// 「↳ 15:30 和 A 喝咖啡」 inside the blue frame, only when saving would change what is typed
// (inputPreview). Enter saves (never while an IME is composing), Shift+Enter is ignored, Esc
// cancels, blur saves when there is text.

import { type ChangeEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import styles from "./CalInput.module.css";
import {
  CAL_INPUT_MAX,
  type CommitResult,
  cleanInput,
  type InputPreview,
  inputPreview,
} from "./calendarActions";

export type CalInputProps = {
  /** Text the input starts with ("" for a new event). */
  initial: string;
  /** Save attempt; "keep" leaves the input open (time without a title on Enter). */
  onCommit: (raw: string, viaEnter: boolean) => CommitResult;
  /** Close without saving (Esc, or nothing to save). */
  onCancel: () => void;
  /** Accessible name, e.g. 「10/6 新日程」 (already translated by the caller). */
  label: string;
};

export function CalInput({ initial, onCommit, onCancel, label }: CalInputProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  /** Set once the input has been resolved (saved or cancelled) so blur / unmount do nothing. */
  const settled = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const finish = useCallback((viaEnter: boolean) => {
    if (settled.current) return;
    const res = commitRef.current(valueRef.current, viaEnter);
    if (res === "close") settled.current = true;
  }, []);

  const cancel = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  }, [onCancel]);

  const ime = useImeSafeEnter<HTMLTextAreaElement>(() => finish(true));
  useEscLayer(true, cancel, ESC_PRIORITY.inlineInput);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Auto-grow: never a scrollbar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Leaving the page (unmount without blur) saves what was typed, like blur does.
  useEffect(
    () => () => {
      if (!settled.current && valueRef.current.trim() !== initial.trim()) {
        commitRef.current(valueRef.current, false);
      }
    },
    [initial],
  );

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => setValue(cleanInput(e.target.value));
  const preview = inputPreview(value, initial);

  return (
    <div className={styles.box} data-cal-input="">
      <textarea
        ref={ref}
        className={styles.raw}
        rows={1}
        value={value}
        maxLength={CAL_INPUT_MAX}
        aria-label={label}
        spellCheck={false}
        onChange={onChange}
        onBlur={() => finish(false)}
        onKeyDown={ime.onKeyDown}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {preview && (
        <div className={styles.preview} data-testid="cal-input-preview">
          <span className={styles.arrow}>↳</span> <PreviewText preview={preview} />
        </div>
      )}
    </div>
  );
}

function PreviewText({ preview }: { preview: InputPreview }) {
  const { t } = useTranslation();
  switch (preview.kind) {
    case "empty":
      return <span className={styles.faint}>{t("calendar.input.previewEmpty")}</span>;
    case "timed":
      return (
        <>
          <span className={styles.time}>{preview.time}</span>{" "}
          <span className={styles.title}>{preview.title}</span>
        </>
      );
    case "untimed":
      return (
        <>
          <span className={styles.faint}>{t("calendar.input.previewUntimed")}</span>
          <span className={styles.title}> · {preview.title}</span>
        </>
      );
    case "noTitle":
      return (
        <>
          <span className={styles.time}>{preview.time}</span>{" "}
          <span className={styles.faint}>{t("calendar.input.previewNoTitle")}</span>
        </>
      );
  }
}
