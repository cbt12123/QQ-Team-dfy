import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("admin exposes map setup status and defaults while keeping the key server-side", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qqbot-admin-food-"));
  const envPath = join(dir, ".env");
  const key = "abcdef1234567890abcdef1234567890";
  writeFileSync(envPath, `AMAP_API_KEY=${key}\nLLM_API_KEY=private-llm-key\n`);
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [resolve("admin/server.js")], {
    env: {
      ...process.env,
      ADMIN_HOST: "127.0.0.1",
      ADMIN_PORT: String(port),
      ADMIN_ENV_PATH: envPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/config`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.ok(response, "temporary admin server must start");
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, new RegExp(key));
    assert.doesNotMatch(text, /private-llm-key/);
    const { config } = JSON.parse(text);
    assert.equal(config.hasAmapKey, true);
    assert.equal(config.amapApiKey, undefined);
    assert.equal(config.foodEnabled, true);
    assert.equal(config.foodRadiusMeters, 3000);
    assert.equal(config.foodMaxResults, 3);
    assert.equal(config.foodTimeoutMs, 12000);
    writeFileSync(envPath, "FOOD_ENABLED=0\n");
    const empty = await (
      await fetch(`http://127.0.0.1:${port}/api/config`)
    ).json();
    assert.equal(empty.config.hasAmapKey, false);
    assert.equal(empty.config.foodEnabled, false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
