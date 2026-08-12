import sqlite3
import hashlib
import os
import sys
import time
import datetime
import urllib.parse

try:
    import psycopg2
    import psycopg2.extras
    PSYCOPG2_AVAILABLE = True
except ImportError:
    psycopg2 = None
    PSYCOPG2_AVAILABLE = False

DB_FILE = os.path.join(os.path.dirname(__file__), "mechshakti.db")


class DatabaseConnectionError(Exception):
    """Raised when configured production database cannot be reached."""
    pass


class DictRowWrapper(dict):
    """Wrapper ensuring row attributes can be accessed by key or dict() conversion."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class DbCursorAdapter:
    def __init__(self, cursor, is_postgres=False):
        self._cursor = cursor
        self.is_postgres = is_postgres
        self.lastrowid = None

    def execute(self, sql, params=None):
        params = params or ()
        if self.is_postgres:
            pg_sql = sql.replace("?", "%s")
            is_insert = pg_sql.strip().upper().startswith("INSERT INTO")
            if is_insert and "RETURNING" not in pg_sql.upper():
                pg_sql += " RETURNING id"

            self._cursor.execute(pg_sql, params)
            if is_insert:
                try:
                    row = self._cursor.fetchone()
                    if row:
                        self.lastrowid = row[0] if isinstance(row, (tuple, list)) else row.get("id")
                except Exception:
                    self.lastrowid = None
        else:
            self._cursor.execute(sql, params)
            self.lastrowid = self._cursor.lastrowid
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        if isinstance(row, dict):
            return DictRowWrapper(row)
        if hasattr(row, 'keys'):
            return DictRowWrapper(dict(row))
        if isinstance(row, (tuple, list)):
            return row
        return row

    def fetchall(self):
        rows = self._cursor.fetchall()
        result = []
        for r in rows:
            if isinstance(r, dict):
                result.append(DictRowWrapper(r))
            elif hasattr(r, 'keys'):
                result.append(DictRowWrapper(dict(r)))
            else:
                result.append(r)
        return result


class DbConnectionAdapter:
    def __init__(self, conn, is_postgres=False):
        self._conn = conn
        self.is_postgres = is_postgres

    def cursor(self):
        if self.is_postgres:
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        else:
            cur = self._conn.cursor()
        return DbCursorAdapter(cur, is_postgres=self.is_postgres)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def execute(self, sql, params=None):
        cur = self.cursor()
        cur.execute(sql, params)
        return cur


def hash_password(password: str) -> str:
    """Hash a password using SHA-256 with a salt."""
    salt = "mechshakti_salt_2026"
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()


def get_db():
    """Connect to PostgreSQL if DATABASE_URL is set, or local SQLite db."""
    db_url = os.environ.get("DATABASE_URL")
    if db_url and (db_url.startswith("postgres://") or db_url.startswith("postgresql://")):
        if not PSYCOPG2_AVAILABLE:
            raise DatabaseConnectionError("psycopg2 package missing. Cannot connect to PostgreSQL DATABASE_URL.")

        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)

        try:
            conn = psycopg2.connect(db_url)
            return DbConnectionAdapter(conn, is_postgres=True)
        except Exception as e:
            raise DatabaseConnectionError(f"CRITICAL: Production PostgreSQL connection failed: {e}")

    # Local SQLite Fallback
    db_path = DB_FILE
    if os.environ.get("VERCEL") == "1":
        db_path = "/tmp/mechshakti.db"
        if not os.path.exists(db_path) and os.path.exists(DB_FILE):
            import shutil
            try: shutil.copy2(DB_FILE, db_path)
            except Exception: pass
    elif os.environ.get("RENDER") == "1" or os.path.exists("/var/data"):
        try:
            os.makedirs("/var/data", exist_ok=True)
            db_path = "/var/data/mechshakti.db"
            if not os.path.exists(db_path) and os.path.exists(DB_FILE):
                import shutil
                try: shutil.copy2(DB_FILE, db_path)
                except Exception: pass
        except Exception:
            db_path = DB_FILE

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
    except Exception:
        pass
    return DbConnectionAdapter(conn, is_postgres=False)


def init_db():
    """Initialize database tables, foreign keys, indexes, and seed default data."""
    conn = get_db()
    cursor = conn.cursor()
    is_pg = conn.is_postgres

    id_type = "SERIAL PRIMARY KEY" if is_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    dt_type = "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" if is_pg else "DATETIME DEFAULT CURRENT_TIMESTAMP"

    # 1. Users table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS users (
        id {id_type},
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        shop_name TEXT,
        city TEXT,
        address TEXT,
        gst_number TEXT,
        dealer_code TEXT,
        upi_id TEXT,
        upi_qr_url TEXT,
        status TEXT DEFAULT 'PENDING_APPROVAL',
        rejection_reason TEXT,
        created_at {dt_type},
        updated_at {dt_type}
    );
    """)

    # 2. Customers table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS customers (
        id {id_type},
        partner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        shop_name TEXT,
        mobile TEXT NOT NULL,
        address TEXT,
        city TEXT,
        gst_number TEXT,
        vehicle_number TEXT,
        is_archived INTEGER DEFAULT 0,
        created_at {dt_type},
        updated_at {dt_type},
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 3. Products table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS products (
        id {id_type},
        name TEXT NOT NULL,
        model_code TEXT UNIQUE NOT NULL,
        category TEXT DEFAULT 'BATTERY',
        mrp REAL DEFAULT 0.0,
        selling_price REAL NOT NULL,
        warranty_months INTEGER DEFAULT 24,
        battery_serial_required INTEGER DEFAULT 1,
        gst_rate REAL DEFAULT 0.0,
        custom_partner_id INTEGER,
        is_custom INTEGER DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at {dt_type},
        updated_at {dt_type},
        FOREIGN KEY (custom_partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 4. Invoices header table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS invoices (
        id {id_type},
        invoice_number TEXT UNIQUE NOT NULL,
        client_nonce TEXT UNIQUE,
        partner_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        invoice_date DATE NOT NULL,
        taxable_amount REAL NOT NULL,
        discount_amount REAL DEFAULT 0.0,
        gst_amount REAL NOT NULL,
        cgst_amount REAL DEFAULT 0.0,
        sgst_amount REAL DEFAULT 0.0,
        igst_amount REAL DEFAULT 0.0,
        grand_total REAL NOT NULL,
        paid_amount REAL DEFAULT 0.0,
        payment_status TEXT DEFAULT 'UNPAID',
        cancellation_reason TEXT,
        cancelled_by INTEGER,
        cancelled_at {dt_type},
        notes TEXT,
        created_at {dt_type},
        updated_at {dt_type},
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    """)

    # 5. Invoice Items line items table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS invoice_items (
        id {id_type},
        invoice_id INTEGER NOT NULL,
        partner_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        model_code_snapshot TEXT NOT NULL,
        battery_code TEXT,
        mfg_period TEXT,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        discount REAL DEFAULT 0.0,
        gst_rate REAL NOT NULL,
        gst_amount REAL NOT NULL,
        line_total REAL NOT NULL,
        created_at {dt_type},
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    """)

    # 6. Payments table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS payments (
        id {id_type},
        partner_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        invoice_id INTEGER,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        reference_no TEXT,
        payment_date DATE NOT NULL,
        notes TEXT,
        created_at {dt_type},
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
    );
    """)

    # 7. Scanned Unique Battery Tracking Table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS scanned_batteries (
        id {id_type},
        partner_id INTEGER NOT NULL,
        battery_code TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL,
        invoice_id INTEGER NOT NULL,
        scanned_at {dt_type},
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    """)

    # 8. Warranty Registrations Table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS warranty_registrations (
        id {id_type},
        battery_code TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL,
        partner_id INTEGER,
        customer_name TEXT NOT NULL,
        customer_mobile TEXT NOT NULL,
        purchase_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        vehicle_number TEXT,
        vehicle_model TEXT,
        card_photo_url TEXT,
        status TEXT DEFAULT 'VALID',
        notes TEXT,
        created_at {dt_type},
        updated_at {dt_type},
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE SET NULL
    );
    """)

    # 9. Referrals Network Table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS referrals (
        id {id_type},
        referrer_partner_id INTEGER NOT NULL,
        referred_partner_id INTEGER NOT NULL,
        referral_code TEXT,
        status TEXT DEFAULT 'ACTIVE',
        created_at {dt_type},
        UNIQUE(referrer_partner_id, referred_partner_id),
        FOREIGN KEY (referrer_partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 10. Reward Transactions Ledger Table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS reward_transactions (
        id {id_type},
        beneficiary_partner_id INTEGER NOT NULL,
        source_invoice_id INTEGER NOT NULL,
        battery_code TEXT,
        product_id INTEGER NOT NULL,
        referral_level INTEGER NOT NULL,
        points_earned REAL NOT NULL,
        status TEXT DEFAULT 'AVAILABLE',
        notes TEXT,
        created_at {dt_type},
        UNIQUE(source_invoice_id, battery_code, beneficiary_partner_id),
        FOREIGN KEY (beneficiary_partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (source_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    """)

    # 11. Reward Redemptions Table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS reward_redemptions (
        id {id_type},
        partner_id INTEGER NOT NULL,
        points_redeemed REAL NOT NULL,
        payout_amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'BANK',
        status TEXT DEFAULT 'PENDING',
        rejection_reason TEXT,
        created_at {dt_type},
        updated_at {dt_type},
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 12. Audit Logs Table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id {id_type},
        actor_user_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        target_entity TEXT NOT NULL,
        target_id INTEGER,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        ip_address TEXT,
        created_at {dt_type},
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # Performance Indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customers_partner ON customers(partner_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_partner_date ON invoices(partner_id, invoice_date);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_payments_partner_customer ON payments(partner_id, customer_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_scanned_batteries_code ON scanned_batteries(battery_code);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_warranty_code ON warranty_registrations(battery_code);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_partner_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_partner_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reward_txns_beneficiary ON reward_transactions(beneficiary_partner_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reward_redemptions_partner ON reward_redemptions(partner_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);")

    # Idempotent Seed Data (Super Admin & System Admin)
    superadmin = cursor.execute("SELECT id FROM users WHERE email = 'superadmin@mechshakti.com'").fetchone()
    if not superadmin:
        cursor.execute("""
        INSERT INTO users (name, email, password_hash, role, phone, shop_name, city, status)
        VALUES ('Super Admin', 'superadmin@mechshakti.com', ?, 'SUPER_ADMIN', '9900000000', 'Mechshakti Corp HQ', 'Surat', 'ACTIVE')
        """, (hash_password('superadmin123'),))

    admin = cursor.execute("SELECT id FROM users WHERE email = 'admin@mechshakti.com'").fetchone()
    if not admin:
        cursor.execute("""
        INSERT INTO users (name, email, password_hash, role, phone, shop_name, city, status)
        VALUES ('System Admin', 'admin@mechshakti.com', ?, 'ADMIN', '9876543210', 'Mechshakti HQ', 'Surat', 'ACTIVE')
        """, (hash_password('admin123'),))

    # Seed Mechshakti Preset Master Products
    preset_products = [
        ('Mechshakti 2.5 XL Battery', 'MS01', 'BATTERY', 1250.0, 0.0),
        ('Mechshakti 4A Battery', 'MS02', 'BATTERY', 1450.0, 0.0),
        ('Mechshakti X5 Battery', 'MS03', 'BATTERY', 1650.0, 0.0),
        ('Mechshakti Z5 Battery', 'MS04', 'BATTERY', 1850.0, 0.0),
        ('Mechshakti Heavy Duty 150Ah', 'MS-HD150AH', 'BATTERY', 12500.0, 0.0)
    ]

    for p_name, p_code, p_cat, p_price, p_gst in preset_products:
        exists = cursor.execute("SELECT id FROM products WHERE model_code = ?", (p_code,)).fetchone()
        if not exists:
            cursor.execute("""
            INSERT INTO products (name, model_code, category, selling_price, gst_rate, is_custom)
            VALUES (?, ?, ?, ?, ?, 0)
            """, (p_name, p_code, p_cat, p_price, p_gst))

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialization complete.")
