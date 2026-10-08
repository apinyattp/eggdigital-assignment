"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useMemberPicker } from "@/hooks/useMemberPicker";
import type { useMeetingEdit } from "@/hooks/useMeetingEdit";
import { avatarColors } from "@/components/ui/avatarColors";
import styles from "../edit-meeting.module.css";

export function EditTeamPicker({
  edit,
}: {
  edit: ReturnType<typeof useMeetingEdit>;
}) {
  // Reuse existing lookup/session/paging behavior. Persisted attendees and edit
  // additions/removals remain owned by the Edit draft, not a replacement list.
  const picker = useMemberPicker(edit.locked),
    id = useId(),
    input = useRef<HTMLInputElement>(null),
    activeOption = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [activeId, setActiveId] = useState<string | null>(null);
  const existing = edit.meeting?.attendees ?? [];
  const items = picker.items.filter(
    (member) =>
      !existing.some(
        (person) =>
          person.memberId === member.id || person.email === member.email,
      ) &&
      !edit.additions.some(
        (person) => person.id === member.id || person.email === member.email,
      ),
  );
  const activeIndex = items.findIndex((member) => member.id === activeId);
  const showOptions =
    open &&
    !picker.disabled &&
    !!picker.query.trim() &&
    (picker.phase === "ready" || items.length > 0);
  const active =
    showOptions && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;
  const error =
    edit.fields.attendeeChanges ||
    edit.fields.addMemberIds ||
    edit.fields.removeEmails;
  useEffect(() => {
    activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  function select(index: number) {
    const member = items[index];
    if (!member || edit.locked) return;
    edit.add(member);
    picker.setQuery("");
    setActiveId(null);
    input.current?.focus();
  }
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
      const count = items.length;
      const next =
        activeIndex < 0
          ? event.key === "ArrowDown"
            ? 0
            : count - 1
          : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + count) %
            count;
      setActiveId(count ? items[next].id : null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (showOptions) select(Math.max(activeIndex, 0));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveId(null);
    }
  }
  const count =
    existing.filter((person) => !edit.removals.includes(person.email)).length +
    edit.additions.length;
  return (
    <div
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
        aria-autocomplete="list"
        aria-expanded={showOptions}
        aria-controls={`${id}-options`}
        aria-activedescendant={active}
        aria-describedby={`${id}-help ${id}-count${error ? ` ${id}-error` : ""}`}
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
        id={`${id}-options`}
        role="listbox"
        aria-label="Company members"
        className={styles.options}
        hidden={!showOptions}
      >
        {items.map((member, index) => (
          <div
            key={member.id}
            ref={index === activeIndex ? activeOption : undefined}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={styles.option}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(index)}
          >
            <strong>{member.displayName}</strong>
            <small>{member.email}</small>
          </div>
        ))}
        {picker.phase === "ready" && !items.length && (
          <p>No available members found. Try another name or email.</p>
        )}
      </div>
      {open && picker.hasMore && picker.phase !== "error" && (
        <button
          type="button"
          disabled={picker.disabled || picker.phase === "loading"}
          onPointerDown={(event) => {
            if (event.button === 0 && event.currentTarget.disabled)
              event.preventDefault();
          }}
          onMouseDown={(event) => {
            if (event.button === 0) event.preventDefault();
          }}
          onClick={() => {
            input.current?.focus({ preventScroll: true });
            picker.loadMore();
          }}
        >
          Load more members
        </button>
      )}
      {picker.phase === "loading" && <p role="status">Searching members…</p>}
      {picker.phase === "error" && (
        <p role="alert">
          Unable to search members. Your selected team is preserved.{" "}
          <button
            type="button"
            disabled={picker.disabled}
            onClick={picker.retry}
          >
            Retry search
          </button>
        </p>
      )}
      <ul className={styles.members} aria-label="Interview team">
        {existing.map((person) => (
          <li
            key={person.email}
            className={
              edit.removals.includes(person.email) ? styles.removed : undefined
            }
          >
            <span
              className={styles.avatar}
              style={avatarColors(person.email, person.memberId)}
              aria-hidden="true"
            >
              {Array.from(person.displayName)[0]}
            </span>
            <div>
              <strong>{person.displayName}</strong>
              <small>
                {person.email}
                {person.memberId === null ? " · Guest" : ""}
              </small>
              {edit.removals.includes(person.email) && (
                <small>Will be removed when saved</small>
              )}
            </div>
            <button
              type="button"
              disabled={edit.locked}
              aria-label={`${edit.removals.includes(person.email) ? "Undo removal of" : "Remove"} ${person.displayName}`}
              onClick={() => edit.toggleRemoval(person.email)}
            >
              {edit.removals.includes(person.email) ? "Undo" : "×"}
            </button>
          </li>
        ))}
        {edit.additions.map((person) => (
          <li key={person.id}>
            <span
              className={styles.avatar}
              style={avatarColors(person.email, person.id)}
              aria-hidden="true"
            >
              {Array.from(person.displayName)[0]}
            </span>
            <div>
              <strong>{person.displayName}</strong>
              <small>{person.email} · Newly added</small>
            </div>
            <button
              type="button"
              disabled={edit.locked}
              aria-label={`Remove added ${person.displayName}`}
              onClick={() => edit.removeAdded(person.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p id={`${id}-help`} className={styles.help}>
        Search for company members to add.
        Existing attendees remain until you remove them and save.
      </p>
      <p id={`${id}-count`} className={styles.help} role="status">
        {count} selected · excluding the organizer
      </p>
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
