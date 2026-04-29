# 📊 Excel Combiner System — PRD (Final Combined Version)

---

## 🎯 1. Goal

Build a **smart, scalable, template-aware Excel Combiner system** that:

- Converts large CSV datasets into Excel reports
- Automatically decides:
  - Number of Excel files
  - Sheets per file
  - Split strategy

- Supports:
  - **Template-based reporting**
  - **Append / Replace modes**

- Ensures:
  - Excel files **always open successfully**
  - **Connection-wise data integrity**
  - **No system overload**

---

## 🧠 2. Core Principles

1. Excel = **reporting layer**, not raw storage
2. CSV = **source of truth**
3. Connection = **atomic unit (do not randomly split)**
4. System-aware (RAM, size, load)
5. Estimate → Validate → Adjust (live tracking)
6. Always have **fail-safe (CSV fallback)**

---

## 📥 3. Input

- CSV Folder
  - Multiple CSV files
  - Each file belongs to a **connection**

- Optional:
  - Template Excel file

- System:
  - RAM
  - CPU (optional)

---

## 📤 4. Output

### Possible Outputs

#### ✅ Small Data

- Single Excel
- Multiple sheets

#### ✅ Medium Data

- Single Excel
- Multi-sheet (row split)

#### ✅ Large Data

- Multiple Excel files (per connection)

#### ❌ Very Large Data

- CSV only + Summary Excel

---

## ⚙️ 5. System Flow

```text
1. Scan CSV Folder
2. Group by Connection
3. Estimate Size
4. Detect System Capacity
5. Decide Strategy
6. Allocate CSV → Excel
7. Apply Template Mode
8. Write Sheets
9. Live Tracking
10. Rotate Files
11. Generate Summary
```

---

## 📊 6. Estimation Logic

### Excel Size

```text
Excel ≈ CSV × 1.2
```

---

### RAM-based Limits

| RAM  | Safe Excel Size |
| ---- | --------------- |
| 4GB  | 20MB            |
| 8GB  | 40MB            |
| 16GB | 80MB            |
| 32GB | 120MB           |

---

### Safety Margin

```text
usableSize = RAM_limit × 0.8
```

---

### File Count

```text
files = ceil((CSV × 1.2) / usableSize)
```

---

## 🧠 7. Decision Engine

| Size      | Action     |
| --------- | ---------- |
| ≤ 50MB    | Auto Excel |
| 50–100MB  | Auto Split |
| 100–200MB | Manual     |
| > 200MB   | CSV Only   |

---

## 📦 8. Allocation Rules

### 🔴 MUST RULE

> Same connection data should NOT be randomly split across Excel files

---

### Group-based Allocation

- Each connection handled independently

---

### Cases

#### Small Connection

- 1 Excel file

#### Medium Connection

- 1 Excel file, multiple sheets

#### Large Connection

- Multiple Excel files (same connection)

---

## 📄 9. Sheet Management

- Max rows per sheet: **100k–150k**
- Auto new sheet

### Naming

```text
Conn1_part1
Conn1_part2
```

---

## 📁 10. File Rotation

Trigger new file if:

- File size > limit
- Sheet count > limit

---

## ✍️ 11. Writer Engine

- Streaming write
- Append mode
- Buffered writes

---

## 📈 12. Live Tracking

Track:

- File size
- Row count
- Sheet count

```text
if limit exceeded → rotate
```

---

# 🧩 13. Template System (NEW)

---

## 🎯 Purpose

Enable **report-ready Excel generation** using predefined templates.

---

## 🔹 Template Modes

### 1. NEW_TEMPLATE

```text
Template.xlsx → copied → Output files
```

✔ Each Excel file gets a fresh template copy
✔ Template sheets preserved
✔ Data sheets added

---

### 2. EXISTING_TEMPLATE

```text
Existing.xlsx → updated
```

---

## 🔹 Write Modes (only for EXISTING)

### APPEND

```text
Old data preserved
New data added at end
```

---

### REPLACE

```text
Old data cleared
New data written fresh
```

---

## ⚙️ Template Config

```ts
{
  templateMode: "NEW" | "EXISTING",
  templatePath: "...",
  writeMode: "APPEND" | "REPLACE",
  autoCreateNewFile: true
}
```

---

## 🧠 Template Rules

### Rule 1: Copy Behavior

```text
NEW → copy template for each Excel file
```

---

### Rule 2: Existing File

```text
EXISTING → open file and modify
```

---

### Rule 3: Append / Replace

```text
APPEND → continue from last row
REPLACE → clear sheet then write
```

---

### Rule 4: Multi-file Limitation

- EXISTING mode → only 1 Excel file supported
- NEW mode → multiple files allowed

---

### Rule 5: Formula Safety

- Template formulas must not break
- Sheet naming must be consistent

---

## 📊 14. Summary & Reporting

Each connection:

- total rows
- file parts
- metadata

### Summary Excel

- connection stats
- file references

---

## ⚠️ 15. Edge Cases (MUST HANDLE)

---

### ❗ 1. Single Huge CSV (5M+)

- split into sheets/files

---

### ❗ 2. Mixed Sizes

- handle per connection

---

### ❗ 3. Many Small CSV

- combine in one Excel

---

### ❗ 4. Memory Spike

- pause / rotate

---

### ❗ 5. Excel Open Failure

- fallback to CSV

---

### ❗ 6. Estimation Error

```text
if actual > estimate → early split
```

---

### ❗ 7. Connection Integrity

❌ never mix randomly

---

### ❗ 8. Sheet Overflow

✔ enforce row limit

---

### ❗ 9. Template Conflicts

- sheet exists → append/replace logic
- invalid template → fail-safe

---

### ❗ 10. Multi-file + Template

- NEW → copy each file
- EXISTING → restrict

---

## 🔁 16. Fail-Safe

- retry logic
- resume support
- CSV fallback

---

## 🧩 17. Module Architecture

```text
combiner/
 ├── analyzer.ts
 ├── decision.ts
 ├── allocator.ts
 ├── templateManager.ts
 ├── sheetManager.ts
 ├── fileRotator.ts
 ├── writer.ts
 ├── tracker.ts
 └── summary.ts
```

---

## ✅ 18. Implementation Checklist

### Phase 1

- [ ] Scan CSV
- [ ] Estimate rows

### Phase 2

- [ ] Detect RAM
- [ ] Apply limits

### Phase 3

- [ ] Decide strategy

### Phase 4

- [ ] Allocate connections

### Phase 5

- [ ] Template handling

### Phase 6

- [ ] Sheet + file control

### Phase 7

- [ ] Live tracking

### Phase 8

- [ ] Summary + fail-safe

---

## 🏁 19. Success Criteria

✔ Excel opens smoothly
✔ No data loss
✔ Connection integrity maintained
✔ Handles millions of rows
✔ Template works correctly
✔ System stable under load

---

## 🔥 Final Principle

> “Smart system data ko force nahi karta — adapt karta hai, protect karta hai, aur report deliver karta hai.”

---
