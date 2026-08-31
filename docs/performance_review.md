# Performance Review — Hostel Buddy

Where time and resources are actually spent, the optimizations applied, and the trade-offs deliberately accepted for a v1 demo. This is a living document — numbers are filled in as the app is measured.

---

## 1. Performance Budget (from NFRs)

| Operation | Target | Rationale |
|-----------|--------|-----------|
| Dashboard load | 2–3 s | Perceived as "instant enough" for an admin scanning status. |
| Complaint submission | ≤ 2 s | Keep the student in flow; upload dominates the time. |
| API read (list/detail) | < 300 ms server time | Leaves headroom under the page budget. |

---

## 2. Hot Paths

The three requests that run most often and therefore matter most:

1. **`GET /complaints/mine`** — every student dashboard visit.
2. **`GET /complaints` (admin, filtered)** — the admin's main working screen.
3. **`GET /dashboard/admin`** — aggregate counts + category distribution.

Everything else (register, edit, status change) is comparatively rare and not worth early optimization.

---

## 3. Optimizations Applied

### 3.1 Database indexes
`idx_complaints_user`, `idx_complaints_status`, `idx_complaints_cat` back exactly the hot paths above. Without them, the admin's filtered list and the dashboard aggregates degrade to full table scans as complaint volume grows.

> **Trade-off:** indexes cost write time and disk. Complaints are read far more than written, so the trade is strongly favorable.

### 3.2 Aggregation in SQL, not in JS
Dashboard counts use `GROUP BY` / `COUNT` in a single query rather than fetching all rows and counting in Node. This keeps the payload tiny and pushes the work to the engine that's best at it.

```sql
SELECT status, COUNT(*) AS n FROM complaints GROUP BY status;
SELECT category, COUNT(*) AS n FROM complaints GROUP BY category;
```

### 3.3 Pagination on the admin list
`GET /complaints` is paginated (`page`, `limit`). The admin never pulls thousands of rows in one response — bounded payloads keep response time flat as data grows.

### 3.4 Stateless auth (JWT)
No session store lookup per request; the token is verified in-process. This removes a round-trip and makes horizontal scaling free (no shared session state).

### 3.5 Static frontend
Pages are plain static files and Chart.js is vendored locally under `/vendor` — no server-side rendering cost, no third-party request on the critical path, cacheable by the browser, and the API only ever ships JSON.

---

## 4. Measurements

Measured against a realistic dataset of **200 students and 2,000 complaints** using `node:sqlite`. Numbers are **server-side query time** for the data-access layer (the work that scales with data size), timed with `process.hrtime` — "cold" is the first call, "warm" is the average of 50 subsequent calls.

| Operation (hot path) | Cold | Warm | Notes |
|----------------------|------|------|-------|
| `GET /complaints/mine` (`findByUser`) | 0.23 ms | **0.07 ms** | Index-backed by `idx_complaints_user`. |
| `GET /complaints?status=Pending` p1 (`search`) | 2.55 ms | **0.71 ms** | Filtered + paginated join, `idx_complaints_status`. |
| `GET /complaints?q=<name>` p1 (`search`) | 1.29 ms | **1.05 ms** | `LIKE` name/room scan across the join. |
| `GET /dashboard/admin` (aggregation) | 1.67 ms | **1.16 ms** | Four `GROUP BY`/`COUNT` queries + recent. |
| Complaint insert (DB write only) | 10.1 ms | **0.85 ms** | Cold cost is first WAL write; excludes HTTP + image upload. |

**Interpretation:** every read path completes in **~1 ms or less warm**, roughly three orders of magnitude under the 2–3 s page budget — the database is nowhere near being the bottleneck at this scale. End-to-end request time is dominated by network latency and, for submissions, image upload size rather than by query work. The one-off ~10 ms cold insert is the first write-ahead-log write and amortizes immediately.

---

## 5. Known Bottlenecks & Trade-offs (accepted for v1)

| Area | Current state | Why accepted | Production fix |
|------|---------------|--------------|----------------|
| **SQLite write concurrency** | Single-writer lock. | Demo has low write volume. | Postgres (data-access layer only). |
| **Local image storage** | Files on the app server's disk. | Simplest working upload. | Object store + CDN. |
| **No response caching** | Every dashboard hit recomputes aggregates. | Data is small; correctness over caching. | Short-TTL cache / materialized counts. |
| **Full image served inline** | No thumbnailing. | Images are optional and few. | Generate + serve thumbnails. |
| **Chart.js vendored, unminified-path** | Served locally from `/vendor` (no CDN). | Offline-friendly demo, no build step. | Bundle/minify with the rest of the assets. |

---

## 6. Scalability Notes

Because the app tier is stateless and the aggregations are index-backed SQL, the realistic scaling limit for v1 is the **single SQLite writer**, not CPU or the app code. The documented migration to Postgres removes that ceiling without touching business logic — which is the whole point of the layered architecture ([architecture.md](architecture.md) §2, §7).

---

## 7. What I'd Measure Next

- p95 latency of the admin filtered list under 10k complaints.
- Effect of adding a composite index `(status, category)` for combined filters.
- Upload time distribution by image size to validate the 2 s submission budget.
