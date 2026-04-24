/**
 * Smoke tests for mock-debridge-api.
 * Requires the server to be running.
 * Usage: MOCK_API_URL=http://localhost:3000 npx tsx src/test/smoke-test.ts
 */

import WebSocket from "ws";

const BASE_URL = process.env.MOCK_API_URL || "http://localhost:3000";
const WS_URL = process.env.MOCK_WS_URL || "ws://localhost:3001";
const PROGRESSION_DELAY_MS = parseInt(process.env.PROGRESSION_DELAY_MS || "5000", 10);
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 2 * PROGRESSION_DELAY_MS + 5000;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function submitBundle(body: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1.1/gasless/bundles/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(res.ok, `Submit returned ${res.status}`);
  const data = await res.json() as { bundleId: string };
  return data.bundleId;
}

async function getBundle(bundleId: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/v1/gasless/bundles/${bundleId}`);
  const data = await res.json() as Record<string, unknown>;
  return { status: res.status, data };
}

async function getBundles(params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${BASE_URL}/v1/gasless/bundles?${qs}` : `${BASE_URL}/v1/gasless/bundles`;
  const res = await fetch(url);
  assert(res.ok, `Get bundles returned ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

async function pollUntilStatus(
  bundleId: string,
  targetStatuses: string[],
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const { data } = await getBundle(bundleId);
    const bundles = data.bundles as Array<Record<string, unknown>>;
    const bundle = bundles[0];
    if (targetStatuses.includes(bundle.status as string)) {
      return bundle;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for bundle ${bundleId} to reach status ${targetStatuses.join("/")}`);
}

async function pollCollectingStatuses(
  bundleId: string,
  terminalStatuses: string[],
): Promise<{ bundle: Record<string, unknown>; observedStatuses: string[] }> {
  const start = Date.now();
  const observed = new Set<string>();
  while (Date.now() - start < MAX_WAIT_MS) {
    const { data } = await getBundle(bundleId);
    const bundles = data.bundles as Array<Record<string, unknown>>;
    const bundle = bundles[0];
    observed.add(bundle.status as string);
    if (terminalStatuses.includes(bundle.status as string)) {
      return { bundle, observedStatuses: [...observed] };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out waiting for bundle ${bundleId} to reach ${terminalStatuses.join("/")}. Observed: ${[...observed].join(", ")}`,
  );
}

async function run(): Promise<void> {
  console.log(`\nSmoke tests against ${BASE_URL}\n`);

  // 1. Health check
  await test("Health check returns ok", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert(res.ok, `Health returned ${res.status}`);
    const data = await res.json() as { status: string };
    assert(data.status === "ok", `Expected status ok, got ${data.status}`);
  });

  // 2. Submit bundle returns bundleId starting with 0x
  await test("Submit bundle returns 0x-prefixed bundleId", async () => {
    const bundleId = await submitBundle();
    assert(bundleId.startsWith("0x"), `Expected 0x prefix, got ${bundleId}`);
    assert(bundleId.length === 66, `Expected 66 chars (0x + 64 hex), got ${bundleId.length}`);
  });

  // 3. Submit with referralCode (number)
  let refBundleId: string;
  await test("Submit bundle with numeric referralCode", async () => {
    refBundleId = await submitBundle({ referralCode: 12345 });
    assert(refBundleId.startsWith("0x"), "Expected 0x prefix");
  });

  // 4. Get bundle by ID returns correct structure
  let firstBundleId: string;
  await test("Get bundle by ID returns correct structure", async () => {
    firstBundleId = await submitBundle();
    const { status, data } = await getBundle(firstBundleId);
    assert(status === 200, `Expected 200, got ${status}`);
    const bundles = data.bundles as Array<Record<string, unknown>>;
    assert(Array.isArray(bundles), "Expected bundles array");
    assert(bundles.length === 1, `Expected 1 bundle, got ${bundles.length}`);
    assert(bundles[0].bundleId === firstBundleId, "bundleId mismatch");
    assert(bundles[0].status === "created", `Expected created, got ${bundles[0].status}`);
    assert(typeof bundles[0].trades === "object", "Expected trades");
    assert(typeof bundles[0].intents === "object", "Expected intents");
  });

  // 5. Get non-existent bundle returns 404
  await test("Get non-existent bundle returns 404", async () => {
    const { status } = await getBundle("0x0000000000000000000000000000000000000000000000000000000000000000");
    assert(status === 404, `Expected 404, got ${status}`);
  });

  // 6. Direct fulfilled (default, 1-step)
  await test("Progression: default → fulfilled (1-step)", async () => {
    const bundleId = await submitBundle();
    const bundle = await pollUntilStatus(bundleId, ["fulfilled"]);
    assert(bundle.status === "fulfilled", `Expected fulfilled, got ${bundle.status}`);
  });

  // 7. Non-atomic happy path: partially_fulfilled → fulfilled (2-step)
  await test("Progression: partially_fulfilled → fulfilled (2-step)", async () => {
    const bundleId = await submitBundle({ targetStatus: "partially_fulfilled" });
    const { bundle, observedStatuses } = await pollCollectingStatuses(bundleId, ["fulfilled"]);
    assert(bundle.status === "fulfilled", `Expected fulfilled, got ${bundle.status}`);
    assert(
      observedStatuses.includes("partially_fulfilled"),
      `Expected to observe partially_fulfilled, saw: ${observedStatuses.join(", ")}`,
    );
  });

  // 8. Created → cancelled (1-step, verify cancel field)
  await test("Progression: cancelled (1-step, cancel field populated)", async () => {
    const bundleId = await submitBundle({ targetStatus: "cancelled" });
    const bundle = await pollUntilStatus(bundleId, ["cancelled"]);
    assert(bundle.status === "cancelled", `Expected cancelled, got ${bundle.status}`);
    assert(bundle.cancel != null, "Expected cancel field to be populated");
    const cancel = bundle.cancel as Record<string, unknown>;
    assert(typeof cancel.cancelBeneficiary === "string", "Expected cancelBeneficiary string");
  });

  // 9. Created → expired (1-step)
  await test("Progression: expired (1-step)", async () => {
    const bundleId = await submitBundle({ targetStatus: "expired" });
    const bundle = await pollUntilStatus(bundleId, ["expired"]);
    assert(bundle.status === "expired", `Expected expired, got ${bundle.status}`);
  });

  // 10. Created → failed (1-step)
  await test("Progression: failed (1-step)", async () => {
    const bundleId = await submitBundle({ targetStatus: "failed" });
    const bundle = await pollUntilStatus(bundleId, ["failed"]);
    assert(bundle.status === "failed", `Expected failed, got ${bundle.status}`);
  });

  // 11. Partially fulfilled → expired (2-step via partially_fulfilled_expired)
  await test("Progression: partially_fulfilled → expired (2-step)", async () => {
    const bundleId = await submitBundle({ targetStatus: "partially_fulfilled_expired" });
    const { bundle, observedStatuses } = await pollCollectingStatuses(bundleId, ["expired"]);
    assert(bundle.status === "expired", `Expected expired, got ${bundle.status}`);
    assert(
      observedStatuses.includes("partially_fulfilled"),
      `Expected to observe partially_fulfilled, saw: ${observedStatuses.join(", ")}`,
    );
  });

  // 12. Deterministic batch count verification
  await test("Deterministic batch: 12 bundles with exact status counts", async () => {
    const targets = [
      "fulfilled", "fulfilled", "fulfilled", "fulfilled",
      "partially_fulfilled", "partially_fulfilled",
      "partially_fulfilled_expired", "partially_fulfilled_expired",
      "cancelled", "cancelled",
      "expired",
      "failed",
    ];
    const ids = await Promise.all(
      targets.map((targetStatus) => submitBundle({ targetStatus })),
    );

    const results: Record<string, number> = {};
    for (const id of ids) {
      const bundle = await pollUntilStatus(id, ["fulfilled", "cancelled", "expired", "failed"]);
      const s = bundle.status as string;
      results[s] = (results[s] || 0) + 1;
    }

    assert(results["fulfilled"] === 6, `Expected 6 fulfilled, got ${results["fulfilled"] ?? 0}`);
    assert(results["cancelled"] === 2, `Expected 2 cancelled, got ${results["cancelled"] ?? 0}`);
    assert(results["expired"] === 3, `Expected 3 expired, got ${results["expired"] ?? 0}`);
    assert(results["failed"] === 1, `Expected 1 failed, got ${results["failed"] ?? 0}`);
  });

  // 13. List bundles returns paginated response
  await test("List bundles returns paginated response", async () => {
    const data = await getBundles({ pageSize: "2" });
    assert(typeof data.total === "number", "Expected total");
    assert(typeof data.page === "number", "Expected page");
    assert(typeof data.pageSize === "number", "Expected pageSize");
    assert(typeof data.totalPages === "number", "Expected totalPages");
    assert(Array.isArray(data.bundles), "Expected bundles array");
    assert((data.bundles as unknown[]).length <= 2, "Expected at most 2 bundles");
  });

  // 14. List bundles with page parameter
  await test("List bundles page parameter works", async () => {
    const data = await getBundles({ pageSize: "1", page: "1" });
    assert((data.bundles as unknown[]).length <= 1, "Expected at most 1 bundle on page 1");
    assert(data.page === 1, `Expected page 1, got ${data.page}`);
  });

  // 15. List bundles with referralCode filter
  await test("Filter bundles by referralCode", async () => {
    const uniqueRef = `test-${Date.now()}`;
    await submitBundle({ referralCode: uniqueRef });
    const data = await getBundles({ referralCode: uniqueRef });
    const bundles = data.bundles as Array<Record<string, unknown>>;
    assert(bundles.length >= 1, `Expected at least 1 bundle with ref ${uniqueRef}`);
    assert(data.total === 1, `Expected total 1, got ${data.total}`);
  });

  // 16. PageSize is capped at 100
  await test("PageSize capped at 100", async () => {
    const data = await getBundles({ pageSize: "999" });
    assert(data.pageSize === 100, `Expected pageSize 100, got ${data.pageSize}`);
  });

  // 17. Sort by createdAt ascending
  await test("Sort by createdAt ascending", async () => {
    const data = await getBundles({ sort: "createdAt", pageSize: "50" });
    const bundles = data.bundles as Array<Record<string, unknown>>;
    if (bundles.length >= 2) {
      const first = new Date(bundles[0].createdAt as string).getTime();
      const last = new Date(bundles[bundles.length - 1].createdAt as string).getTime();
      assert(first <= last, "Expected ascending order by createdAt");
    }
  });

  // 18. Sort by createdAt descending (default)
  await test("Default sort is -createdAt (descending)", async () => {
    const data = await getBundles({ pageSize: "50" });
    const bundles = data.bundles as Array<Record<string, unknown>>;
    if (bundles.length >= 2) {
      const first = new Date(bundles[0].createdAt as string).getTime();
      const last = new Date(bundles[bundles.length - 1].createdAt as string).getTime();
      assert(first >= last, "Expected descending order by createdAt");
    }
  });

  // 19. createdFrom/createdTo date range filter
  await test("Date range filter (createdFrom/createdTo)", async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const data = await getBundles({ createdFrom: from, createdTo: to });
    assert(typeof data.total === "number", "Expected total");
    assert((data.total as number) >= 0, "Expected non-negative total");
  });

  // 20. Multiple bundles with pagination totals
  await test("Multiple bundles with correct pagination totals", async () => {
    // Submit 3 bundles with unique referral
    const uniqueRef = `batch-${Date.now()}`;
    await Promise.all([
      submitBundle({ referralCode: uniqueRef }),
      submitBundle({ referralCode: uniqueRef }),
      submitBundle({ referralCode: uniqueRef }),
    ]);
    const data = await getBundles({ referralCode: uniqueRef, pageSize: "2", page: "1" });
    assert(data.total === 3, `Expected total 3, got ${data.total}`);
    assert((data.bundles as unknown[]).length === 2, `Expected 2 bundles on page 1`);
    assert(data.totalPages === 2, `Expected 2 pages, got ${data.totalPages}`);

    const page2 = await getBundles({ referralCode: uniqueRef, pageSize: "2", page: "2" });
    assert((page2.bundles as unknown[]).length === 1, `Expected 1 bundle on page 2`);
  });

  // --- WebSocket Tests ---
  console.log("\n  WebSocket tests:\n");

  // WS helpers
  function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WS connection timeout")), 5000);
    });
  }

  function wsSend(ws: WebSocket, msg: unknown): void {
    ws.send(JSON.stringify(msg));
  }

  function waitForWsMessage(
    ws: WebSocket,
    predicate: (msg: { event: string; data: Record<string, unknown> }) => boolean,
    timeoutMs: number,
  ): Promise<{ event: string; data: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for WS message")),
        timeoutMs,
      );
      const handler = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      };
      ws.on("message", handler);
    });
  }

  function collectWsMessages(
    ws: WebSocket,
    event: string,
    durationMs: number,
  ): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
    return new Promise((resolve) => {
      const messages: Array<{ event: string; data: Record<string, unknown> }> = [];
      const handler = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString());
        if (msg.event === event) {
          messages.push(msg);
        }
      };
      ws.on("message", handler);
      setTimeout(() => {
        ws.off("message", handler);
        resolve(messages);
      }, durationMs);
    });
  }

  // 21. WS connection and subscribe
  await test("WS: connect and subscribe", async () => {
    const ws = await connectWs();
    try {
      const ackPromise = waitForWsMessage(
        ws,
        (m) => m.event === "subscribe",
        5000,
      );
      wsSend(ws, {
        event: "subscribe",
        data: {
          filters: {
            bundleId: ["0x0000000000000000000000000000000000000000000000000000000000000001"],
          },
        },
      });
      const ack = await ackPromise;
      assert(ack.event === "subscribe", `Expected subscribe ack, got ${ack.event}`);
      const confirm = ack.data.confirm as { filters: { bundleId: string[] }; status: string };
      assert(
        confirm.filters.bundleId.includes("0x0000000000000000000000000000000000000000000000000000000000000001"),
        "Expected bundleId in ack confirm filters",
      );
      assert(confirm.status === "subscribed", `Expected confirm.status subscribed, got ${confirm.status}`);
    } finally {
      ws.close();
    }
  });

  // 22. WS bundle_update on progression
  await test("WS: bundle_update on progression", async () => {
    const bundleId = await submitBundle({ targetStatus: "fulfilled" });
    const ws = await connectWs();
    try {
      const ackPromise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: [bundleId] } } });
      await ackPromise;

      const update = await waitForWsMessage(
        ws,
        (m) => m.event === "bundle_update",
        PROGRESSION_DELAY_MS + 5000,
      );
      assert(update.event === "bundle_update", `Expected bundle_update, got ${update.event}`);
      const bundle = update.data.bundle as Record<string, unknown>;
      assert(bundle.bundleId === bundleId, `Expected bundleId ${bundleId}, got ${bundle.bundleId}`);
      assert(bundle.status !== "created", `Expected status to have progressed, got ${bundle.status}`);
    } finally {
      ws.close();
    }
  });

  // 23. WS two-step progression emits two events
  await test("WS: two-step progression emits two bundle_update events", async () => {
    const bundleId = await submitBundle({ targetStatus: "partially_fulfilled" });
    const ws = await connectWs();
    try {
      const ackPromise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: [bundleId] } } });
      await ackPromise;

      const updates = await collectWsMessages(
        ws,
        "bundle_update",
        2 * PROGRESSION_DELAY_MS + 5000,
      );
      assert(updates.length >= 2, `Expected at least 2 bundle_update events, got ${updates.length}`);
      const statuses = updates.map((u) => (u.data.bundle as Record<string, unknown>).status);
      assert(statuses.includes("partially_fulfilled"), `Expected partially_fulfilled in updates, got: ${statuses.join(", ")}`);
      assert(statuses.includes("fulfilled"), `Expected fulfilled in updates, got: ${statuses.join(", ")}`);
    } finally {
      ws.close();
    }
  });

  // 24. WS unsubscribe stops updates
  await test("WS: unsubscribe stops updates", async () => {
    const bundleIdA = await submitBundle({ targetStatus: "fulfilled" });
    const ws = await connectWs();
    try {
      // Subscribe to bundle A
      const ackPromise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: [bundleIdA] } } });
      await ackPromise;

      // Wait for first update for A
      await waitForWsMessage(
        ws,
        (m) => m.event === "bundle_update" && (m.data.bundle as Record<string, unknown>)?.bundleId === bundleIdA,
        PROGRESSION_DELAY_MS + 5000,
      );

      // Unsubscribe from A
      const unsubPromise = waitForWsMessage(ws, (m) => m.event === "unsubscribed", 5000);
      wsSend(ws, { event: "unsubscribe", data: { filters: { bundleId: [bundleIdA] } } });
      await unsubPromise;

      // Wait and verify no further updates arrive
      const furtherUpdates = await collectWsMessages(
        ws,
        "bundle_update",
        2 * PROGRESSION_DELAY_MS + 2000,
      );
      assert(furtherUpdates.length === 0, `Expected no updates after unsubscribe, got ${furtherUpdates.length}`);
    } finally {
      ws.close();
    }
  });

  // 25. WS no update for unsubscribed bundleId
  await test("WS: no update for unsubscribed bundleId", async () => {
    const bundleIdA = await submitBundle({ targetStatus: "fulfilled" });
    const bundleIdB = await submitBundle({ targetStatus: "fulfilled" });
    const ws = await connectWs();
    try {
      // Subscribe only to A
      const ackPromise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: [bundleIdA] } } });
      await ackPromise;

      // Collect updates for enough time for both to progress
      const updates = await collectWsMessages(
        ws,
        "bundle_update",
        PROGRESSION_DELAY_MS + 5000,
      );

      // All updates should be for A only
      for (const u of updates) {
        const uBundle = u.data.bundle as Record<string, unknown>;
        assert(
          uBundle.bundleId === bundleIdA,
          `Expected updates only for ${bundleIdA}, got update for ${uBundle.bundleId}`,
        );
      }
      assert(updates.length >= 1, "Expected at least 1 update for subscribed bundle");
    } finally {
      ws.close();
    }
  });

  // 26. WS 100 subscription limit (single call with 101 IDs)
  await test("WS: 100 subscription limit", async () => {
    const ws = await connectWs();
    try {
      const ids101 = Array.from({ length: 101 }, (_, i) =>
        "0x" + i.toString(16).padStart(64, "0"),
      );
      const errorPromise = waitForWsMessage(ws, (m) => m.event === "error", 5000);
      const ackPromise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: ids101 } } });

      const err = await errorPromise;
      assert(err.data.code === "SUBSCRIPTION_LIMIT", `Expected SUBSCRIPTION_LIMIT code, got ${err.data.code}`);

      const ack = await ackPromise;
      const confirm = ack.data.confirm as { filters: { bundleId: string[] } };
      assert(
        confirm.filters.bundleId.length === 100,
        `Expected 100 accepted IDs, got ${confirm.filters.bundleId.length}`,
      );
    } finally {
      ws.close();
    }
  });

  // 27. WS subscribe replaces, does not merge
  await test("WS: subscribe replaces, does not merge", async () => {
    const ws = await connectWs();
    try {
      const idA = "0x" + "aa".repeat(32);
      const idB = "0x" + "bb".repeat(32);
      const idC = "0x" + "cc".repeat(32);

      // Subscribe to [A, B]
      const ack1Promise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: [idA, idB] } } });
      const ack1 = await ack1Promise;
      const confirm1 = ack1.data.confirm as { filters: { bundleId: string[] } };
      assert(confirm1.filters.bundleId.length === 2, `Expected 2 subscribed IDs, got ${confirm1.filters.bundleId.length}`);

      // Subscribe to [C] — should replace, not merge
      const ack2Promise = waitForWsMessage(ws, (m) => m.event === "subscribe", 5000);
      wsSend(ws, { event: "subscribe", data: { filters: { bundleId: [idC] } } });
      const ack2 = await ack2Promise;
      const confirm2 = ack2.data.confirm as { filters: { bundleId: string[] } };
      assert(confirm2.filters.bundleId.length === 1, `Expected 1 subscribed ID (replace), got ${confirm2.filters.bundleId.length}`);
    } finally {
      ws.close();
    }
  });

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Smoke test runner failed:", err);
  process.exit(1);
});
