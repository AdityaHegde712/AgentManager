import { describe, expect, it } from "vitest";

import { selectRequestToken } from "../../src/server/security/request-token.js";


describe("request token selection", () => {
  it("uses the header token for regular API requests", () => {
    expect(selectRequestToken({ headerToken: "header", queryToken: "query", websocketUpgrade: false })).toBe("header");
  });

  it("uses the query token for browser WebSocket upgrades", () => {
    expect(selectRequestToken({ headerToken: undefined, queryToken: "query", websocketUpgrade: true })).toBe("query");
  });
});
