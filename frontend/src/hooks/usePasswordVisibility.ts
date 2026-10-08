"use client";

import { useState } from "react";

export function usePasswordVisibility() {
  const [visible, setVisible] = useState(false);
  return {
    visible,
    toggle: () => setVisible((current) => !current),
  };
}
