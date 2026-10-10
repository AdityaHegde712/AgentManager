import { describe, expect, it } from "vitest";

import { consumeLaunchToken } from "../../src/client/launch-token.js";


describe("browser launch token", () => {
  it("moves a fragment token into session storage and removes it from the visible URL", () => {
    const values = new Map<string, string>();
    let replacement = "";
    const token = consumeLaunchToken(
      { hash: "#token=launch-token", pathname: "/", search: "?project=agent-runner" },
      { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
      (url) => { replacement = url; },
    );

    expect(token).toBe("launch-token");
    expect(values.get("agent-runner.launch-token")).toBe("launch-token");
    expect(replacement).toBe("/?project=agent-runner");
  });
});
