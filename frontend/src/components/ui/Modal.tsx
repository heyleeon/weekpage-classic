// Modal panel (ui-spec §15.1): wide 600 / narrow 420, --modal material, radius 22, padding 24×26.
// OverlayHost provides the scrim, Esc layer and click-outside; this component is the panel:
// role=dialog, focus kept inside while open, focus returned to the opener on close.

import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import styles from "./Modal.module.css";

export type ModalProps = {
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  width?: "wide" | "narrow";
  /** Right side of the head, before the close button (status dropdown, archive, ⋯). */
  headExtra?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** No ✕ in the head: closed only by its own buttons, Esc or the scrim (archive confirm §13.2). */
  hideClose?: boolean;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function Modal({
  title,
  onClose,
  children,
  width = "wide",
  headExtra,
  footer,
  className,
  hideClose = false,
}: ModalProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      const inner = focusables(root).find((el) => !el.dataset.modalClose);
      (inner ?? root).focus();
    }
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cx(styles.modal, styles[width], className)}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {headExtra}
        {!hideClose && (
          <IconButton
            label={t("common.actions.close")}
            icon={<XIcon size={14} />}
            onClick={onClose}
            data-modal-close="true"
          />
        )}
      </div>
      {children !== undefined && <div className={styles.body}>{children}</div>}
      {footer !== undefined && <div className={styles.foot}>{footer}</div>}
    </div>
  );
}
