import type { ComponentProps } from "react";
import styles from "./ErrorMessage.module.css";

export function ErrorMessage(props: ComponentProps<"p">) {
  return <p className={styles.error} {...props} />;
}
