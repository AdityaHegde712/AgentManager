import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/server/sessions/session-manager.js";


describe("session manager", () => {
  it("allows two concurrent roots and rejects capacity overflow", () => {
    const manager = new SessionManager(2);

    expect(manager.reserve("C:/projects/one").accepted).toBe(true);
    expect(manager.reserve("C:/projects/two").accepted).toBe(true);
    expect(manager.reserve("C:/projects/three")).toEqual({
      accepted: false,
      reason: "capacity_exceeded",
    });
  });

  it("rejects a second active session for the same repository root", () => {
    const manager = new SessionManager(2);

    manager.reserve("C:/projects/one");

    expect(manager.reserve("C:/projects/one")).toEqual({
      accepted: false,
      reason: "root_already_active",
    });
  });
});
