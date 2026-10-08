// DEC147: approved finite palette and stable synthetic-account assignments.
const palette = [
  ["#ece4fa", "#6033b3"],
  ["#fff0bc", "#6b5113"],
  ["#dceff0", "#245b60"],
  ["#f8e0e8", "#853c59"],
  ["#dfe9fb", "#365d97"],
  ["#e8efd8", "#516b2a"],
  ["#ffe7d5", "#8a481e"],
  ["#e8e8ed", "#4c4c62"],
] as const;
const accountColors: Readonly<Record<string, number>> = {
  "kanda.demo@example.test": 0,
  "arin.sample@example.test": 1,
  "tana.demo@example.test": 2,
  "arin.second@example.test": 3,
  "nicha.example@example.test": 4,
  "pat.demo@example.test": 5,
  "invited.guest@example.test": 6,
};

export function avatarColors(email?: string | null, accountId?: string | null) {
  const identity = (email || accountId || "").trim().toLowerCase();
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const [backgroundColor, color] =
    palette[
      Object.hasOwn(accountColors, identity)
        ? accountColors[identity]
        : hash % palette.length
    ];
  return { backgroundColor, color };
}
