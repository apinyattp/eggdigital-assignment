"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { useMemberPicker } from "@/hooks/useMemberPicker";
import { avatarColors } from "@/components/ui/avatarColors";
import styles from "../team-picker.module.css";

export function TeamPicker({
  picker,
  error,
}: {
  picker: ReturnType<typeof useMemberPicker>;
  error?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = picker.items.findIndex(
    (member) => member.id === activeId,
  );
  const showOptions =
    !picker.disabled &&
    open &&
    !!picker.query.trim() &&
    (picker.phase === "ready" || picker.items.length > 0);
  const active =
    showOptions && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);
  useEffect(() => {
    activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const select = (memberId: string) => {
    picker.select(memberId);
    setActiveId(null);
    input.current?.focus();
  };
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
        "Enter",
        "Escape",
        "Tab",
      ].includes(event.key)
    )
      delete event.currentTarget.dataset.pointerFocus;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const count = picker.items.length;
      const next =
        activeIndex < 0
          ? event.key === "ArrowDown"
            ? 0
            : count - 1
          : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + count) %
            count;
      setActiveId(count ? picker.items[next].id : null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (showOptions && picker.items.length)
        select(picker.items[Math.max(0, activeIndex)].id);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      setActiveId(null);
    }
  }

  return (
    <div
      className={styles.picker}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActiveId(null);
        }
      }}
    >
      <label htmlFor={`${id}-search`}>
        Interview Teams Email <span aria-hidden="true">*</span>
      </label>
      <input
        ref={input}
        id={`${id}-search`}
        role="combobox"
        type="search"
        name="interview-team-search"
        autoComplete="off"
        placeholder="Search company members"
        aria-required="true"
        aria-autocomplete="list"
        aria-expanded={showOptions}
        aria-controls={`${id}-options`}
        aria-activedescendant={active}
        aria-describedby={`${id}-help ${id}-count ${id}-state${error ? ` ${id}-error` : ""}`}
        aria-invalid={!!error}
        aria-busy={picker.phase === "loading"}
        disabled={picker.disabled}
        value={picker.query}
        onFocus={() => {
          setOpen(true);
          if (picker.query.trim() && picker.phase === "idle") picker.retry();
        }}
        onPointerDown={(event) => {
          event.currentTarget.dataset.pointerFocus = "true";
        }}
        onBlur={(event) => {
          delete event.currentTarget.dataset.pointerFocus;
        }}
        onKeyDown={keyDown}
        onChange={(event) => {
          setOpen(true);
          setActiveId(null);
          picker.setQuery(event.target.value);
        }}
      />
      <div
        className={styles.options}
        id={`${id}-options`}
        role="listbox"
        aria-label="Company members"
        hidden={!showOptions}
      >
        {picker.items.map((member, index) => (
          <div
            key={member.id}
            ref={index === activeIndex ? activeOption : undefined}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`${styles.option} ${index === activeIndex ? styles.active : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(member.id)}
          >
            <span
              className={styles.avatar}
              style={avatarColors(member.email, member.id)}
              aria-hidden="true"
            >
              {Array.from(member.displayName)[0]}
            </span>
            <span className={styles.details}>
              <strong>{member.displayName}</strong>
              <small>{member.email}</small>
            </span>
          </div>
        ))}
        {picker.phase === "ready" && !picker.items.length && (
          <div className={styles.empty} role="presentation">
            No available members found. Try another name or email.
          </div>
        )}
      </div>
      {open && picker.hasMore && picker.phase !== "error" && (
        <button
          type="button"
          className={styles.action}
          disabled={picker.disabled || picker.phase === "loading"}
          onClick={picker.loadMore}
        >
          Load more members
        </button>
      )}
      <div
        className={styles.selection}
        aria-label="Selected interview team members"
      >
        {picker.selected.map((member) => (
          <div className={styles.member} key={member.id}>
            <span
              className={styles.avatar}
              style={avatarColors(member.email, member.id)}
              aria-hidden="true"
            >
              {Array.from(member.displayName)[0]}
            </span>
            <span className={styles.details}>
              <strong>{member.displayName}</strong>
              <small>{member.email}</small>
            </span>
            <button
              type="button"
              disabled={picker.disabled}
              aria-label={`Remove ${member.displayName}`}
              onClick={() => {
                picker.remove(member.id);
                setOpen(false);
                setActiveId(null);
                input.current?.focus();
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <p id={`${id}-help`} className={styles.help}>
        Search company members and select one or more people.
      </p>
      <p
        id={`${id}-count`}
        className={styles.help}
        role="status"
        aria-live="polite"
      >
        {picker.selected.length} selected · excluding the organizer
      </p>
      <div
        id={`${id}-state`}
        className={styles.help}
        role={picker.phase === "error" ? "alert" : "status"}
      >
        {picker.phase === "loading" && "Searching members…"}
        {picker.phase === "error" && (
          <>
            Unable to search members. Your selections are preserved.{" "}
            <button
              type="button"
              className={styles.action}
              disabled={picker.disabled}
              onClick={() => {
                setOpen(true);
                picker.retry();
                input.current?.focus();
              }}
            >
              Retry search
            </button>
          </>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
