// Simple vertical menu (status dropdown §10.4, ⋯ menu): arrow keys move, Enter / click selects.

import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { cx } from "./cx";
import styles from "./Menu.module.css";

export type MenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  /** Draw a 1px --line divider above this item (e.g. 「记一笔」 in the AddBar type menu, §10.6). */
  separatorBefore?: boolean;
  onSelect: () => void;
};

export type MenuProps = {
  items: MenuItem[];
  /** Accessible name. */
  label: string;
  /** Focus the first item on mount (keyboard-opened menus). */
  autoFocus?: boolean;
};

export function Menu({ items, label, autoFocus = false }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [autoFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div ref={ref} role="menu" aria-label={label} className={styles.menu} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const cls = cx(styles.item, item.danger && styles.danger, item.checked && styles.checked);
        const button =
          item.checked === undefined ? (
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cls}
              onClick={item.onSelect}
            >
              {item.icon}
              {item.label}
            </button>
          ) : (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={item.checked}
              disabled={item.disabled}
              className={cls}
              onClick={item.onSelect}
            >
              {item.icon}
              {item.label}
            </button>
          );
        return (
          <Fragment key={item.key}>
            {item.separatorBefore && <hr className={styles.separator} />}
            {button}
          </Fragment>
        );
      })}
    </div>
  );
}
