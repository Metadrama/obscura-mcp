import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Sequential execution — these tests share a single Obscura process
    fileParallelism: false,
  },
});
