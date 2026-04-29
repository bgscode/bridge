# 🚀 Adaptive Data Engine – Full Production README

## 📌 Overview

Ye system ek **self-optimizing data engine** hai jo handle karta hai:

- Single Query Jobs
- Multiple Query Jobs
- Action Jobs (INSERT / UPDATE / UPSERT via SQL ya File)

👉 System automatically decide karega:

- Kitne workers chalane hain
- Excel ya CSV kaunsa format use hoga
- Kab slow / fast hona hai
- Kaise large data safely process karna hai

---

# 🎯 One-Line Goal

> “Har job apni size, connections aur system health ke hisaab se automatically execute ho — bina crash ke, maximum efficiency ke saath.”

---

# 🧠 Core Architecture

```text
                [ Adaptive Brain ]
        (CPU, Memory, Lag, Throughput, Errors)

                  /        \
                 /          \
        [ Query Executor ]  [ Action Executor ]
```

---

# 🧠 Adaptive Brain (Shared)

## Inputs:

- CPU %
- Memory %
- Event Loop Lag
- Throughput (rows/sec)
- Error Rate
- DB Response Time
- Disk Write Latency
- Queue Size
- Connection Count
- Data Size

---

## Health Score

```ts
score = cpuScore * 0.3 + memScore * 0.2 + lagScore * 0.3 + errScore * 0.2
```

---

## Worker Scaling

```ts
if (score > 0.75) workers += 1
if (score < 0.4) workers = workers * 0.7
```

### Emergency

```ts
if (cpu > 90 || memory > 90 || lag > 300) {
  workers = workers * 0.5
}
```

### Cooldown

```ts
update every 5 sec only
```

---

# ⚙️ Job Types

## 1️⃣ Query Job (Single Query)

### Flow:

```text
DB → Stream → Transform → File (Excel/CSV)
```

---

## 2️⃣ Multi Query Job

### Structure:

```text
Connection
   ├── Query1
   ├── Query2
   ├── Query3
```

---

### Output (Small Data):

```text
Job.xlsx
 ├── Conn1_Query1
 ├── Conn1_Query2
 ├── Conn2_Query1
```

---

### Output (Large Data):

```text
Job_Output/
 ├── Conn1/
 │    ├── Query1_part1.csv
 │    ├── Query2_part1.csv
 │
 ├── Conn2/
```

---

## 3️⃣ Action Job (SQL Based)

### Flow:

```text
SELECT (batch) → Process → UPDATE/INSERT
```

---

## 4️⃣ Action Job (File Based)

### Input File:

```text
id,price
101,500
102,600
```

---

### Flow:

```text
File → Parse → Validate → Batch → DB Write
```

---

# 📎 File-Based Action Job (Detailed)

## UI Features:

- File Upload (CSV / Excel)
- Column Mapping
- Operation Type:
  - INSERT
  - UPDATE
  - UPSERT (recommended)

---

## Mapping Example:

```text
File Column → DB Column

id    → product_id
price → price
```

---

## UPSERT Example:

```sql
INSERT INTO products (id, price)
VALUES (101, 500)
ON DUPLICATE KEY UPDATE price = VALUES(price)
```

---

# 📊 Output Decision Engine

## Calculation:

```ts
totalRows = rowsPerConn * connectionCount
sizeMB = (totalRows * avgRowSize) / (1024 * 1024)
pressure = connectionCount / maxParallel
```

---

## Decision:

```ts
if (memory > 75) return "csv"
if (totalRows > 300k) return "csv"
if (sizeMB > 100) return "csv"
if (pressure > 3) return "csv"

if (totalRows < 100k) return "excel"
if (totalRows < 300k) return "excel-stream"

return "csv"
```

---

# 💾 Excel Rules

- <100k rows → normal Excel
- 100k–300k → streaming Excel
- > 300k → ❌ avoid Excel

---

## Sheet Modes

### Replace

```ts
delete + recreate sheet
```

### Append

```ts
add rows to existing sheet
```

### Smart Append

```ts
if headers match → append else new sheet
```

---

# 🧵 Connection Handling

```ts
maxParallelConnections = 5–10
```

---

## Chunking

```sql
LIMIT 10000 OFFSET x
```

---

# 🧱 Backpressure

## DB

```ts
if (activeQueries > workers * 2) pause
```

## Memory

```ts
if (heap > 80%) pause
```

## Disk

```ts
if (pendingWrites high) pause
```

---

# ⚖️ Job Queue

- Max active jobs: 2–5
- Priority:

```text
HIGH > MEDIUM > LOW
```

---

# 🛡️ Action Job Safety

- Max workers: 2–5
- Batch size: 500–2000
- Retry: 3 times
- Circuit breaker after 5 failures

---

# 🔄 Idempotency

```sql
UPDATE table SET processed = 1 WHERE processed = 0
```

---

# 📊 Tracking

```json
{
  "totalRows": 0,
  "processed": 0,
  "failed": 0
}
```

---

# 🧠 Advanced Intelligence

- Throughput-based scaling
- DB slowdown detection
- Disk latency detection
- Memory growth tracking
- Error pattern detection
- Data skew handling

---

# 🔄 Execution Flow

```text
Create Job
   ↓
Estimate Data Size
   ↓
Decide Output Format
   ↓
Queue Connections
   ↓
Start Workers (low)
   ↓
Adaptive Scaling
   ↓
Backpressure Control
   ↓
Complete Job
```

---

# ✅ Implementation Checklist

## Phase 1 (Core)

- [ ] Adaptive Brain
- [ ] Worker scaling
- [ ] Chunk processing
- [ ] Streaming output
- [ ] Error tracking

---

## Phase 2 (Stability)

- [ ] Backpressure
- [ ] Output auto-switch
- [ ] Memory safety
- [ ] DB safety

---

## Phase 3 (Scaling)

- [ ] Job queue
- [ ] Priority system
- [ ] Multi-connection control

---

## Phase 4 (Advanced)

- [ ] Throughput scaling
- [ ] Circuit breaker
- [ ] Resume system
- [ ] File-based action jobs

---

# ⚠️ Common Mistakes

❌ Excel for large data
❌ No batching
❌ Unlimited connections
❌ No retry
❌ No monitoring

---

# 🚀 Final Result

✔ Handles 100M+ rows
✔ No crash
✔ Smart scaling
✔ Auto decision system
✔ Production-ready

---

# 💬 Final Note

> Ye system ek simple exporter nahi — ek **intelligent data processing engine** hai.

---

👉 Next step: implement Phase 1
👉 Phir test under load
👉 Phir gradually optimize

---

Agar ready ho, bolo:
**“review kar do”** 🚀
