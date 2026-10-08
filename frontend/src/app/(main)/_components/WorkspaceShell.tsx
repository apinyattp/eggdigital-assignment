"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@/api/auth/authApi";
import styles from "../workspace-shell.module.css";

export function WorkspaceShell({
  user,
  onLogout,
  children,
  activePage = "meetings",
}: {
  user: Session["user"] | null;
  activePage?: "meetings" | "new";
  onLogout: () => void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState<"navigation" | "account" | null>(null);
  const [menuTop, setMenuTop] = useState(80);
  const header = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const navToggle = useRef<HTMLButtonElement>(null);
  const accountToggle = useRef<HTMLButtonElement>(null);
  const account = useRef<HTMLDivElement>(null);
  const logout = useRef<HTMLButtonElement>(null);
  const accountPointerActive = useRef(false);
  const identity = user?.displayName ?? "";

  function closeMenu(restoreFocus = false) {
    setMenu(null);
    if (restoreFocus) {
      (menu === "navigation" ? navToggle : accountToggle).current?.focus();
    }
  }
  useEffect(() => {
    const media = window.matchMedia("(max-width:1279px)");
    const reset = () => setMenu(null);
    media.addEventListener("change", reset);
    return () => media.removeEventListener("change", reset);
  }, []);
  useEffect(() => {
    if (menu === "account") logout.current?.focus();
    if (menu !== "navigation") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      accountPointerActive.current = !!account.current?.contains(
        event.target as Node,
      );
      if (
        menu === "account" &&
        !account.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const releasePointer = () => {
      accountPointerActive.current = false;
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("pointerup", releasePointer);
    document.addEventListener("pointercancel", releasePointer);
    return () => {
      releasePointer();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("pointerup", releasePointer);
      document.removeEventListener("pointercancel", releasePointer);
    };
  }, [menu]);

  return (
    <div
      className={styles.frame}
      onKeyDown={(event) => {
        if (menu && event.key === "Escape") {
          event.preventDefault();
          closeMenu(true);
        }
        if (menu === "navigation" && event.key === "Tab") {
          const links =
            navigation.current?.querySelectorAll<HTMLAnchorElement>("a");
          const last = links?.item((links?.length ?? 0) - 1);
          if (event.shiftKey && document.activeElement === navToggle.current) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            navToggle.current?.focus();
          }
        }
      }}
    >
      <header className={styles.header} ref={header}>
        <button
          className={styles.navToggle}
          type="button"
          ref={navToggle}
          aria-label={
            menu === "navigation" ? "Close navigation" : "Open navigation"
          }
          aria-controls="workspace-sidebar"
          aria-expanded={menu === "navigation"}
          onClick={() => {
            setMenuTop(header.current?.getBoundingClientRect().bottom ?? 80);
            setMenu(menu === "navigation" ? null : "navigation");
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={
                menu === "navigation"
                  ? "m6 6 12 12M18 6 6 18"
                  : "M4 6h16M4 12h16M4 18h16"
              }
            />
          </svg>
        </button>
        <div className={styles.brand}>
          <Image
            src="/assets/egg-digital.png"
            alt="EGG Digital"
            width={65}
            height={35}
            unoptimized
          />
          <div className={styles.brandText}>
            Candidate Meeting
            <br />
            Scheduler<small>Interview workspace</small>
          </div>
        </div>
        <div
          ref={account}
          className={styles.account}
          onBlur={(event) => {
            // A touch can blur without a new focus target before click fires.
            // Keep the menu mounted until that inside pointer finishes.
            if (!event.relatedTarget && accountPointerActive.current) return;
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setMenu(null);
          }}
        >
          <button
            type="button"
            className={styles.accountToggle}
            ref={accountToggle}
            aria-label="Account"
            aria-controls="workspace-account-menu"
            aria-expanded={menu === "account"}
            inert={menu === "navigation"}
            onClick={() => setMenu(menu === "account" ? null : "account")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="7" r="4" />
              <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
            </svg>
          </button>
          <div
            id="workspace-account-menu"
            className={`${styles.accountMenu} ${menu === "account" ? styles.accountOpen : ""}`}
          >
            <div className={styles.identity}>
              <span className={styles.avatar} aria-hidden="true">
                {Array.from(identity)[0]}
              </span>
              <div>
                <small>Logged in as</small>
                <strong>{identity}</strong>
              </div>
            </div>
            <button
              type="button"
              ref={logout}
              className={styles.logout}
              onClick={onLogout}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 4H5v16h4M13 8l4 4-4 4M8 12h12" />
              </svg>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>
      <div className={styles.layout}>
        {menu === "navigation" && (
          <div
            className={styles.backdrop}
            style={{ top: menuTop }}
            aria-hidden="true"
            onClick={() => closeMenu(true)}
          />
        )}
        <nav
          ref={navigation}
          id="workspace-sidebar"
          aria-label="Workspace navigation"
          className={`${styles.sidebar} ${menu === "navigation" ? styles.navigationOpen : ""}`}
          style={menu === "navigation" ? { top: menuTop } : undefined}
        >
          <Link
            href="/dashboard"
            aria-current={activePage === "meetings" ? "page" : undefined}
            className={activePage === "meetings" ? styles.active : undefined}
            onClick={() => closeMenu(true)}
          >
            <span className={styles.navIcon}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="3" />
                <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2" />
              </svg>
            </span>
            <span>Meetings</span>
          </Link>
          {
            <Link
              href="/meetings/new"
              aria-current={activePage === "new" ? "page" : undefined}
              className={activePage === "new" ? styles.active : undefined}
              onClick={() => closeMenu(true)}
            >
              <span className={styles.navIcon}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className={styles.navLabel}>Add New Meeting</span>
            </Link>
          }
        </nav>
        <div
          className={styles.content}
          data-workspace-content
          inert={menu === "navigation"}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
