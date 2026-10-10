import { describe, expect, it } from "vitest";

import { createLaunchUrl } from "../../src/server/security/launch-url.js";


describe("launch URL", () => {
  it("places the one-time token in a client-only URL fragment", () => {
    const launchUrl = createLaunchUrl("127.0.0.1", 4310, "launch-token");

    expect(launchUrl).toBe("http://127.0.0.1:4310/#token=launch-token");
    expect(new URL(launchUrl).search).toBe("");
  });
});
