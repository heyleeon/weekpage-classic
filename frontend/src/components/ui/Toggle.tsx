// Switch 34×20 (ui-spec §16.2): on = --st (or --rm in the date picker), off = --track.

import { cx } from "./cx";
import styles from "./Toggle.module.css";

export type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. */
  label: string;
  tone?: "st" | "rm";
  disabled?: boolean;
};

export function Toggle({ checked, onChange, label, tone = "st", disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx(styles.toggle, styles[tone], checked && styles.on)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}
