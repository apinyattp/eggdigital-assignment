import type { ComponentProps } from "react";
import styles from "./Button.module.css";

export function Button({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={[styles.submit, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
