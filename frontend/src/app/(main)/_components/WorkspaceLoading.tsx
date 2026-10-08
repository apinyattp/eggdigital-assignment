import styles from "./WorkspaceLoading.module.css";

/** Shared by the route fallback and client-side identity/data waits. */
export function WorkspaceLoading({
  message = "Loading page…",
}: {
  message?: string;
}) {
  return (
    <div
      className={styles.loading}
      role="status"
      aria-atomic="true"
      data-workspace-loading
    >
      <div className={styles.indicator}>
        <span className={styles.spinner} aria-hidden="true" />
        <p>{message}</p>
      </div>
    </div>
  );
}
