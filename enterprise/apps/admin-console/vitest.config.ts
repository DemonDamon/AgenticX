import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Next.js 的 route/page 模块图很大，用例里第一次 `await import("../route")` 要现场
    // 走一遍 vite transform，冷启动就是好几秒——而 vitest 默认的 5s 上限是从 it() 开始
    // 计时的，import 的时间全算在里面。单个包单跑时勉强压线（实测有用例 4.7~4.9s），
    // 一旦 `turbo run test` 把几个包并行起来就会成片超时。
    //
    // 超时还会连锁：用例 A 超时被判失败后，它那个还没 resolve 的 await 会在用例 B
    // 执行期间继续跑完，把 mock 又调了一遍，于是 B 报 "expected not to be called at
    // all, but actually been called 2 times"——看起来像断言写错了，其实是上一条的残留。
    //
    // 放宽到 30s。这里慢的是模块编译，不是被测代码；30s 仍然能兜住真的卡死。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
