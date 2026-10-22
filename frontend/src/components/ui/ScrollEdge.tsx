import styles from "./ScrollEdge.module.css";

/** First child of a scroller that runs under a floating header: fades what scrolls out. */
export function ScrollEdge() {
  return <div className={styles.edge} aria-hidden="true" />;
}
