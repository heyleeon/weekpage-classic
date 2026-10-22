import type { ReactNode } from "react";
import styles from "./AppFrame.module.css";

/** Window frame: transparent ring around the paper (solid fallback when no vibrancy). */
export function AppFrame({ children }: { children: ReactNode }) {
  return <div className={styles.frame}>{children}</div>;
}
