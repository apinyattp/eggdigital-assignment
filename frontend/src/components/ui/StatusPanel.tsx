import type { ReactNode } from "react";
import styles from "./StatusPanel.module.css";

export function StatusPanel({
  children,
  labelledBy,
}: {
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <main className={styles.landing}>
      <section className={styles.landingCard} aria-labelledby={labelledBy}>
        {children}
      </section>
    </main>
  );
}
