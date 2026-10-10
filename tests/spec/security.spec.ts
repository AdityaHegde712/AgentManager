import { describe, expect, it } from "vitest";

import { createLaunchToken, verifyLaunchToken } from "../../src/server/security/launch-token.js";
import { buildCodexResumePicker } from "../../src/server/terminals/codex-command.js";


describe("local access and terminal commands", () => {
  it("accepts only the generated launch token", () => {
    const token = createLaunchToken();

    expect(verifyLaunchToken(token, token)).toBe(true);
    expect(verifyLaunchToken(token, "not-the-token")).toBe(false);
  });

  it("constructs the native picker as an argv array", () => {
    expect(buildCodexResumePicker("codex")).toEqual({
      command: "codex",
      args: ["resume", "--all", "--no-alt-screen"],
    });
  });
});
