import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 这个包的每个用例都要真的跑一遍 bcrypt 派生（src/services/password.ts，cost 见 BCRYPT_COST），
    // 单次就要一两秒。vitest 默认的 5s 上限在机器空闲时刚好够用，一旦和别的包并行
    // （`turbo run test` 默认就是并行的）就会超时——auth-password-change 里那条
    // "clears the requirement…" 用例单跑 5.7s、并行时必挂。放宽到 20s：慢是密码哈希
    // 本身的设计，不是卡死。
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
