import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 路由测试常在用例里动态 import，冷启动会超过默认 5s。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
