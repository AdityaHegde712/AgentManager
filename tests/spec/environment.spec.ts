import { describe, expect, it } from "vitest";

import { localEnvironmentOptions } from "../../src/server/config/environment.js";


describe("local environment configuration", () => {
  it("loads the project .env file without overriding an externally provided key", () => {
    expect(localEnvironmentOptions).toEqual({
      path: ".env",
      override: false,
      quiet: true,
    });
  });
});
