import sqlite3
import os
import sys
import urllib.parse

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None

def run_migration():
    print("=" * 80)
    print("MECHSHAKTI DATABASE MIGRATION TOOL: LOCAL SQLITE -> POSTGRESQL")
    print("=" * 80)

    sqlite_path = os.path.join(os.path.dirname(__file__), "mechshakti.db")
    if not os.path.exists(sqlite_path):
        print(f"❌ SQLite database file not found at: {sqlite_path}")
        return

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("❌ DATABASE_URL environment variable is not set.")
        print("Please set DATABASE_URL (e.g. postgresql://user:pass@host:5432/dbname) before running migration.")
        return

    if not psycopg2:
        print("❌ psycopg2-binary package is not installed. Please run 'pip install psycopg2-binary'.")
        return

    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    print(f"Connecting to SQLite source: {sqlite_path}")
    conn_sqlite = sqlite3.connect(sqlite_path)
    conn_sqlite.row_factory = sqlite3.Row
    cur_sqlite = conn_sqlite.cursor()

    print(f"Connecting to PostgreSQL destination...")
    try:
        conn_pg = psycopg2.connect(db_url)
        cur_pg = conn_pg.cursor(cursor_factory=psycopg2.extras.DictCursor)
        print("✔ Connected to PostgreSQL destination successfully.")
    except Exception as e:
        print(f"❌ PostgreSQL connection failed: {e}")
        return

    # Tables to migrate in dependency order
    tables = [
        "users",
        "customers",
        "products",
        "invoices",
        "invoice_items",
        "payments",
        "scanned_batteries",
        "warranty_registrations",
        "referrals",
        "reward_transactions",
        "reward_redemptions",
        "audit_logs"
    ]

    record_counts = {}

    for tbl in tables:
        # Check if table exists in SQLite
        chk = cur_sqlite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tbl,)).fetchone()
        if not chk:
            print(f"⚠️  Table '{tbl}' does not exist in SQLite source. Skipping.")
            continue

        rows = cur_sqlite.execute(f"SELECT * FROM {tbl} ORDER BY id ASC").fetchall()
        record_counts[tbl] = len(rows)
        print(f"Dumped {len(rows)} records from SQLite table '{tbl}'.")

        if len(rows) == 0:
            continue

        # Get column names
        cols = [description[0] for description in cur_sqlite.description]
        col_names = ", ".join(cols)
        placeholders = ", ".join(["%s"] * len(cols))

        insert_sql = f"INSERT INTO {tbl} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"

        migrated_count = 0
        for r in rows:
            val_list = [r[c] for c in cols]
            try:
                cur_pg.execute(insert_sql, val_list)
                migrated_count += 1
            except Exception as ex:
                conn_pg.rollback()
                print(f"⚠️ Exception inserting row into PostgreSQL {tbl}: {ex}")

        conn_pg.commit()

        # Update PostgreSQL sequence to prevent ID collisions on future auto-increment inserts
        try:
            cur_pg.execute(f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), COALESCE(MAX(id), 1)) FROM {tbl};")
            conn_pg.commit()
        except Exception:
            conn_pg.rollback()

        print(f"✔ Table '{tbl}' migrated to PostgreSQL ({migrated_count}/{len(rows)} records preserved).")

    print("=" * 80)
    print("MIGRATION SUMMARY & VERIFICATION")
    print("=" * 80)
    total_preserved = 0
    for tbl, cnt in record_counts.items():
        try:
            cur_pg.execute(f"SELECT COUNT(*) FROM {tbl}")
            pg_cnt = cur_pg.fetchone()[0]
            print(f"• Table {tbl:<24}: SQLite = {cnt:<6} | PostgreSQL = {pg_cnt:<6}")
            total_preserved += pg_cnt
        except Exception:
            conn_pg.rollback()

    print(f"\n🎉 Total PostgreSQL Records Preserved: {total_preserved}")
    print("=" * 80)

    conn_sqlite.close()
    conn_pg.close()

if __name__ == "__main__":
    run_migration()
