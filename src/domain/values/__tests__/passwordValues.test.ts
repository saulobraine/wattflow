import { describe, expect, it } from "vitest";
import { HashedPassword } from "../HashedPassword";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RawPassword,
} from "../RawPassword";

describe("RawPassword & HashedPassword (SEC-06 async scrypt)", () => {
  it("enforces password length between 12 and 128 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(MAX_PASSWORD_LENGTH).toBe(128);

    expect(() => new RawPassword("")).toThrow(/entre 12 e 128 caracteres/);
    expect(() => new RawPassword("a".repeat(11))).toThrow(/entre 12 e 128 caracteres/);
    expect(() => new RawPassword("a".repeat(129))).toThrow(/entre 12 e 128 caracteres/);

    expect(() => new RawPassword("a".repeat(12))).not.toThrow();
    expect(() => new RawPassword("a".repeat(128))).not.toThrow();
  });

  it("hashes asynchronously with crypto.scrypt and verifies via HashedPassword", async () => {
    const raw = new RawPassword("StrongPassphrase!2026");
    const hashed = await raw.generateHashedRepresentation();

    let storedHash = "";
    hashed.transferHash((h) => {
      storedHash = h;
    });

    const [salt, digestHex] = storedHash.split(":");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(digestHex).toMatch(/^[0-9a-f]{128}$/);

    expect(await hashed.matchesRawPassword(new RawPassword("StrongPassphrase!2026"))).toBe(true);
    expect(await hashed.matchesRawPassword(new RawPassword("WrongPassphrase!2026"))).toBe(false);
    expect(await hashed.matchesPlaintextCandidate("StrongPassphrase!2026")).toBe(true);
    expect(await hashed.matchesPlaintextCandidate("")).toBe(false);
    expect(await hashed.matchesPlaintextCandidate("a".repeat(129))).toBe(false);
  });

  it("rejects malformed stored hashes and non-matching hash buffers", async () => {
    expect(() => new HashedPassword("invalid-no-colon")).toThrow(/Formato de hash de senha inválido/);

    const malformed = new HashedPassword("salt:deadbeef");
    expect(await malformed.matchesPlaintextCandidate("StrongPassphrase!2026")).toBe(false);
  });
});
