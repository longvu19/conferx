// Cryptographically random identifiers (previous version used nanoseconds,
// which are guessable).
const LETTERS = "abcdefghijkmnopqrstuvwxyz"; // no "l" to avoid confusion with "1"
const DIGITS = "0123456789";

const pick = (alphabet: string, length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

/** Meeting code like "abc-defg-hij" (~25^10 combinations). */
export const generateRoomId = () => `${pick(LETTERS, 3)}-${pick(LETTERS, 4)}-${pick(LETTERS, 3)}`;

/** 8-digit room password shared with participants. */
export const generateRoomPassword = () => pick(DIGITS, 8);
