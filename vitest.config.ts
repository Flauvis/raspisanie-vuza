import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __UCS_OAUTH_CONFIGURED__: "false",
    __UCS_UPDATE_REPOSITORY__: JSON.stringify(""),
    __UCS_VERSION__: JSON.stringify("0.8.3"),
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
