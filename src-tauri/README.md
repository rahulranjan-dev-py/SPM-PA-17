# HandToHand X — Sub Office cash register, chest tally & SMR (PA-17) batch engine

Offline-first desktop replacement for the legacy Python/Tkinter utility **"HandToHand V9.1 with SMR for all SO"** used in India Post Sub Offices. Built with **Tauri v2** (Rust core + embedded SQLite in WAL mode) and a **React 19 / TypeScript / Tailwind CSS v4 / Radix UI** front end. Windows 10/11 is the primary target; Linux and macOS builds work from the same source.

| Legacy (V9.1)                                   | HandToHand X                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Single office, single `HandToHand.dba` file     | Any number of Sub Offices under one Sub-Division / HO, one WAL database      |
| Receipt / payment heads typed per day           | Voucher ledger per counter with categories, barcode IDs, verification status |
| Office currency counter (₹500 … ₹10 + coin + CITEM) | Full denomination dock (₹500 … ₹1, mixed coins, CITEM) + dual-tally comparator |
| "SPM Monthly Report" for one office             | One-click PA-17 compilation for **all** offices, with validation flags       |
| Manual backup / restore                         | Verified snapshot on every close, retention, restore with safety copy        |
| No user separation                              | Operator vs Supervisor/SPM tiers, PIN login, immutable audit trail           |
| ReportLab PDF                                   | Vector PDF (jsPDF), Excel (ExcelJS), CSV, native A4 print, ESC/POS raw slips |

## Repository layout

```
src-tauri/
  Cargo.toml                 workspace: the Tauri shell + crates/htoh-core
  tauri.conf.json            window, CSP, bundling (NSIS/MSI on Windows)
  capabilities/default.json  Tauri v2 permissions (dialog, opener, webview print)
  src/lib.rs                 app state, close-time backup snapshot, command registry
  src/commands.rs            IPC surface (thin wrappers over the core)
  crates/htoh-core/
    schema.sql               ← database schema deliverable
    src/money.rs             fixed-point paise arithmetic (no floats)
    src/tally.rs             denomination totals + Balanced / Surplus / Deficit comparator
    src/db.rs                SQLite (WAL, FK on), roles, ledger, closings, limits, audit
    src/smr.rs               PA-17 aggregation and batch compilation
    src/backup.rs            VACUUM INTO snapshots, verify, prune, restore
    src/printing.rs          ESC/POS builder, RAW spooling (TCP 9100 / device / winspool)
    src/barcode.rs           UPU S10 check-digit validation
src/
  lib/money.ts               paise arithmetic mirrored in TypeScript (decimal.js for parsing only)
  lib/ipc.ts, lib/mockApi.ts typed IPC contract + in-browser mock backend (dev/test)
  lib/wedge.ts, hooks/       barcode-wedge detector, F-key hotkeys
  lib/export/                PDF (PA-17, closing sheet, hand-over receipt), XLSX, CSV
  lib/print/slip.ts          ESC/POS + 80-column dot-matrix layouts
  store/                     Zustand stores (session, office, ledger, tally, smr, ui)
  features/                  ledger, tally, closing, smr, settings, audit, auth
```

## Running

Prerequisites: Node 22+, Rust 1.80+, and the Tauri v2 platform prerequisites (on Windows: WebView2 runtime and the MSVC build tools; see https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev          # desktop app with hot reload
npm run tauri build        # installers under src-tauri/target/release/bundle
npm run dev                # UI only in a browser, backed by the in-memory mock
npm test                   # front-end unit tests (vitest)
npm run test:rust          # core + shell tests (cargo test --workspace)
npm run typecheck && npm run build
```

Set `HTOH_DATA_DIR` to override where `HandToHand.db` and `Automatic Backup/` live (default: the OS app-data directory, e.g. `%APPDATA%\in.dop.handtohandx`).

First sign-in: user `spm`, PIN `1234`. The app forces a PIN change before anything else. Create operator accounts under **Offices & Settings → Users & access**.

## Keyboard-first operation

| Key            | Action                                                              |
| -------------- | ------------------------------------------------------------------- |
| `F2`           | Cash denomination calculator (numpad-optimised modal)               |
| `F3`           | New voucher / article entry                                         |
| `F5`           | Refresh and recalculate the daily balance                           |
| `F9`           | Tally & verification                                                |
| `F10`          | Daily closing sheet (ledger) / SMR export hint (hub)                |
| `Enter`, `Tab` | Next field; `Enter` on the amount saves and starts the next voucher |
| `Esc`          | Close the current panel                                             |

**Barcode wedge:** any USB scanner that types keystrokes is detected globally (burst of ≥ 6 characters faster than 40 ms/char, terminated by Enter). The code is routed into the voucher form regardless of focus, the UPU S10 check digit is validated, and the service indicator (EM…, RM…, CP…) pre-selects Speed Post / Registered / Parcel.

## Money, tally and closing rules

* Every amount is an integer number of **paise** end to end (`INTEGER` columns, `Money(i64)` in Rust, `Paise` in TypeScript). Parsing rejects more than two decimals instead of rounding.
* **Book closing** = opening balance + receipts − payments over all non-rejected vouchers of the day. The opening balance is the previous saved day's closing (holidays skipped), or the office's initial opening on the register start date. Editing an earlier day rolls the new closing forward into every later saved day (legacy behaviour preserved).
* **Dual tally:** A = system book balance (Finacle / SAP CSI figure, or the book closing when no extract is entered), B = physical cash from the chest count. Variance = B − A → `Balanced (₹0.00)`, `Surplus (+₹X.XX)` or `Deficit (-₹X.XX)`.
* **PA-17 cash in hand** = chest total − cash items (CITEM); balance due to PO = cash in hand; cash received / remitted come from `TREASURY_RECEIVED` / `TREASURY_REMITTED` vouchers unless overridden per day.
* **Cash limit violations** are logged automatically whenever a working day's closing exceeds the office maximum or falls below the minimum reserve, and surface on the SMR hub as *Cash limit breached*.
* A day can only be **closed** by a supervisor once every voucher is accepted or rejected.

## SMR / PA-17 batch engine

**SMR Hub** lists every active Sub Office for the selected month with status (`Ready to export`, `Pending vouchers`, `Cash limit breached`, `No data`), validation flags, breaches, closing balance and sign-off. *Compile all offices* rebuilds the snapshot for every office in one call; exports (per-office PDF, batch PDF to a folder, one Excel workbook with a sheet per office, flat CSV) come from that snapshot. The office detail screen edits the manual PA-17 columns (stamps received/remitted, postage/revenue/other stamps, liabilities & explanation for excess cash), the monthly stamp & stationery stock (opening, receipts, sales, closing) and lets the SPM sign the month off, which locks operator edits.

## Backup, audit and access tiers

* **Snapshots:** on every window close and on demand, the core checkpoints the WAL and writes `HandToHand_Backup_YYYYMMDD_HHMMSS_<label>.db` with `VACUUM INTO`, verifies it with `PRAGMA integrity_check`, and prunes to the configured count (default 30). The folder is configurable (USB drive, network share). Restore writes a safety snapshot of the live database first.
* **Audit trail:** every voucher create/update/delete, verification, hand-over submit/verify, cash count, system-balance override, day close/reopen, SMR save/compile/sign-off, office/user change, login and restore is recorded with before/after JSON. SQLite triggers reject any `UPDATE` or `DELETE` on `audit_logs`.
* **Tiers:** *Operator* — voucher entry, chest count, hand-over submission, own PIN. *Supervisor / SPM* — verification, day close/reopen, offices, users, settings, backup restore, SMR sign-off. Enforced in the Rust core, not only in the UI.

## Printing and export

* **Slip / dot-matrix:** hand-over slips are built as ESC/POS bytes (init, alignment, bold, double-height, feed, cut); closing sheets as 80-column plain text. The core spools RAW to a Windows printer by name (`winspool` `OpenPrinterW` / `WritePrinter`, datatype `RAW`), a TCP 9100 network printer, a device/port path (`LPT1`, `/dev/usb/lp0`, `\\server\share`) or a file.
* **A4:** the native print dialog (`window.print()` with print CSS) and vector PDF export via jsPDF/autotable — PA-17 landscape, daily closing sheet, hand-over receipt.
* **Audit exports:** Excel (`.xlsx`) and CSV for the ledger, the SMR batch and the audit trail.

## Verification performed

* `cargo test --workspace` — 20 core tests (money, tally, S10, ESC/POS, backup round-trip, WAL/FK setup, role enforcement, ledger day flow with limit logging and roll-forward, audit immutability, SMR batch).
* `cargo check` for Linux and `cargo check --target x86_64-pc-windows-gnu` (exercises the Windows spooler code path).
* `npm run typecheck`, `vitest` (money/tally/barcode/wedge) and `vite build`.
* Playwright smoke run against the built UI with the mock backend: login → F3 voucher → simulated wedge scan → F2 chest count → accept → close day → F10 sheet → SMR compile/detail → dark mode → settings → audit.
