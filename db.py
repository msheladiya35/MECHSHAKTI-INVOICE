import sqlite3
import hashlib
import os

DB_FILE = os.path.join(os.path.dirname(__file__), "mechshakti.db")

def hash_password(password: str) -> str:
    """Hash a password using SHA-256 with a salt."""
    salt = "mechshakti_salt_2026"
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()

def get_db():
    """Connect to SQLite database with WAL mode and row factory."""
    db_path = os.environ.get("DATABASE_URL")
    if not db_path:
        if os.environ.get("VERCEL") == "1":
            db_path = "/tmp/mechshakti.db"
            if not os.path.exists(db_path) and os.path.exists(DB_FILE):
                import shutil
                try:
                    shutil.copy2(DB_FILE, db_path)
                except Exception:
                    pass
        else:
            db_path = DB_FILE

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
    except Exception:
        pass
    return conn

def init_db():
    """Initialize database tables, foreign keys, indexes, and seed default data."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Users table (Super Admin / Admin / Partner with PENDING_APPROVAL, ACTIVE, REJECTED, SUSPENDED statuses)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('SUPER_ADMIN', 'ADMIN', 'PARTNER')) NOT NULL,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Schema migration for users table
    user_cols = [row[1] for row in cursor.execute("PRAGMA table_info(users)").fetchall()]
    if 'city' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN city TEXT;")
    if 'address' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN address TEXT;")
    if 'gst_number' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN gst_number TEXT;")
    if 'dealer_code' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN dealer_code TEXT;")
    if 'rejection_reason' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN rejection_reason TEXT;")
    if 'upi_id' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN upi_id TEXT;")
    if 'upi_qr_url' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN upi_qr_url TEXT;")

    # 2. Customers table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        shop_name TEXT,
        mobile TEXT NOT NULL,
        address TEXT,
        city TEXT,
        gst_number TEXT,
        vehicle_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    cust_cols = [row[1] for row in cursor.execute("PRAGMA table_info(customers)").fetchall()]
    if 'vehicle_number' not in cust_cols:
        cursor.execute("ALTER TABLE customers ADD COLUMN vehicle_number TEXT;")
    if 'is_archived' not in cust_cols:
        cursor.execute("ALTER TABLE customers ADD COLUMN is_archived INTEGER DEFAULT 0;")

    # 3. Products table (Battery master)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        model_code TEXT UNIQUE NOT NULL,
        category TEXT DEFAULT 'BATTERY',
        selling_price REAL NOT NULL,
        gst_rate REAL DEFAULT 18.0,
        custom_partner_id INTEGER,
        is_custom INTEGER DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (custom_partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    prod_cols = [row[1] for row in cursor.execute("PRAGMA table_info(products)").fetchall()]
    if 'custom_partner_id' not in prod_cols:
        cursor.execute("ALTER TABLE products ADD COLUMN custom_partner_id INTEGER;")
    if 'is_custom' not in prod_cols:
        cursor.execute("ALTER TABLE products ADD COLUMN is_custom INTEGER DEFAULT 0;")

    # 4. Invoices header table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        cancelled_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    """)

    inv_cols = [row[1] for row in cursor.execute("PRAGMA table_info(invoices)").fetchall()]
    if 'cgst_amount' not in inv_cols:
        cursor.execute("ALTER TABLE invoices ADD COLUMN cgst_amount REAL DEFAULT 0.0;")
    if 'sgst_amount' not in inv_cols:
        cursor.execute("ALTER TABLE invoices ADD COLUMN sgst_amount REAL DEFAULT 0.0;")
    if 'igst_amount' not in inv_cols:
        cursor.execute("ALTER TABLE invoices ADD COLUMN igst_amount REAL DEFAULT 0.0;")
    if 'cancellation_reason' not in inv_cols:
        cursor.execute("ALTER TABLE invoices ADD COLUMN cancellation_reason TEXT;")
    if 'cancelled_by' not in inv_cols:
        cursor.execute("ALTER TABLE invoices ADD COLUMN cancelled_by INTEGER;")
    if 'cancelled_at' not in inv_cols:
        cursor.execute("ALTER TABLE invoices ADD COLUMN cancelled_at DATETIME;")

    # 5. Invoice Items line items table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    """)

    # 6. Payments table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        invoice_id INTEGER,
        amount REAL NOT NULL,
        payment_method TEXT CHECK(payment_method IN ('CASH', 'UPI', 'BANK', 'CARD', 'OTHER')) NOT NULL,
        reference_no TEXT,
        payment_date DATE NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
    );
    """)

    # 7. Scanned Unique Battery Tracking Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS scanned_batteries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id INTEGER NOT NULL,
        battery_code TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL,
        invoice_id INTEGER NOT NULL,
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    """)

    # 8. Warranty Registrations Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS warranty_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        status TEXT CHECK(status IN ('VALID', 'EXPIRED', 'NOT_REGISTERED', 'PENDING_VERIFICATION', 'CANCELLED', 'REJECTED')) DEFAULT 'VALID',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE SET NULL
    );
    """)

    # 9. Referrals Network Table (Unlimited Depth)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_partner_id INTEGER NOT NULL,
        referred_partner_id INTEGER NOT NULL,
        referral_code TEXT,
        status TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referrer_partner_id, referred_partner_id),
        FOREIGN KEY (referrer_partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 10. Reward Transactions Ledger Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reward_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        beneficiary_partner_id INTEGER NOT NULL,
        source_invoice_id INTEGER NOT NULL,
        battery_code TEXT,
        product_id INTEGER NOT NULL,
        referral_level INTEGER NOT NULL,
        points_earned REAL NOT NULL,
        status TEXT CHECK(status IN ('AVAILABLE', 'PENDING', 'REDEEMED', 'REVERSED')) DEFAULT 'AVAILABLE',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_invoice_id, battery_code, beneficiary_partner_id),
        FOREIGN KEY (beneficiary_partner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (source_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    """)

    # 11. Reward Redemptions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reward_redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id INTEGER NOT NULL,
        points_redeemed REAL NOT NULL,
        payout_amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'BANK',
        status TEXT CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAID')) DEFAULT 'PENDING',
        rejection_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 12. Audit Logs Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        target_entity TEXT NOT NULL,
        target_id INTEGER,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

    # Seed Default Super Admin & Admin (status = 'ACTIVE')
    superadmin = cursor.execute("SELECT id FROM users WHERE email = 'superadmin@mechshakti.com'").fetchone()
    if not superadmin:
        try:
            cursor.execute("""
            INSERT INTO users (name, email, password_hash, role, phone, shop_name, city, status)
            VALUES ('Super Admin', 'superadmin@mechshakti.com', ?, 'SUPER_ADMIN', '9900000000', 'Mechshakti Corp HQ', 'Surat', 'ACTIVE')
            """, (hash_password('superadmin123'),))
        except sqlite3.IntegrityError:
            cursor.execute("PRAGMA foreign_keys=OFF;")
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS users_migration (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            """)
            cursor.execute("INSERT INTO users_migration SELECT * FROM users;")
            cursor.execute("DROP TABLE users;")
            cursor.execute("ALTER TABLE users_migration RENAME TO users;")
            cursor.execute("PRAGMA foreign_keys=ON;")
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

    cursor.execute("UPDATE users SET status = 'ACTIVE' WHERE role = 'ADMIN' OR email IN ('seller1@mechshakti.com', 'seller2@mechshakti.com');")

    seller1 = cursor.execute("SELECT id FROM users WHERE email = 'seller1@mechshakti.com'").fetchone()
    if not seller1:
        cursor.execute("""
        INSERT INTO users (name, email, password_hash, role, phone, shop_name, city, status)
        VALUES ('Mehul Sheladiya (Seller 1)', 'seller1@mechshakti.com', ?, 'PARTNER', '9988776655', 'Mehul Power Systems', 'Surat', 'ACTIVE')
        """, (hash_password('seller123'),))

    seller2 = cursor.execute("SELECT id FROM users WHERE email = 'seller2@mechshakti.com'").fetchone()
    if not seller2:
        cursor.execute("""
        INSERT INTO users (name, email, password_hash, role, phone, shop_name, city, status)
        VALUES ('Rajesh Auto (Seller 2)', 'seller2@mechshakti.com', ?, 'PARTNER', '9123456789', 'Rajesh Battery Center', 'Surat', 'ACTIVE')
        """, (hash_password('seller123'),))

    # Seed Mechshakti Preset Products
    preset_products = [
        ('Mechshakti 2.5 XL Battery', 'MS01', 'BATTERY', 1250.0, 18.0),
        ('Mechshakti 4A Battery', 'MS02', 'BATTERY', 1450.0, 18.0),
        ('Mechshakti X5 Battery', 'MS03', 'BATTERY', 1650.0, 18.0),
        ('Mechshakti Z5 Battery', 'MS04', 'BATTERY', 1850.0, 18.0),
        ('Mechshakti Heavy Duty 150Ah', 'MS-HD150AH', 'BATTERY', 12500.0, 18.0)
    ]

    for p_name, p_code, p_cat, p_price, p_gst in preset_products:
        exists = cursor.execute("SELECT id FROM products WHERE model_code = ?", (p_code,)).fetchone()
        if not exists:
            cursor.execute("""
            INSERT INTO products (name, model_code, category, selling_price, gst_rate)
            VALUES (?, ?, ?, ?, ?)
            """, (p_name, p_code, p_cat, p_price, p_gst))

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database schema successfully upgraded for Phase 1 Master Specification!")
