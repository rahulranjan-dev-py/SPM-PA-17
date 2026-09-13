-- =====================================================================
--  HandToHand X — SQLite schema
--  Offline-first Sub Office (SO) hand-to-hand register, chest tally and
--  SMR / PA-17 batch engine (successor to "HandToHand V9.1 with SMR for all SO")
--
--  Conventions
--    * All monetary columns are INTEGER **paise** (fixed-point, 1 rupee = 100).
--      Never store rupees as REAL. The application converts at the boundary
--      using the Money type (Rust) / Money class (TypeScript).
--    * Dates are ISO-8601 TEXT: business_date = 'YYYY-MM-DD', month = 'YYYY-MM',
--      timestamps = 'YYYY-MM-DDTHH:MM:SSZ' (UTC).
--    * Ids are TEXT UUIDv4 so records can be merged across devices/backups.
--    * The connection is opened with  PRAGMA journal_mode=WAL,
--      PRAGMA synchronous=NORMAL, PRAGMA foreign_keys=ON  (see db.rs).
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
--  Settings & schema versioning
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------
--  Offices (Sub Offices under one Sub-Division / Head Office)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offices (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL CHECK (length(trim(name)) > 0),
    pincode               TEXT NOT NULL CHECK (length(pincode) = 6 AND pincode GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'),
    facility_id           TEXT NOT NULL DEFAULT '' ,          -- CSI facility id (e.g. PO37000112345)
    office_type           TEXT NOT NULL DEFAULT 'SO' CHECK (office_type IN ('SO','BO','HO')),
    division              TEXT NOT NULL DEFAULT '',
    sub_division          TEXT NOT NULL DEFAULT '',
    head_office           TEXT NOT NULL DEFAULT '',
    postmaster_name       TEXT NOT NULL DEFAULT '',
    postmaster_designation TEXT NOT NULL DEFAULT 'SPM',
    postmaster_phone      TEXT NOT NULL DEFAULT '',
    min_cash_limit_paise  INTEGER NOT NULL DEFAULT 0 CHECK (min_cash_limit_paise >= 0),
    max_cash_limit_paise  INTEGER NOT NULL DEFAULT 0 CHECK (max_cash_limit_paise >= 0),
    register_start_date   TEXT,                                   -- first business date of this register
    initial_opening_paise INTEGER NOT NULL DEFAULT 0 CHECK (initial_opening_paise >= 0),
    active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK (max_cash_limit_paise = 0 OR max_cash_limit_paise >= min_cash_limit_paise)
);
CREATE INDEX IF NOT EXISTS idx_offices_active ON offices(active, name);

-- ---------------------------------------------------------------------
--  Users & access tiers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(username)) >= 2),
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('operator','supervisor')),
    office_id     TEXT REFERENCES offices(id) ON DELETE SET NULL,   -- NULL = all offices
    pin_salt      TEXT NOT NULL,
    pin_hash      TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    last_login_at TEXT
);

-- ---------------------------------------------------------------------
--  Holidays (Sundays are implicit; this table lists explicit closures)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holidays (
    office_id     TEXT NOT NULL DEFAULT '*',      -- '*' = every office
    holiday_date  TEXT NOT NULL CHECK (holiday_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    note          TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (office_id, holiday_date)
);

-- ---------------------------------------------------------------------
--  Handovers: one ledger sheet per counter per business day
--  (PA -> SPM / Treasury). Voucher items hang off a handover.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS handovers (
    id                    TEXT PRIMARY KEY,
    office_id             TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    business_date         TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    counter_label         TEXT NOT NULL DEFAULT 'Counter 1',
    sequence_no           INTEGER NOT NULL DEFAULT 1 CHECK (sequence_no >= 1),
    direction             TEXT NOT NULL DEFAULT 'pa_to_spm' CHECK (direction IN ('pa_to_spm','spm_to_pa','treasury')),
    from_user_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
    to_user_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','verified','rejected')),
    system_book_balance_paise INTEGER CHECK (system_book_balance_paise IS NULL OR system_book_balance_paise >= 0), -- Finacle / SAP CSI closing figure
    physical_cash_paise   INTEGER CHECK (physical_cash_paise IS NULL OR physical_cash_paise >= 0),                  -- denomination total at submission
    notes                 TEXT NOT NULL DEFAULT '',
    submitted_at          TEXT,
    verified_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
    verified_at           TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (office_id, business_date, counter_label, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_handovers_office_date ON handovers(office_id, business_date);
CREATE INDEX IF NOT EXISTS idx_handovers_status ON handovers(status);

-- ---------------------------------------------------------------------
--  Voucher items (the individual lines exchanged hand to hand)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voucher_items (
    id                    TEXT PRIMARY KEY,
    handover_id           TEXT NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
    category              TEXT NOT NULL CHECK (category IN ('savings_bank','mails_parcels','remittances','insurance')),
    voucher_type          TEXT NOT NULL CHECK (length(trim(voucher_type)) > 0),  -- SB, RD, TD, MIS, SCSS, PPF, SSA, NSC, KVP, SPEED_POST, REGISTERED, PARCEL, COD, EMO, TREASURY_RECEIVED, TREASURY_REMITTED, IPPB_DEPOSIT, IPPB_WITHDRAWAL, PLI, RPLI ...
    flow                  TEXT NOT NULL CHECK (flow IN ('receipt','payment')),   -- receipt = cash comes INTO office cash; payment = cash goes OUT
    account_or_barcode_id TEXT NOT NULL DEFAULT '',
    voucher_count         INTEGER NOT NULL DEFAULT 1 CHECK (voucher_count >= 1),
    amount_paise          INTEGER NOT NULL CHECK (amount_paise >= 0),
    reference_id          TEXT NOT NULL DEFAULT '',                              -- SAP document / batch id
    submitted_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    verification_status   TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','accepted','rejected')),
    verified_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
    verified_at           TEXT,
    remarks               TEXT NOT NULL DEFAULT '',
    created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK ((verification_status = 'pending') = (verified_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_voucher_items_handover ON voucher_items(handover_id);
CREATE INDEX IF NOT EXISTS idx_voucher_items_status ON voucher_items(verification_status);
CREATE INDEX IF NOT EXISTS idx_voucher_items_barcode ON voucher_items(account_or_barcode_id);

-- ---------------------------------------------------------------------
--  Cash denominations
--    scope = 'chest'    : office chest / Office Currency Counter for a date
--    scope = 'handover' : cash physically passed with a specific handover
--    scope = 'customer' : temporary customer cash counter (not office cash)
--  kind = 'note' | 'coin' : line_total = face_value * quantity
--  kind = 'mixed_coins'   : loose coins entered as a total amount
--  kind = 'citem'         : cash items (cheques/vouchers held as cash) — excluded from PA-17 cash in hand
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_denominations (
    id                TEXT PRIMARY KEY,
    office_id         TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    business_date     TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    scope             TEXT NOT NULL DEFAULT 'chest' CHECK (scope IN ('chest','handover','customer')),
    handover_id       TEXT REFERENCES handovers(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('note','coin','mixed_coins','citem')),
    face_value_paise  INTEGER NOT NULL DEFAULT 0 CHECK (face_value_paise >= 0),
    quantity          INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    line_total_paise  INTEGER NOT NULL CHECK (line_total_paise >= 0),
    entered_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK (kind IN ('mixed_coins','citem') OR line_total_paise = face_value_paise * quantity),
    CHECK (kind NOT IN ('note','coin') OR face_value_paise IN (50000,20000,10000,5000,2000,1000,500,200,100)),
    CHECK ((scope = 'handover') = (handover_id IS NOT NULL))
);
-- NULL handover_id must still collapse to a single chest/customer line per face value
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_denominations_line
    ON cash_denominations(office_id, business_date, scope, COALESCE(handover_id, ''), kind, face_value_paise);
CREATE INDEX IF NOT EXISTS idx_cash_denominations_office_date ON cash_denominations(office_id, business_date, scope);

-- ---------------------------------------------------------------------
--  Daily closings (the daily "Hand to Hand" book figure per office)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_closings (
    office_id                 TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    business_date             TEXT NOT NULL CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    opening_balance_paise     INTEGER NOT NULL CHECK (opening_balance_paise >= 0),
    total_receipts_paise      INTEGER NOT NULL CHECK (total_receipts_paise >= 0),
    total_payments_paise      INTEGER NOT NULL CHECK (total_payments_paise >= 0),
    closing_balance_paise     INTEGER NOT NULL,                                   -- OB + receipts - payments (book)
    system_book_balance_paise INTEGER,                                            -- Finacle / SAP figure (optional)
    physical_cash_paise       INTEGER NOT NULL DEFAULT 0 CHECK (physical_cash_paise >= 0),
    variance_paise            INTEGER NOT NULL DEFAULT 0,                         -- physical - book (+ surplus, - deficit)
    status                    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_by                 TEXT REFERENCES users(id) ON DELETE SET NULL,
    closed_at                 TEXT,
    remarks                   TEXT NOT NULL DEFAULT '',
    updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (office_id, business_date),
    CHECK (closing_balance_paise = opening_balance_paise + total_receipts_paise - total_payments_paise)
);

-- ---------------------------------------------------------------------
--  Cash limit violation log (auto-populated when a day is recalculated)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_limit_violations (
    id                    TEXT PRIMARY KEY,
    office_id             TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    business_date         TEXT NOT NULL,
    limit_type            TEXT NOT NULL CHECK (limit_type IN ('max','min')),
    limit_paise           INTEGER NOT NULL CHECK (limit_paise >= 0),
    closing_balance_paise INTEGER NOT NULL,
    breach_paise          INTEGER NOT NULL CHECK (breach_paise > 0),             -- amount over max / under min
    detected_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (office_id, business_date, limit_type)
);
CREATE INDEX IF NOT EXISTS idx_violations_office_date ON cash_limit_violations(office_id, business_date);

-- ---------------------------------------------------------------------
--  SMR / PA-17 monthly entries (manual per-day columns + monthly header)
--    business_date = 'YYYY-MM-DD'  -> a daily row
--    business_date = 'YYYY-MM'     -> the month-level settings row
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smr_entries (
    id                        TEXT PRIMARY KEY,
    office_id                 TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    report_month              TEXT NOT NULL CHECK (report_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    business_date             TEXT NOT NULL,
    stamps_received_paise     INTEGER NOT NULL DEFAULT 0 CHECK (stamps_received_paise >= 0),
    stamps_remitted_paise     INTEGER NOT NULL DEFAULT 0 CHECK (stamps_remitted_paise >= 0),
    postage_stamps_paise      INTEGER NOT NULL DEFAULT 0 CHECK (postage_stamps_paise >= 0),
    revenue_stamps_paise      INTEGER NOT NULL DEFAULT 0 CHECK (revenue_stamps_paise >= 0),
    other_stamps_paise        INTEGER NOT NULL DEFAULT 0 CHECK (other_stamps_paise >= 0),
    cash_received_override_paise  INTEGER CHECK (cash_received_override_paise IS NULL OR cash_received_override_paise >= 0),
    cash_remitted_override_paise  INTEGER CHECK (cash_remitted_override_paise IS NULL OR cash_remitted_override_paise >= 0),
    liabilities_note          TEXT NOT NULL DEFAULT '',        -- "Liabilities & explanation for excess cash"
    opening_balance_of_month_paise INTEGER CHECK (opening_balance_of_month_paise IS NULL OR opening_balance_of_month_paise >= 0),
    sectioned_stamp_balance_paise  INTEGER CHECK (sectioned_stamp_balance_paise IS NULL OR sectioned_stamp_balance_paise >= 0),
    signed_off_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
    signed_off_at             TEXT,
    updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (office_id, report_month, business_date),
    CHECK (business_date = report_month OR substr(business_date,1,7) = report_month)
);
CREATE INDEX IF NOT EXISTS idx_smr_entries_office_month ON smr_entries(office_id, report_month);

-- ---------------------------------------------------------------------
--  Stamp & stationery stock (monthly inventory ledger per category)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stamp_stock (
    id              TEXT PRIMARY KEY,
    office_id       TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    report_month    TEXT NOT NULL CHECK (report_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    category        TEXT NOT NULL CHECK (category IN ('postage','revenue','commemorative','stationery')),
    opening_paise   INTEGER NOT NULL DEFAULT 0 CHECK (opening_paise >= 0),
    receipts_paise  INTEGER NOT NULL DEFAULT 0 CHECK (receipts_paise >= 0),
    sales_paise     INTEGER NOT NULL DEFAULT 0 CHECK (sales_paise >= 0),
    closing_paise   INTEGER NOT NULL DEFAULT 0 CHECK (closing_paise >= 0),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (office_id, report_month, category),
    CHECK (closing_paise = opening_paise + receipts_paise - sales_paise)
);

-- ---------------------------------------------------------------------
--  Compiled SMR reports (batch output snapshots, one per office per month)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smr_reports (
    id               TEXT PRIMARY KEY,
    office_id        TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    report_month     TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('ready','pending_vouchers','cash_limit_breached','no_data')),
    flags_json       TEXT NOT NULL DEFAULT '[]',
    payload_json     TEXT NOT NULL,
    generated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
    generated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (office_id, report_month)
);

-- ---------------------------------------------------------------------
--  Immutable audit trail
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    office_id    TEXT,
    user_id      TEXT,
    username     TEXT NOT NULL DEFAULT 'system',
    role         TEXT NOT NULL DEFAULT 'system' CHECK (role IN ('system','operator','supervisor')),
    action       TEXT NOT NULL CHECK (length(action) > 0),       -- e.g. voucher.create, voucher.delete, handover.verify, cash.override, smr.signoff, login
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL DEFAULT '',
    before_json  TEXT,
    after_json   TEXT,
    note         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_office_time ON audit_logs(office_id, occurred_at);

-- audit_logs are append-only: any UPDATE or DELETE is rejected at the engine level
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs are immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs are immutable');
END;

-- keep updated_at fresh
CREATE TRIGGER IF NOT EXISTS trg_offices_updated AFTER UPDATE ON offices
BEGIN UPDATE offices SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_handovers_updated AFTER UPDATE ON handovers
BEGIN UPDATE handovers SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_voucher_items_updated AFTER UPDATE ON voucher_items
BEGIN UPDATE voucher_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id; END;

-- ---------------------------------------------------------------------
--  Convenience views
-- ---------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_daily_voucher_totals AS
SELECT h.office_id,
       h.business_date,
       v.category,
       v.voucher_type,
       v.flow,
       v.verification_status,
       COUNT(*)              AS lines,
       SUM(v.voucher_count)  AS vouchers,
       SUM(v.amount_paise)   AS amount_paise
FROM voucher_items v
JOIN handovers h ON h.id = v.handover_id
GROUP BY h.office_id, h.business_date, v.category, v.voucher_type, v.flow, v.verification_status;

INSERT OR IGNORE INTO app_settings(key, value) VALUES ('schema_version', '1');
