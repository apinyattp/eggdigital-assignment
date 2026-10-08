import { describe, expect, it } from "vitest";
import { avatarColors } from "./avatarColors";

describe("DEC147 identity avatar palette", () => {
  it.each([
    ["kanda.demo@example.test", "#ece4fa", "#6033b3"],
    ["arin.sample@example.test", "#fff0bc", "#6b5113"],
    ["tana.demo@example.test", "#dceff0", "#245b60"],
    ["arin.second@example.test", "#f8e0e8", "#853c59"],
    ["nicha.example@example.test", "#dfe9fb", "#365d97"],
    ["pat.demo@example.test", "#e8efd8", "#516b2a"],
    ["invited.guest@example.test", "#ffe7d5", "#8a481e"],
  ])(
    "retains the approved assignment for %s",
    (email, backgroundColor, color) => {
      expect(avatarColors(email)).toEqual({ backgroundColor, color });
    },
  );
  it("normalizes email and prefers it to an account ID", () => {
    expect(
      avatarColors("  ARIN.SAMPLE@EXAMPLE.TEST  ", "different-account"),
    ).toEqual(avatarColors("arin.sample@example.test"));
  });
  it("uses the same deterministic mapping for an account ID when email is absent", () => {
    expect(avatarColors(null, " B ")).toEqual({
      backgroundColor: "#dceff0",
      color: "#245b60",
    });
    expect(avatarColors("", "g")).toEqual({
      backgroundColor: "#e8e8ed",
      color: "#4c4c62",
    });
    expect(avatarColors("a", "g")).toEqual({
      backgroundColor: "#fff0bc",
      color: "#6b5113",
    });
  });
  it("keeps same-name accounts distinct and stable after reorder or removal", () => {
    const people = [
      { name: "Arin", email: "arin.sample@example.test" },
      { name: "Arin", email: "arin.second@example.test" },
      { name: "Other", email: "other@example.test" },
    ];
    const original = new Map(
      people.map((person) => [person.email, avatarColors(person.email)]),
    );
    expect(original.get(people[0].email)).not.toEqual(
      original.get(people[1].email),
    );
    for (const person of [people[2], people[1], people[0]])
      expect(avatarColors(person.email)).toEqual(original.get(person.email));
    expect(avatarColors(people[1].email)).toEqual(
      original.get(people[1].email),
    );
  });
});
