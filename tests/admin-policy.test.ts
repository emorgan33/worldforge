import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeAdmin,
  disabled,
  isCreatableRole,
  isUserRole,
  normalizeEmail,
  setupPending,
  toSafeAccount,
  validName,
  validateCreateAccountInput,
  validateExpectedVersion,
  validateRoleChangeInput,
  validateStatusChangeInput,
} from "../src/lib/admin-policy";

describe("admin-policy", () => {
  describe("normalizeEmail", () => {
    it("lowercases and trims valid emails", () => {
      assert.equal(normalizeEmail("  Alice@Example.COM "), "alice@example.com");
    });

    it("rejects missing or malformed emails", () => {
      assert.equal(normalizeEmail(""), null);
      assert.equal(normalizeEmail("not-an-email"), null);
      assert.equal(normalizeEmail("a@b"), null);
      assert.equal(normalizeEmail(null), null);
      assert.equal(normalizeEmail(123), null);
    });

    it("rejects emails over 254 characters", () => {
      const local = "a".repeat(250);
      assert.equal(normalizeEmail(`${local}@example.com`), null);
    });
  });

  describe("validName", () => {
    it("trims and accepts names between 1 and 120 characters", () => {
      assert.equal(validName("  Alice  "), "Alice");
      assert.equal(validName("A"), "A");
      assert.equal(validName("a".repeat(120)), "a".repeat(120));
    });

    it("rejects empty or oversized names", () => {
      assert.equal(validName(""), null);
      assert.equal(validName("   "), null);
      assert.equal(validName("a".repeat(121)), null);
      assert.equal(validName(123), null);
    });
  });

  describe("role predicates", () => {
    it("recognizes all user roles", () => {
      for (const role of ["ADMIN", "AUTHOR", "GM", "PLAYER"]) {
        assert.equal(isUserRole(role), true);
      }
      assert.equal(isUserRole("SUPERADMIN"), false);
      assert.equal(isUserRole(123), false);
    });

    it("recognizes only AUTHOR and PLAYER as creatable", () => {
      assert.equal(isCreatableRole("AUTHOR"), true);
      assert.equal(isCreatableRole("PLAYER"), true);
      assert.equal(isCreatableRole("ADMIN"), false);
      assert.equal(isCreatableRole("GM"), false);
    });
  });

  describe("activeAdmin", () => {
    it("is true only for active admins", () => {
      assert.equal(activeAdmin({ role: "ADMIN", disabledAt: null }), true);
      assert.equal(activeAdmin({ role: "ADMIN", disabledAt: new Date() }), false);
      assert.equal(activeAdmin({ role: "AUTHOR", disabledAt: null }), false);
    });
  });

  describe("disabled", () => {
    it("is true when disabledAt is set", () => {
      assert.equal(disabled({ disabledAt: new Date() }), true);
      assert.equal(disabled({ disabledAt: null }), false);
    });
  });

  describe("setupPending", () => {
    it("is true when no password hash exists", () => {
      assert.equal(setupPending({ passwordHash: null }), true);
      assert.equal(setupPending({ passwordHash: "" }), true);
      assert.equal(setupPending({ passwordHash: "scrypt-v1:abc:def" }), false);
    });
  });

  describe("toSafeAccount", () => {
    it("exposes only safe fields and derives setupPending", () => {
      const user = {
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        role: "ADMIN" as const,
        disabledAt: null,
        createdAt: new Date("2026-01-01"),
        lastSignInAt: null,
        accountVersion: 3,
        passwordHash: null,
      };
      const dto = toSafeAccount(user);
      assert.equal(dto.id, "u1");
      assert.equal(dto.email, "alice@example.com");
      assert.equal(dto.name, "Alice");
      assert.equal(dto.role, "ADMIN");
      assert.equal(dto.disabledAt, null);
      assert.equal(dto.createdAt.getTime(), user.createdAt.getTime());
      assert.equal(dto.lastSignInAt, null);
      assert.equal(dto.accountVersion, 3);
      assert.equal(dto.setupPending, true);
      assert.ok(!(dto as Record<string, unknown>).passwordHash);
    });
  });

  describe("validateCreateAccountInput", () => {
    it("accepts AUTHOR and PLAYER creation", () => {
      const result = validateCreateAccountInput({ email: "bob@example.com", name: "Bob", role: "AUTHOR" });
      assert.ok(!("code" in result));
      assert.equal((result as { email: string }).email, "bob@example.com");
    });

    it("rejects ADMIN and GM creation", () => {
      const result = validateCreateAccountInput({ email: "bob@example.com", name: "Bob", role: "ADMIN" });
      assert.equal("code" in result ? result.code : null, "INVALID_ROLE");
    });

    it("rejects invalid email and name", () => {
      assert.equal(validateCreateAccountInput({ email: "bad", name: "Bob", role: "PLAYER" }).code, "INVALID_INPUT");
      assert.equal(validateCreateAccountInput({ email: "bob@example.com", name: "", role: "PLAYER" }).code, "INVALID_INPUT");
    });
  });

  describe("validateRoleChangeInput", () => {
    it("accepts any known role", () => {
      const result = validateRoleChangeInput({ role: "GM" });
      assert.ok(!("code" in result));
      assert.equal((result as { role: string }).role, "GM");
    });

    it("rejects unknown roles", () => {
      assert.equal(validateRoleChangeInput({ role: "GOD" }).code, "INVALID_ROLE");
    });
  });

  describe("validateStatusChangeInput", () => {
    it("accepts boolean disabled", () => {
      assert.equal(validateStatusChangeInput({ disabled: true }).disabled, true);
    });

    it("rejects non-boolean", () => {
      assert.equal(validateStatusChangeInput({ disabled: "yes" }).code, "INVALID_INPUT");
    });
  });

  describe("validateExpectedVersion", () => {
    it("accepts non-negative integers", () => {
      assert.equal(validateExpectedVersion({ expectedVersion: 0 }), 0);
      assert.equal(validateExpectedVersion({ expectedVersion: 5 }), 5);
    });

    it("rejects invalid versions", () => {
      assert.equal(validateExpectedVersion({ expectedVersion: -1 }).code, "INVALID_INPUT");
      assert.equal(validateExpectedVersion({ expectedVersion: 1.5 }).code, "INVALID_INPUT");
      assert.equal(validateExpectedVersion({}).code, "INVALID_INPUT");
    });
  });
});
