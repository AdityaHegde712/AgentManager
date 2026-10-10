import { describe, expect, it } from "vitest";

import { createTerminalSessionCookie, readTerminalSessionToken } from "../../src/server/security/terminal-session.js";


describe("terminal WebSocket session", () => {
  it("uses a scoped HttpOnly session cookie instead of a URL token", () => {
    expect(createTerminalSessionCookie("launch-token")).toBe(
      "agent_runner_terminal=launch-token; HttpOnly; SameSite=Strict; Path=/api/v1/terminals",
    );
  });

  it("reads only the scoped terminal session value from a cookie header", () => {
    expect(readTerminalSessionToken("theme=dark; agent_runner_terminal=launch-token")).toBe("launch-token");
  });
});
