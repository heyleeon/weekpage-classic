import type { ReactNode } from "react";
import styles from "./Paper.module.css";

/** The paper: every page, overlay, popover and toast lives inside it. */
export function Paper({ children }: { children: ReactNode }) {
  return (
    <main className={styles.paper} data-paper="true">
      {children}
    </main>
  );
}
