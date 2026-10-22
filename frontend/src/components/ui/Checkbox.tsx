// Todo checkbox (ui-spec §5.4): 16×16, radius 4.5; checked stays grey in both themes.
// A real <input type="checkbox"> (keyboard + a11y for free) drawn over by the box.

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import styles from "./Checkbox.module.css";
import { cx } from "./cx";

export type CheckboxProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name, e.g. the todo title. */
  label: string;
  disabled?: boolean;
  /** `aria-keyshortcuts`, e.g. the row's Delete / Backspace (SwipeRow). */
  keyShortcuts?: string;
};

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  keyShortcuts,
}: CheckboxProps) {
  return (
    <span className={cx(styles.box, checked && styles.checked, disabled && styles.disabled)}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        onChange={(e) => onChange(e.target.checked)}
      />
      {checked && <CheckIcon size={10} weight="bold" aria-hidden="true" />}
    </span>
  );
}
