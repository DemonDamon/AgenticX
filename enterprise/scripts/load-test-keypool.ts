/**
 * enterprise/scripts/load-test-keypool.ts
 *
 * Mock upstream 401/429 keypool failover smoke (requires local gateway + env keys).
 *
 * Usage:
 *   export DEEPSEEK_API_KEY_1=sk-bad
 *   export DEEPSEEK_API_KEY_2=sk-good
 *   export GATEWAY_JWT=eyJ...
 *   npx tsx enterprise/scripts/load-test-keypool.ts
 */

const GATEWAY = process.env.GATEWAY_BASE_URL ?? "http://127.0.0.1:8088";
const JWT = process.env.GATEWAY_JWT ?? "";
const MODEL = process.env.KEYPOOL_TEST_MODEL ?? "deepseek-chat";
const RUNS = Number(process.env.KEYPOOL_RUNS ?? 20);

async function oneCall(i: number): Promise<boolean> {
  const res = await fetch(`${GATEWAY.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: `ping ${i}` }],
    }),
  });
  return res.ok;
}

async function main() {
  if (!JWT) {
    console.error("GATEWAY_JWT is required");
    process.exit(1);
  }
  let ok = 0;
  for (let i = 0; i < RUNS; i++) {
    if (await oneCall(i)) ok++;
  }
  const rate = ok / RUNS;
  console.log(`keypool load test: ${ok}/${RUNS} success (${(rate * 100).toFixed(1)}%)`);
  if (rate < 0.95) process.exit(1);
}

void main();
