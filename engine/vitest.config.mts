import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      PASSWORD_COST: "1024",
    },
  },
});
