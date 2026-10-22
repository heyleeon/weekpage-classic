// 「+ 关键点」 inline input (ui-spec §8.7, §19): live type badge from the step rules (§19.1);
// clicking the badge cycles do → wait → check and stops auto typing for this entry. A typed date
// is cut out on save and a preview line under the text shows the result, as in the detail AddBar.
// Enter adds and keeps the input open (cleared); a lone date waits for words; empty Enter / Esc
// closes; blur adds a non-empty entry (a lone date as typed), then closes.

import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { KindBadge, nextKind } from "@/components/ui/KindBadge";
import { StepPreview } from "@/components/ui/StepPreview";
import { useAttention } from "@/hooks/useAttention";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useToday } from "@/hooks/useToday";
import { api } from "@/lib/api";
import { resolveStepInput } from "@/lib/stepInput";
import type { KeyPointStepKind } from "@/types/domain";
import styles from "./InlineAddKeyPoint.module.css";

export type InlineAddKeyPointProps = {
  taskId: string;
  /** A key point was added (its id, for the flash). */
  onAdded: (id: string | null) => void;
  onClose: () => void;
  /** No key point list above (short card): sit where the list would, 14 below the time bar. */
  standalone?: boolean;
};

export function InlineAddKeyPoint({
  taskId,
  onAdded,
  onClose,
  standalone = false,
}: InlineAddKeyPointProps) {
  const { t } = useTranslation();
  const today = useToday();
  const mutate = useDataStore((s) => s.mutate);
  const [text, setText] = useState("");
  const [manual, setManual] = useState<KeyPointStepKind | null>(null);
  const closing = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const flagRow = useAttention(rowRef);

  const step = resolveStepInput(text, today, manual, undefined);
  const kind = step.kind;
  const date = step.date;
  /** Only a date typed (「12.2」): nothing to add yet. */
  const noText = step.cut && step.text === "";

  /** `asTyped`: keep a lone date's text (blur never drops what was typed). */
  const add = useCallback(
    async (asTyped = false) => {
      const typed = text.trim();
      if (!typed) return;
      setText("");
      setManual(null);
      const value = noText && asTyped ? typed : step.text;
      const m = await mutate(() => api.addKeyPoint(taskId, { kind, text: value, date }));
      if (m) onAdded(m.id);
    },
    [text, noText, step.text, kind, date, taskId, mutate, onAdded],
  );

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    onClose();
  }, [onClose]);

  useEscLayer(true, close, ESC_PRIORITY.inlineInput);

  const ime = useImeSafeEnter(() => {
    if (text.trim() === "") close();
    else if (noText) flagRow();
    else void add();
  });

  return (
    <div
      ref={rowRef}
      className={cx(styles.row, standalone && styles.standalone)}
      data-no-drag="true"
      data-no-open="true"
    >
      <div className={styles.line}>
        <PlusIcon size={12} className={styles.plus} />
        <input
          className={styles.input}
          value={text}
          placeholder={t("tasks.addStep.placeholder")}
          aria-label={t("tasks.addStep.label")}
          // biome-ignore lint/a11y/noAutofocus: the row opens from an explicit 「+ 关键点」 click
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (closing.current) return;
            if (text.trim()) void add(true);
            close();
          }}
          {...ime}
        />
        {/* Keep focus in the input while the badge is clicked. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: mousedown guard only */}
        <span className={styles.badge} onMouseDown={(e) => e.preventDefault()}>
          <KindBadge kind={kind} date={date} onClick={() => setManual(nextKind(kind))} />
        </span>
      </div>
      {step.cut && date && <StepPreview date={date} text={step.text} className={styles.preview} />}
    </div>
  );
}
