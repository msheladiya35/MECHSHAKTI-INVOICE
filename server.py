import http.server
import socketserver
import json
import urllib.parse
import os
import re
import datetime
import time
import hmac
import hashlib
import base64
import sqlite3
from db import get_db, init_db, hash_password

PORT = int(os.environ.get("PORT", 8080))
SECRET_KEY = os.environ.get("JWT_SECRET", "mechshakti_super_secret_jwt_key_2026")

def generate_token(user_data: dict) -> str:
    """Generate an HMAC-SHA256 signed token."""
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "id": user_data["id"],
        "email": user_data["email"],
        "name": user_data["name"],
        "role": user_data["role"],
        "shop_name": user_data.get("shop_name", ""),
        "status": user_data.get("status", "ACTIVE"),
        "exp": int(datetime.datetime.now().timestamp()) + 86400 * 30
    }
    
    b64_header = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    b64_payload = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    
    signature_input = f"{b64_header}.{b64_payload}".encode()
    signature = hmac.new(SECRET_KEY.encode(), signature_input, hashlib.sha256).digest()
    b64_sig = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    
    return f"{b64_header}.{b64_payload}.{b64_sig}"

def verify_token(token: str) -> dict:
    """Verify an HMAC-SHA256 token and return payload or None."""
    if not token:
        return None
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        
        b64_header, b64_payload, b64_sig = parts
        
        signature_input = f"{b64_header}.{b64_payload}".encode()
        expected_sig = hmac.new(SECRET_KEY.encode(), signature_input, hashlib.sha256).digest()
        b64_expected_sig = base64.urlsafe_b64encode(expected_sig).decode().rstrip("=")
        
        if not hmac.compare_digest(b64_sig, b64_expected_sig):
            return None
        
        rem = len(b64_payload) % 4
        if rem > 0:
            b64_payload += "=" * (4 - rem)
        payload_json = base64.urlsafe_b64decode(b64_payload).decode('utf-8')
        payload = json.loads(payload_json)
        
        if payload.get("exp", 0) < datetime.datetime.now().timestamp():
            return None
            
        return payload
    except Exception:
        return None

def parse_date_range(preset: str, custom_from: str = None, custom_to: str = None):
    today = datetime.date.today()
    
    if preset == 'today':
        return today.isoformat(), today.isoformat()
    elif preset == 'yesterday':
        y = today - datetime.timedelta(days=1)
        return y.isoformat(), y.isoformat()
    elif preset == 'this_week':
        start = today - datetime.timedelta(days=today.weekday())
        return start.isoformat(), today.isoformat()
    elif preset == 'prev_week':
        end = today - datetime.timedelta(days=today.weekday() + 1)
        start = end - datetime.timedelta(days=6)
        return start.isoformat(), end.isoformat()
    elif preset == 'this_month':
        start = today.replace(day=1)
        return start.isoformat(), today.isoformat()
    elif preset == 'prev_month':
        first_of_this_month = today.replace(day=1)
        last_of_prev_month = first_of_this_month - datetime.timedelta(days=1)
        start = last_of_prev_month.replace(day=1)
        return start.isoformat(), last_of_prev_month.isoformat()
    elif preset == 'this_year':
        start = today.replace(month=1, day=1)
        return start.isoformat(), today.isoformat()
    elif preset == 'prev_year':
        start = datetime.date(today.year - 1, 1, 1)
        end = datetime.date(today.year - 1, 12, 31)
        return start.isoformat(), end.isoformat()
    elif preset == 'custom' and custom_from and custom_to:
        return custom_from, custom_to
    
    return None, None

def normalize_battery_code(code: str) -> str:
    """
    Serial Normalization (Section 2):
    - Trim whitespace
    - Uppercase
    - Remove accidental dashes/spaces
    """
    if not code:
        return ""
    return re.sub(r'[\s\-]+', '', code.strip()).upper()

def decode_mechshakti_battery_code(code: str, conn):
    code_clean = normalize_battery_code(code)
    if len(code_clean) < 8:
        return {"error": "Invalid Mechshakti battery code."}

    prod_code = code_clean[:4]
    mfg_code = code_clean[4:8]

    cursor = conn.cursor()
    prod = cursor.execute("SELECT * FROM products WHERE model_code = ?", (prod_code,)).fetchone()
    if not prod:
        return {"error": f"Battery type {prod_code} is not configured."}

    mfg_period = "Unknown Period"
    try:
        month_num = int(mfg_code[:2])
        year_num = 2000 + int(mfg_code[2:4])
        months = ["January", "February", "March", "April", "May", "June", 
                  "July", "August", "September", "October", "November", "December"]
        if 1 <= month_num <= 12:
            mfg_period = f"{months[month_num - 1]} {year_num}"
    except Exception:
        mfg_period = f"Batch {mfg_code}"

    return {
        "valid": True,
        "product": dict(prod),
        "battery_code": code_clean,
        "mfg_period": mfg_period
    }

def validate_battery_for_warranty_registration(code: str, conn):
    """
    Unified Battery Warranty Registration Validation Engine (Sections 1, 2, 4, 5, 6, 15):
    1. Normalize serial code.
    2. Check format validity.
    3. Check if serial ALREADY has an ACTIVE warranty registration.
    4. Check if serial exists in scanned_batteries / products.
    5. Return status report.
    """
    normalized_code = normalize_battery_code(code)
    if len(normalized_code) < 8:
        return {
            "valid": False,
            "status_code": "INVALID_FORMAT",
            "message": "Invalid Mechshakti battery code format. Must be at least 8 characters."
        }

    cursor = conn.cursor()

    # 1. Check existing ACTIVE warranty registration (VALID, EXPIRED, PENDING_VERIFICATION)
    existing_w = cursor.execute("""
        SELECT id, battery_code, status, purchase_date, expiry_date, created_at
        FROM warranty_registrations 
        WHERE battery_code = ? AND status IN ('VALID', 'EXPIRED', 'PENDING_VERIFICATION')
    """, (normalized_code,)).fetchone()

    if existing_w:
        return {
            "valid": False,
            "status_code": "ALREADY_REGISTERED",
            "message": "THIS BATTERY WARRANTY IS ALREADY REGISTERED.",
            "sub_message": "This battery has already been registered for warranty.",
            "existing_registration": {
                "status": existing_w["status"],
                "purchase_date": existing_w["purchase_date"],
                "expiry_date": existing_w["expiry_date"],
                "registered_at": existing_w["created_at"]
            }
        }

    # 2. Check if product model exists (first 4 characters)
    prod_code = normalized_code[:4]
    prod = cursor.execute("SELECT * FROM products WHERE model_code = ?", (prod_code,)).fetchone()

    # 3. Check if battery exists in scanned_batteries sales database
    scanned = cursor.execute("SELECT sb.*, i.invoice_date, u.name as seller_name FROM scanned_batteries sb JOIN invoices i ON i.id = sb.invoice_id JOIN users u ON u.id = sb.partner_id WHERE sb.battery_code = ?", (normalized_code,)).fetchone()

    mfg_code = normalized_code[4:8]
    mfg_period = "Unknown Period"
    try:
        month_num = int(mfg_code[:2])
        year_num = 2000 + int(mfg_code[2:4])
        months = ["January", "February", "March", "April", "May", "June", 
                  "July", "August", "September", "October", "November", "December"]
        if 1 <= month_num <= 12:
            mfg_period = f"{months[month_num - 1]} {year_num}"
    except Exception:
        mfg_period = f"Batch {mfg_code}"

    if not prod and not scanned:
        return {
            "valid": True,
            "status_code": "UNKNOWN_SERIAL_PENDING_VERIFICATION",
            "requires_admin_verification": True,
            "normalized_code": normalized_code,
            "mfg_period": mfg_period,
            "message": "Battery serial not found in sales registry. Registration will require Admin verification."
        }

    return {
        "valid": True,
        "status_code": "VALID_FOR_REGISTRATION",
        "requires_admin_verification": False,
        "normalized_code": normalized_code,
        "product": dict(prod) if prod else None,
        "scanned_sale": dict(scanned) if scanned else None,
        "mfg_period": mfg_period,
        "message": "Battery serial verified. Ready for warranty registration."
    }

def calculate_and_award_referral_points(conn, partner_id, invoice_id, items):
    cursor = conn.cursor()
    
    upline_chain = []
    current_partner = partner_id
    visited = set([current_partner])
    
    while True:
        ref = cursor.execute("SELECT referrer_partner_id FROM referrals WHERE referred_partner_id = ? AND status = 'ACTIVE'", (current_partner,)).fetchone()
        if not ref:
            break
        referrer_id = ref["referrer_partner_id"]
        if referrer_id in visited:
            break
        visited.add(referrer_id)
        upline_chain.append(referrer_id)
        current_partner = referrer_id

    if not upline_chain:
        return

    for item in items:
        prod_id = item["product_id"]
        battery_code = item.get("battery_code")
        qty = item.get("quantity", 1)

        for b_idx in range(qty):
            b_code = battery_code if (qty == 1 and battery_code) else (f"{battery_code}_{b_idx}" if battery_code else f"INV_{invoice_id}_PROD_{prod_id}_{b_idx}")
            
            current_level = 1
            current_points = 1.00

            for beneficiary_id in upline_chain:
                if current_points < 0.01:
                    break

                try:
                    cursor.execute("""
                        INSERT INTO reward_transactions 
                        (beneficiary_partner_id, source_invoice_id, battery_code, product_id, referral_level, points_earned, status, notes)
                        VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', ?)
                    """, (
                        beneficiary_id,
                        invoice_id,
                        b_code,
                        prod_id,
                        current_level,
                        round(current_points, 6),
                        f"Level {current_level} referral reward for invoice #{invoice_id}"
                    ))
                except sqlite3.IntegrityError:
                    pass

                current_level += 1
                current_points = current_points / 2.0


class MechshaktiRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(os.path.dirname(__file__), "public"), **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status=status)

    def get_auth_user(self):
        auth_header = self.headers.get("Authorization") or self.headers.get("authorization")
        if not auth_header:
            return None
        parts = auth_header.split(" ")
        token = parts[-1] if len(parts) >= 1 else ""
        payload = verify_token(token)
        if not payload:
            return None

        conn = get_db()
        cursor = conn.cursor()
        u = cursor.execute("SELECT id, name, email, role, phone, shop_name, upi_id, upi_qr_url, status FROM users WHERE id = ?", (payload["id"],)).fetchone()
        conn.close()

        if not u or u["status"] != "ACTIVE":
            return None

        return dict(u)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/api/"):
            
            # Public Endpoint: PUBLIC WARRANTY CHECK (Section 48 - Privacy safe)
            if path == "/api/warranty/check":
                code = normalize_battery_code(query_params.get("code", [""])[0])
                if not code:
                    return self.send_error_json("Please provide a battery serial code.", 400)
                
                conn = get_db()
                cursor = conn.cursor()
                w = cursor.execute("""
                    SELECT w.battery_code, p.name as product_name, w.purchase_date, w.expiry_date, w.status, w.created_at as registered_at
                    FROM warranty_registrations w
                    LEFT JOIN products p ON p.id = w.product_id
                    WHERE w.battery_code = ? AND w.status IN ('VALID', 'EXPIRED', 'PENDING_VERIFICATION')
                """, (code,)).fetchone()
                conn.close()

                if not w:
                    return self.send_json({"found": False, "message": "No active warranty registration found for this serial code."})

                return self.send_json({
                    "found": True,
                    "warranty": dict(w)
                })

            # Public Endpoint: VALIDATE SERIAL BEFORE REGISTRATION (Section 4 & 15)
            elif path == "/api/warranty/validate-serial":
                code = query_params.get("code", [""])[0]
                if not code:
                    return self.send_error_json("Please enter or scan a battery serial code.", 400)
                
                conn = get_db()
                res = validate_battery_for_warranty_registration(code, conn)
                conn.close()

                if not res["valid"]:
                    return self.send_json(res, status=400)
                return self.send_json(res)

            user = self.get_auth_user()
            
            if path == "/api/auth/me":
                if not user:
                    return self.send_error_json("Unauthorized", 401)
                return self.send_json({"user": user})

            if not user:
                return self.send_error_json("Unauthorized", 401)

            conn = get_db()
            cursor = conn.cursor()

            try:
                # ADMIN WARRANTY VERIFICATION QUEUE (Section 7)
                if path == "/api/admin/warranties":
                    if user["role"] != "ADMIN":
                        return self.send_error_json("Forbidden: Admin access required", 403)
                    
                    st_filter = query_params.get("status", [None])[0]
                    sql = """
                        SELECT w.*, p.name as product_name, u.name as partner_name
                        FROM warranty_registrations w
                        LEFT JOIN products p ON p.id = w.product_id
                        LEFT JOIN users u ON u.id = w.partner_id
                        WHERE 1=1
                    """
                    params = []
                    if st_filter and st_filter.upper() != 'ALL':
                        sql += " AND w.status = ?"
                        params.append(st_filter.upper())
                    
                    sql += " ORDER BY w.id DESC"
                    warranties = cursor.execute(sql, params).fetchall()

                    return self.send_json({"warranties": [dict(w) for w in warranties]})

                # RATE AUTO-FETCH API
                elif path.startswith("/api/customers/") and "/last-rate" in path:
                    parts = path.split("/")
                    cust_id = parts[3]
                    prod_id = query_params.get("product_id", [None])[0]

                    if not prod_id:
                        return self.send_error_json("Product ID required", 400)

                    last_item = cursor.execute("""
                        SELECT ii.unit_price 
                        FROM invoice_items ii
                        JOIN invoices i ON i.id = ii.invoice_id
                        WHERE i.partner_id = ? AND i.customer_id = ? AND ii.product_id = ?
                        ORDER BY i.invoice_date DESC, i.id DESC
                        LIMIT 1
                    """, (user["id"], cust_id, prod_id)).fetchone()

                    if last_item:
                        return self.send_json({"rate": last_item["unit_price"], "source": "PREVIOUS_CUSTOMER_RATE"})
                    
                    prod = cursor.execute("SELECT selling_price FROM products WHERE id = ?", (prod_id,)).fetchone()
                    return self.send_json({"rate": prod["selling_price"] if prod else 0.0, "source": "CATALOG_DEFAULT"})

                # ADMIN SELLERS LIST
                elif path == "/api/admin/sellers":
                    if user["role"] != "ADMIN":
                        return self.send_error_json("Forbidden: Admin access required", 403)
                    
                    status_filter = query_params.get("status", [None])[0]
                    sql = """
                        SELECT u.id, u.name, u.email, u.phone, u.shop_name, u.city, u.address, 
                               u.gst_number, u.dealer_code, u.status, u.rejection_reason, u.created_at,
                               COUNT(DISTINCT c.id) as total_customers,
                               COUNT(DISTINCT i.id) as total_invoices,
                               COALESCE(SUM(i.grand_total), 0.0) as total_sales
                        FROM users u
                        LEFT JOIN customers c ON c.partner_id = u.id
                        LEFT JOIN invoices i ON i.partner_id = u.id
                        WHERE u.role = 'PARTNER'
                    """
                    params = []
                    if status_filter and status_filter.upper() != 'ALL':
                        sql += " AND u.status = ?"
                        params.append(status_filter.upper())

                    sql += " GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC"
                    sellers = cursor.execute(sql, params).fetchall()
                    
                    pending_cnt = cursor.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'PARTNER' AND status = 'PENDING_APPROVAL'").fetchone()["cnt"]

                    return self.send_json({
                        "sellers": [dict(s) for s in sellers],
                        "pending_count": pending_cnt
                    })

                # ADMIN GLOBAL SEARCH & BATTERY TRACEABILITY
                elif path == "/api/admin/global-search":
                    if user["role"] != "ADMIN":
                        return self.send_error_json("Forbidden: Admin access required", 403)
                    
                    q = query_params.get("q", [""])[0].strip()
                    if not q:
                        return self.send_json({"results": []})

                    q_norm = normalize_battery_code(q)
                    q_like = f"%{q}%"
                    q_norm_like = f"%{q_norm}%"

                    # 1. Search Battery Traceability
                    batteries = cursor.execute("""
                        SELECT sb.battery_code, p.name as product_name, p.model_code,
                               u.name as seller_name, c.name as customer_name, i.invoice_number,
                               i.invoice_date, ii.unit_price, i.payment_status,
                               w.status as warranty_status, w.expiry_date as warranty_expiry
                        FROM scanned_batteries sb
                        JOIN products p ON p.id = sb.product_id
                        JOIN users u ON u.id = sb.partner_id
                        JOIN invoices i ON i.id = sb.invoice_id
                        JOIN customers c ON c.id = i.customer_id
                        LEFT JOIN invoice_items ii ON ii.invoice_id = i.id AND ii.product_id = p.id
                        LEFT JOIN warranty_registrations w ON w.battery_code = sb.battery_code
                        WHERE sb.battery_code LIKE ? OR sb.battery_code LIKE ?
                        LIMIT 10
                    """, (q_like, q_norm_like)).fetchall()

                    customers = cursor.execute("SELECT c.*, u.name as partner_name FROM customers c JOIN users u ON u.id = c.partner_id WHERE c.name LIKE ? OR c.mobile LIKE ? OR c.shop_name LIKE ? LIMIT 10", (q_like, q_like, q_like)).fetchall()
                    invoices = cursor.execute("SELECT i.*, c.name as customer_name, u.name as partner_name FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.partner_id WHERE i.invoice_number LIKE ? LIMIT 10", (q_like,)).fetchall()

                    return self.send_json({
                        "batteries": [dict(b) for b in batteries],
                        "customers": [dict(c) for c in customers],
                        "invoices": [dict(inv) for inv in invoices]
                    })

                # REWARD SUMMARY & NETWORK API
                elif path == "/api/rewards/summary":
                    partner_id = user["id"]
                    
                    earned = cursor.execute("SELECT COALESCE(SUM(points_earned), 0.0) as val FROM reward_transactions WHERE beneficiary_partner_id = ? AND status = 'AVAILABLE'", (partner_id,)).fetchone()["val"]
                    redeemed = cursor.execute("SELECT COALESCE(SUM(points_redeemed), 0.0) as val FROM reward_redemptions WHERE partner_id = ? AND status IN ('APPROVED', 'PAID')", (partner_id,)).fetchone()["val"]
                    pending_red = cursor.execute("SELECT COALESCE(SUM(points_redeemed), 0.0) as val FROM reward_redemptions WHERE partner_id = ? AND status = 'PENDING'", (partner_id,)).fetchone()["val"]

                    avail = max(0.0, round(earned - redeemed - pending_red, 2))

                    txns = cursor.execute("""
                        SELECT rt.*, p.name as product_name 
                        FROM reward_transactions rt
                        JOIN products p ON p.id = rt.product_id
                        WHERE rt.beneficiary_partner_id = ?
                        ORDER BY rt.id DESC LIMIT 20
                    """, (partner_id,)).fetchall()

                    return self.send_json({
                        "available_points": avail,
                        "lifetime_earned": round(earned, 2),
                        "redeemed_points": round(redeemed, 2),
                        "pending_redemption": round(pending_red, 2),
                        "transactions": [dict(t) for t in txns]
                    })

                elif path == "/api/referrals/network":
                    partner_id = user["id"]
                    downlines = cursor.execute("""
                        SELECT u.id, u.name, u.shop_name, u.city, r.created_at
                        FROM referrals r
                        JOIN users u ON u.id = r.referred_partner_id
                        WHERE r.referrer_partner_id = ?
                    """, (partner_id,)).fetchall()

                    return self.send_json({"referrals": [dict(d) for d in downlines]})

                # CUSTOMER KHATABOOK LEDGER STATEMENT
                elif path.startswith("/api/customers/") and path.endswith("/ledger"):
                    cust_id = path.split("/")[3]
                    cust = cursor.execute("SELECT * FROM customers WHERE id = ?", (cust_id,)).fetchone()
                    if not cust:
                        return self.send_error_json("Customer not found.", 404)

                    if user["role"] == "PARTNER" and cust["partner_id"] != user["id"]:
                        return self.send_error_json("Forbidden: Access denied to this customer.", 403)

                    invs = cursor.execute("""
                        SELECT id, invoice_number, invoice_date as tx_date, grand_total as amount, 'PURCHASE' as type, payment_status as status
                        FROM invoices WHERE customer_id = ?
                    """, (cust_id,)).fetchall()

                    pmts = cursor.execute("""
                        SELECT id, reference_no as invoice_number, payment_date as tx_date, amount, 'PAYMENT' as type, payment_method as status
                        FROM payments WHERE customer_id = ?
                    """, (cust_id,)).fetchall()

                    txns = [dict(i) for i in invs] + [dict(p) for p in pmts]
                    txns.sort(key=lambda x: (x["tx_date"], x["id"]))

                    running_balance = 0.0
                    for t in txns:
                        if t["type"] == "PURCHASE":
                            running_balance += t["amount"]
                        else:
                            running_balance -= t["amount"]
                        t["running_balance"] = round(running_balance, 2)

                    tot_billed = cursor.execute("SELECT COALESCE(SUM(grand_total), 0.0) as val FROM invoices WHERE customer_id = ?", (cust_id,)).fetchone()["val"]
                    tot_paid = cursor.execute("SELECT COALESCE(SUM(amount), 0.0) as val FROM payments WHERE customer_id = ?", (cust_id,)).fetchone()["val"]

                    return self.send_json({
                        "customer": dict(cust),
                        "total_billed": round(tot_billed, 2),
                        "total_paid": round(tot_paid, 2),
                        "outstanding_balance": max(0.0, round(tot_billed - tot_paid, 2)),
                        "transactions": txns
                    })

                # CUSTOMERS LIST
                elif path == "/api/customers":
                    include_archived = query_params.get("include_archived", ["0"])[0] == "1"
                    where_clause = "WHERE 1=1" if include_archived else "WHERE (c.is_archived IS NULL OR c.is_archived = 0)"

                    if user["role"] == "PARTNER":
                        sql = f"""
                            SELECT c.*, 
                                   COUNT(i.id) as total_invoices, 
                                   COALESCE(SUM(i.grand_total), 0.0) as total_billed,
                                   (COALESCE(SUM(i.grand_total), 0.0) - COALESCE(SUM(i.paid_amount), 0.0)) as outstanding_balance
                            FROM customers c
                            LEFT JOIN invoices i ON i.customer_id = c.id AND i.partner_id = c.partner_id
                            {where_clause} AND c.partner_id = ?
                            GROUP BY c.id
                            ORDER BY c.name ASC
                        """
                        customers = cursor.execute(sql, (user["id"],)).fetchall()
                    else:
                        sql = f"""
                            SELECT c.*, u.name as partner_name, 
                                   COUNT(i.id) as total_invoices, 
                                   COALESCE(SUM(i.grand_total), 0.0) as total_billed,
                                   (COALESCE(SUM(i.grand_total), 0.0) - COALESCE(SUM(i.paid_amount), 0.0)) as outstanding_balance
                            FROM customers c
                            JOIN users u ON u.id = c.partner_id
                            LEFT JOIN invoices i ON i.customer_id = c.id
                            {where_clause}
                            GROUP BY c.id
                            ORDER BY c.name ASC
                        """
                        customers = cursor.execute(sql).fetchall()

                    res = []
                    for c in customers:
                        cd = dict(c)
                        cd["outstanding_balance"] = max(0.0, round(cd["outstanding_balance"], 2))
                        cd["payment_status"] = 'OUTSTANDING' if cd["outstanding_balance"] > 0 else 'PAID'
                        res.append(cd)

                    return self.send_json(res)

                # PRODUCTS LIST (Includes active global products + seller custom products)
                elif path == "/api/products":
                    if user["role"] == "PARTNER":
                        products = cursor.execute("""
                            SELECT * FROM products 
                            WHERE status = 'ACTIVE' AND (custom_partner_id IS NULL OR custom_partner_id = ?)
                            ORDER BY is_custom ASC, id ASC
                        """, (user["id"],)).fetchall()
                    else:
                        products = cursor.execute("SELECT * FROM products WHERE status = 'ACTIVE' ORDER BY id ASC").fetchall()
                    return self.send_json([dict(p) for p in products])

                # PAYMENTS LIST (For Payments Ledger)
                elif path == "/api/payments":
                    if user["role"] == "PARTNER":
                        payments = cursor.execute("""
                            SELECT p.*, c.name as customer_name, c.mobile as customer_mobile, i.invoice_number
                            FROM payments p
                            JOIN customers c ON c.id = p.customer_id
                            LEFT JOIN invoices i ON i.id = p.invoice_id
                            WHERE p.partner_id = ?
                            ORDER BY p.payment_date DESC, p.id DESC
                        """, (user["id"],)).fetchall()
                    else:
                        payments = cursor.execute("""
                            SELECT p.*, c.name as customer_name, c.mobile as customer_mobile, i.invoice_number, u.name as partner_name
                            FROM payments p
                            JOIN customers c ON c.id = p.customer_id
                            LEFT JOIN invoices i ON i.id = p.invoice_id
                            JOIN users u ON u.id = p.partner_id
                            ORDER BY p.payment_date DESC, p.id DESC
                        """).fetchall()

                    return self.send_json([dict(p) for p in payments])

                # INVOICES LIST
                elif path == "/api/invoices":
                    preset = query_params.get("preset", [None])[0]
                    from_d = query_params.get("from", [None])[0]
                    to_d = query_params.get("to", [None])[0]
                    d_from, d_to = parse_date_range(preset, from_d, to_d)

                    sql = """
                        SELECT i.*, c.name as customer_name, c.shop_name as customer_shop, u.name as partner_name,
                               (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) as total_items,
                               (SELECT SUM(quantity) FROM invoice_items WHERE invoice_id = i.id) as total_batteries
                        FROM invoices i
                        JOIN customers c ON c.id = i.customer_id
                        JOIN users u ON u.id = i.partner_id
                        WHERE 1=1
                    """
                    params = []

                    if user["role"] == "PARTNER":
                        sql += " AND i.partner_id = ?"
                        params.append(user["id"])

                    if d_from and d_to:
                        sql += " AND i.invoice_date BETWEEN ? AND ?"
                        params.extend([d_from, d_to])

                    sql += " ORDER BY i.invoice_date DESC, i.id DESC"
                    invoices = cursor.execute(sql, params).fetchall()

                    res = []
                    for inv in invoices:
                        d = dict(inv)
                        d["outstanding"] = max(0.0, round(d["grand_total"] - (d.get("paid_amount") or 0.0), 2))
                        res.append(d)

                    return self.send_json(res)

                # GET SINGLE INVOICE DETAILS
                elif path.startswith("/api/invoices/"):
                    inv_id = path.split("/")[-1]
                    inv = cursor.execute("""
                        SELECT i.*, c.name as customer_name, c.shop_name as customer_shop, c.mobile as customer_mobile,
                               c.address as customer_address, c.city as customer_city, c.gst_number as customer_gst,
                               u.name as seller_name, u.shop_name as seller_shop, u.phone as seller_phone, u.upi_id as seller_upi
                        FROM invoices i
                        JOIN customers c ON c.id = i.customer_id
                        JOIN users u ON u.id = i.partner_id
                        WHERE i.id = ?
                    """, (inv_id,)).fetchone()
                    
                    if not inv:
                        return self.send_error_json("Invoice not found", 404)

                    items = cursor.execute("SELECT * FROM invoice_items WHERE invoice_id = ?", (inv_id,)).fetchall()
                    payments = cursor.execute("SELECT * FROM payments WHERE invoice_id = ? ORDER BY id DESC", (inv_id,)).fetchall()
                    
                    inv_dict = dict(inv)
                    inv_dict["outstanding"] = max(0.0, round(inv_dict["grand_total"] - (inv_dict.get("paid_amount") or 0.0), 2))

                    return self.send_json({
                        "invoice": inv_dict,
                        "items": [dict(it) for it in items],
                        "payments": [dict(p) for p in payments]
                    })

                # REPORTS API
                elif path.startswith("/api/reports/"):
                    report_type = path.replace("/api/reports/", "")
                    preset = query_params.get("preset", ['this_month'])[0]
                    from_d = query_params.get("from", [None])[0]
                    to_d = query_params.get("to", [None])[0]
                    d_from, d_to = parse_date_range(preset, from_d, to_d)

                    seller_filter = query_params.get("seller_id", [None])[0]
                    if user["role"] == "PARTNER":
                        seller_filter = str(user["id"])

                    if report_type == "dashboard":
                        today_str = datetime.date.today().isoformat()
                        p_clause = " WHERE partner_id = ?" if seller_filter else " WHERE 1=1"
                        p_params = [seller_filter] if seller_filter else []

                        t_sales = cursor.execute(f"SELECT COALESCE(SUM(grand_total), 0.0) as val FROM invoices {p_clause} AND invoice_date = ?", p_params + [today_str]).fetchone()["val"]
                        t_coll = cursor.execute(f"SELECT COALESCE(SUM(amount), 0.0) as val FROM payments {p_clause} AND payment_date = ?", p_params + [today_str]).fetchone()["val"]

                        tot_bills = cursor.execute(f"SELECT COALESCE(SUM(grand_total), 0.0) as val FROM invoices {p_clause}", p_params).fetchone()["val"]
                        tot_paid = cursor.execute(f"SELECT COALESCE(SUM(amount), 0.0) as val FROM payments {p_clause}", p_params).fetchone()["val"]
                        tot_out = max(0.0, round(tot_bills - tot_paid, 2))

                        t_batt = cursor.execute(f"""
                            SELECT COALESCE(SUM(ii.quantity), 0) as val
                            FROM invoice_items ii
                            JOIN invoices i ON i.id = ii.invoice_id
                            {p_clause.replace('partner_id', 'i.partner_id')} AND i.invoice_date = ?
                        """, p_params + [today_str]).fetchone()["val"]

                        pending_partners_cnt = 0
                        if user["role"] == "ADMIN":
                            pending_partners_cnt = cursor.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'PARTNER' AND status = 'PENDING_APPROVAL'").fetchone()["cnt"]

                        return self.send_json({
                            "today_sales": round(t_sales, 2),
                            "today_collected": round(t_coll, 2),
                            "total_outstanding": round(tot_out, 2),
                            "today_batteries": t_batt,
                            "pending_partners_count": pending_partners_cnt
                        })

                    elif report_type == "hierarchical":
                        where_clause = " WHERE 1=1"
                        params = []
                        if seller_filter:
                            where_clause += " AND i.partner_id = ?"
                            params.append(seller_filter)
                        if d_from and d_to:
                            where_clause += " AND i.invoice_date BETWEEN ? AND ?"
                            params.extend([d_from, d_to])

                        rows = cursor.execute(f"""
                            SELECT 
                                u.id as seller_id, u.name as seller_name, u.shop_name as seller_shop,
                                c.id as customer_id, c.name as customer_name, c.shop_name as customer_shop,
                                ii.product_id, ii.product_name_snapshot, ii.model_code_snapshot,
                                SUM(ii.quantity) as quantity_sold,
                                SUM(ii.line_total) as total_amount
                            FROM invoice_items ii
                            JOIN invoices i ON i.id = ii.invoice_id
                            JOIN users u ON u.id = i.partner_id
                            JOIN customers c ON c.id = i.customer_id
                            {where_clause}
                            GROUP BY u.id, c.id, ii.product_id
                            ORDER BY u.name ASC, c.name ASC, quantity_sold DESC
                        """, params).fetchall()

                        tree = {}
                        for r in rows:
                            sid = r["seller_id"]
                            cid = r["customer_id"]
                            if sid not in tree:
                                tree[sid] = {
                                    "seller_id": sid,
                                    "seller_name": r["seller_name"],
                                    "seller_shop": r["seller_shop"],
                                    "total_batteries": 0,
                                    "total_amount": 0.0,
                                    "customers": {}
                                }
                            stree = tree[sid]
                            stree["total_batteries"] += r["quantity_sold"]
                            stree["total_amount"] += r["total_amount"]
                            
                            if cid not in stree["customers"]:
                                stree["customers"][cid] = {
                                    "customer_id": cid,
                                    "customer_name": r["customer_name"],
                                    "customer_shop": r["customer_shop"],
                                    "total_batteries": 0,
                                    "total_amount": 0.0,
                                    "batteries": []
                                }
                            ctree = stree["customers"][cid]
                            ctree["total_batteries"] += r["quantity_sold"]
                            ctree["total_amount"] += r["total_amount"]
                            ctree["batteries"].append({
                                "product_id": r["product_id"],
                                "product_name": r["product_name_snapshot"],
                                "model_code": r["model_code_snapshot"],
                                "quantity": r["quantity_sold"],
                                "total_amount": r["total_amount"]
                            })

                        result = []
                        for sid, sdata in tree.items():
                            sdata["customers"] = list(sdata["customers"].values())
                            result.append(sdata)

                        return self.send_json(result)

                    else:
                        return self.send_error_json("Invalid report type", 404)

            finally:
                conn.close()

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            body = json.loads(body_bytes.decode('utf-8'))
        except Exception:
            body = {}

        # 1. AUTH LOGIN
        if path == "/api/auth/login":
            email = body.get("email", "").strip().lower()
            password = body.get("password", "").strip()
            
            if not email or not password:
                return self.send_error_json("Please enter your email and password.", 400)
                
            conn = get_db()
            cursor = conn.cursor()
            user = cursor.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            conn.close()

            if not user or user["password_hash"] != hash_password(password):
                return self.send_error_json("Invalid email or password. Please try again.", 401)
                
            status = user["status"] or "PENDING_APPROVAL"
            if status == "PENDING_APPROVAL":
                return self.send_error_json("Your account is pending Admin approval. Please wait until your Mechshakti account is approved.", 403)
            elif status == "REJECTED":
                reason_msg = f" Reason: {user['rejection_reason']}" if user["rejection_reason"] else ""
                return self.send_error_json(f"Your account application has been rejected by Admin.{reason_msg}", 403)
            elif status == "SUSPENDED":
                return self.send_error_json("Your account has been suspended by Admin. Please contact Mechshakti support.", 403)
            elif status != "ACTIVE":
                return self.send_error_json("Your account is not active.", 403)

            user_data = {
                "id": user["id"],
                "name": user["name"],
                "email": user["email"],
                "role": user["role"],
                "phone": user["phone"],
                "shop_name": user["shop_name"],
                "city": user["city"] if user["city"] else "",
                "upi_id": user["upi_id"] if user["upi_id"] else "",
                "status": user["status"]
            }
            token = generate_token(user_data)
            return self.send_json({"token": token, "user": user_data})

        # 2. PARTNER SELF REGISTRATION
        elif path == "/api/auth/register":
            name = body.get("name", "").strip()
            mobile = body.get("mobile", "").strip()
            email = body.get("email", "").strip().lower()
            password = body.get("password", "").strip()
            confirm_password = body.get("confirm_password", "").strip()
            shop_name = body.get("shop_name", "").strip()
            city = body.get("city", "").strip()
            address = body.get("address", "").strip()
            gst_number = body.get("gst_number", "").strip().upper()
            dealer_code = body.get("dealer_code", "").strip()

            if not name:
                return self.send_error_json("Please enter your Full Name.", 400)
            if not mobile or not re.match(r'^[0-9]{10}$', mobile):
                return self.send_error_json("Please enter a valid 10-digit mobile number.", 400)
            if not email or not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
                return self.send_error_json("Please enter a valid email address.", 400)
            if not password or len(password) < 6:
                return self.send_error_json("Password must be at least 6 characters long.", 400)
            if password != confirm_password:
                return self.send_error_json("Passwords do not match. Please verify.", 400)
            if not shop_name:
                return self.send_error_json("Please enter your Garage / Shop Name.", 400)
            if not city:
                return self.send_error_json("Please enter your City.", 400)

            conn = get_db()
            cursor = conn.cursor()

            existing_email = cursor.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing_email:
                conn.close()
                return self.send_error_json("An account with this email address already exists.", 400)

            existing_mobile = cursor.execute("SELECT id FROM users WHERE phone = ?", (mobile,)).fetchone()
            if existing_mobile:
                conn.close()
                return self.send_error_json("An account with this mobile number already exists.", 400)

            cursor.execute("""
                INSERT INTO users (name, email, password_hash, role, phone, shop_name, city, address, gst_number, dealer_code, status)
                VALUES (?, ?, ?, 'PARTNER', ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')
            """, (name, email, hash_password(password), mobile, shop_name, city, address, gst_number, dealer_code))
            conn.commit()
            new_id = cursor.lastrowid
            conn.close()

            return self.send_json({
                "message": "Registration submitted successfully.",
                "sub_message": "Your account is waiting for Admin approval.",
                "status": "PENDING_APPROVAL",
                "id": new_id
            }, status=201)

        # 3. PUBLIC WARRANTY REGISTRATION (Sections 1, 2, 3, 4, 5, 6, 12, 13, 14)
        elif path == "/api/warranty/register":
            raw_code = body.get("battery_code", "")
            code = normalize_battery_code(raw_code)
            cust_name = body.get("customer_name", "").strip()
            cust_mobile = body.get("customer_mobile", "").strip()
            purchase_date_str = body.get("purchase_date") or datetime.date.today().isoformat()
            vehicle_number = body.get("vehicle_number", "").strip().upper()
            vehicle_model = body.get("vehicle_model", "").strip()
            card_photo_url = body.get("card_photo_url", "").strip()

            if not code or len(code) < 8:
                return self.send_error_json("Please enter or scan a valid battery serial code.", 400)
            if not cust_name or not cust_mobile:
                return self.send_error_json("Please enter customer name and mobile number.", 400)

            conn = get_db()
            cursor = conn.cursor()

            # Unified validation engine check (Section 1 & 4)
            validation = validate_battery_for_warranty_registration(code, conn)
            if not validation["valid"]:
                conn.close()
                return self.send_error_json(validation["message"], 400)

            # Find product ID
            prod_id = 1
            if validation.get("product"):
                prod_id = validation["product"]["id"]
            else:
                prod_code = code[:4]
                prod = cursor.execute("SELECT id FROM products WHERE model_code = ?", (prod_code,)).fetchone()
                if prod:
                    prod_id = prod["id"]

            partner_id = validation["scanned_sale"]["partner_id"] if validation.get("scanned_sale") else None

            # Calculate 24-Month Expiry Date (Section 16)
            try:
                p_date = datetime.date.fromisoformat(purchase_date_str)
                exp_date = datetime.date(p_date.year + 2, p_date.month, p_date.day)
            except Exception:
                p_date = datetime.date.today()
                exp_date = datetime.date(p_date.year + 2, p_date.month, p_date.day)

            # Determine initial status
            w_status = 'VALID'
            if exp_date < datetime.date.today():
                w_status = 'EXPIRED'
            elif validation.get("requires_admin_verification"):
                w_status = 'PENDING_VERIFICATION'

            # Automatic Server Registration Timestamp (Section 12)
            now_timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            try:
                cursor.execute("""
                    INSERT INTO warranty_registrations 
                    (battery_code, product_id, partner_id, customer_name, customer_mobile, purchase_date, expiry_date, vehicle_number, vehicle_model, card_photo_url, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, prod_id, partner_id, cust_name, cust_mobile, p_date.isoformat(), exp_date.isoformat(), vehicle_number, vehicle_model, card_photo_url, w_status, now_timestamp))
                conn.commit()
                w_id = cursor.lastrowid
                conn.close()

                return self.send_json({
                    "message": "✓ WARRANTY REGISTERED",
                    "id": w_id,
                    "battery_code": code,
                    "purchase_date": p_date.isoformat(),
                    "expiry_date": exp_date.isoformat(),
                    "registered_at": now_timestamp,
                    "status": w_status
                }, status=201)

            except sqlite3.IntegrityError:
                # Concurrent race condition database protection (Section 3)
                conn.close()
                return self.send_error_json("THIS BATTERY WARRANTY IS ALREADY REGISTERED.", 400)

        user = self.get_auth_user()
        if not user:
            return self.send_error_json("Unauthorized", 401)

        conn = get_db()
        cursor = conn.cursor()

        try:
            # ADMIN MANUALLY ADD SERIAL & APPROVE (Section 8)
            if path == "/api/admin/battery-master/add-serial":
                if user["role"] != "ADMIN":
                    return self.send_error_json("Admin access required", 403)
                
                raw_code = body.get("battery_code", "")
                code = normalize_battery_code(raw_code)
                prod_id = body.get("product_id")

                if not code or not prod_id:
                    return self.send_error_json("Serial code and product ID required.", 400)

                # Check if serial already exists in active warranty
                existing_w = cursor.execute("SELECT id FROM warranty_registrations WHERE battery_code = ? AND status IN ('VALID', 'EXPIRED')", (code,)).fetchone()
                if existing_w:
                    return self.send_error_json("This battery already has an active warranty registration.", 400)

                # Approve pending warranty if exists
                pending = cursor.execute("SELECT id FROM warranty_registrations WHERE battery_code = ? AND status = 'PENDING_VERIFICATION'", (code,)).fetchone()
                if pending:
                    cursor.execute("UPDATE warranty_registrations SET status = 'VALID', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (pending["id"],))

                cursor.execute("INSERT INTO audit_logs (actor_user_id, action_type, target_entity, target_id, new_value, reason) VALUES (?, 'ADD_BATTERY_SERIAL', 'battery_master', 0, ?, 'Admin manual serial addition')", (user["id"], code))
                conn.commit()

                return self.send_json({"message": f"Serial '{code}' added to battery master and approved."})

            # UPDATE SELLER PROFILE UPI DETAILS
            elif path == "/api/profile/upi":
                upi_id = body.get("upi_id", "").strip()
                cursor.execute("UPDATE users SET upi_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (upi_id, user["id"]))
                conn.commit()
                return self.send_json({"message": "UPI details updated successfully.", "upi_id": upi_id})

            # REFERRAL CREATION
            elif path == "/api/referrals":
                ref_mobile = body.get("mobile", "").strip()
                if not ref_mobile or not re.match(r'^[0-9]{10}$', ref_mobile):
                    return self.send_error_json("Please enter a valid 10-digit mobile number.", 400)

                target_partner = cursor.execute("SELECT id, name FROM users WHERE phone = ? AND role = 'PARTNER'", (ref_mobile,)).fetchone()
                if not target_partner:
                    return self.send_error_json("No partner account found registered with this mobile number.", 404)

                if target_partner["id"] == user["id"]:
                    return self.send_error_json("Self-referral is not permitted.", 400)

                try:
                    cursor.execute("INSERT INTO referrals (referrer_partner_id, referred_partner_id) VALUES (?, ?)", (user["id"], target_partner["id"]))
                    conn.commit()
                    return self.send_json({"message": f"Referral created! Link established with {target_partner['name']}."}, status=201)
                except sqlite3.IntegrityError:
                    return self.send_error_json("Referral link already exists.", 400)

            # REWARD REDEMPTION REQUEST
            elif path == "/api/rewards/redeem":
                pts = float(body.get("points", 0.0))
                if pts <= 0:
                    return self.send_error_json("Please enter valid reward points.", 400)

                earned = cursor.execute("SELECT COALESCE(SUM(points_earned), 0.0) as val FROM reward_transactions WHERE beneficiary_partner_id = ? AND status = 'AVAILABLE'", (user["id"],)).fetchone()["val"]
                redeemed = cursor.execute("SELECT COALESCE(SUM(points_redeemed), 0.0) as val FROM reward_redemptions WHERE partner_id = ? AND status IN ('APPROVED', 'PAID')", (user["id"],)).fetchone()["val"]
                pending_red = cursor.execute("SELECT COALESCE(SUM(points_redeemed), 0.0) as val FROM reward_redemptions WHERE partner_id = ? AND status = 'PENDING'", (user["id"],)).fetchone()["val"]

                avail = max(0.0, round(earned - redeemed - pending_red, 2))
                if pts > avail:
                    return self.send_error_json(f"Insufficient available reward points. Available: {avail} pts", 400)

                cursor.execute("""
                    INSERT INTO reward_redemptions (partner_id, points_redeemed, payout_amount, payment_method, status)
                    VALUES (?, ?, ?, ?, 'PENDING')
                """, (user["id"], pts, pts * 10.0, body.get("payment_method", "BANK")))
                conn.commit()

                return self.send_json({"message": "Redemption request submitted to Admin for payout processing."}, status=201)

            # VERIFY & DECODE BATTERY QR CODE
            elif path == "/api/batteries/verify-code":
                code = normalize_battery_code(body.get("code", ""))
                if not code:
                    return self.send_error_json("Please scan or enter a battery code.", 400)

                decoded = decode_mechshakti_battery_code(code, conn)
                if "error" in decoded:
                    return self.send_error_json(decoded["error"], 400)

                partner_id = user["id"] if user["role"] == "PARTNER" else (body.get("partner_id") or user["id"])
                existing = cursor.execute("SELECT id, invoice_id FROM scanned_batteries WHERE battery_code = ? AND partner_id = ?", (decoded["battery_code"], partner_id)).fetchone()
                if existing:
                    return self.send_error_json("This battery code has already been recorded.", 400)

                return self.send_json(decoded)

            # CREATE CUSTOMER
            elif path == "/api/customers":
                name = body.get("name", "").strip()
                mobile = body.get("mobile", "").strip()
                shop_name = body.get("shop_name", "").strip()
                address = body.get("address", "").strip()
                city = body.get("city", "").strip()
                gst_number = body.get("gst_number", "").strip().upper()
                vehicle_number = body.get("vehicle_number", "").strip().upper()

                if not name:
                    return self.send_error_json("Please enter the customer's name.", 400)
                if not mobile:
                    return self.send_error_json("Please enter the mobile number.", 400)

                partner_id = user["id"] if user["role"] == "PARTNER" else (body.get("partner_id") or user["id"])

                cursor.execute("""
                    INSERT INTO customers (partner_id, name, shop_name, mobile, address, city, gst_number, vehicle_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (partner_id, name, shop_name, mobile, address, city, gst_number, vehicle_number))
                conn.commit()
                
                new_cust_id = cursor.lastrowid
                created_cust = cursor.execute("SELECT * FROM customers WHERE id = ?", (new_cust_id,)).fetchone()

                return self.send_json({
                    "message": "Customer added successfully.", 
                    "id": new_cust_id,
                    "customer": dict(created_cust)
                }, status=201)

            # CREATE PRODUCT / BATTERY MODEL
            elif path == "/api/products":
                name = body.get("name", "").strip()
                model_code = body.get("model_code", "").strip().upper()
                selling_price = float(body.get("selling_price", 0.0))
                gst_rate = float(body.get("gst_rate", 18.0))
                category = body.get("category", "BATTERY").strip().upper()

                if not name:
                    return self.send_error_json("Please enter the battery product name.", 400)
                if not model_code:
                    return self.send_error_json("Please enter the model code (e.g. MS05).", 400)
                if selling_price <= 0:
                    return self.send_error_json("Please enter a valid selling price.", 400)

                existing = cursor.execute("SELECT id FROM products WHERE model_code = ?", (model_code,)).fetchone()
                if existing:
                    return self.send_error_json(f"Model code '{model_code}' already exists in catalog.", 400)

                custom_p = user["id"] if user["role"] == "PARTNER" else None

                cursor.execute("""
                    INSERT INTO products (name, model_code, category, selling_price, gst_rate, custom_partner_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (name, model_code, category, selling_price, gst_rate, custom_p))
                conn.commit()

                new_prod_id = cursor.lastrowid
                created_prod = cursor.execute("SELECT * FROM products WHERE id = ?", (new_prod_id,)).fetchone()

                return self.send_json({
                    "message": "Battery product added to catalog successfully.",
                    "id": new_prod_id,
                    "product": dict(created_prod)
                }, status=201)

            # SELLER OTHER PRODUCT / CUSTOM PRODUCT CREATION (Sections 10, 11, 12)
            elif path == "/api/products/custom":
                name = body.get("name", "").strip()
                selling_price = float(body.get("selling_price", 0.0))
                gst_rate = float(body.get("gst_rate", 18.0))
                model_code = body.get("model_code", "").strip().upper()

                if not name:
                    return self.send_error_json("Please enter product name.", 400)
                if selling_price <= 0:
                    return self.send_error_json("Please enter valid price.", 400)

                if not model_code:
                    model_code = f"CUST-{user['id']}-{int(time.time()) % 100000}"

                cursor.execute("""
                    INSERT INTO products (name, model_code, category, selling_price, gst_rate, custom_partner_id, is_custom)
                    VALUES (?, ?, 'OTHER', ?, ?, ?, 1)
                """, (name, model_code, selling_price, gst_rate, user["id"]))
                conn.commit()

                new_prod_id = cursor.lastrowid
                created_prod = cursor.execute("SELECT * FROM products WHERE id = ?", (new_prod_id,)).fetchone()

                return self.send_json({
                    "message": f"✓ Custom product '{name}' added to your catalog.",
                    "id": new_prod_id,
                    "product": dict(created_prod)
                }, status=201)

            # RECORD PAYMENT
            elif path == "/api/payments":
                customer_id = body.get("customer_id")
                invoice_id = body.get("invoice_id")
                amount = float(body.get("amount", 0))
                payment_method = body.get("payment_method", "CASH").upper()
                reference_no = body.get("reference_no", "").strip()
                payment_date = body.get("payment_date") or datetime.date.today().isoformat()
                notes = body.get("notes", "").strip()

                if not customer_id:
                    return self.send_error_json("Please select a customer.", 400)
                if amount <= 0:
                    return self.send_error_json("Please enter a valid payment amount.", 400)

                partner_id = user["id"] if user["role"] == "PARTNER" else (body.get("partner_id") or user["id"])

                cursor.execute("""
                    INSERT INTO payments (partner_id, customer_id, invoice_id, amount, payment_method, reference_no, payment_date, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (partner_id, customer_id, invoice_id, amount, payment_method, reference_no, payment_date, notes))

                remaining_payment = amount
                if invoice_id:
                    inv = cursor.execute("SELECT grand_total, paid_amount FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
                    if inv:
                        new_paid = (inv["paid_amount"] or 0.0) + amount
                        st = 'PAID' if new_paid >= inv["grand_total"] else ('PARTIALLY_PAID' if new_paid > 0 else 'UNPAID')
                        cursor.execute("UPDATE invoices SET paid_amount = ?, payment_status = ? WHERE id = ?", (new_paid, st, invoice_id))
                else:
                    unpaid_invs = cursor.execute("""
                        SELECT id, grand_total, paid_amount FROM invoices 
                        WHERE customer_id = ? AND payment_status != 'PAID' 
                        ORDER BY invoice_date ASC, id ASC
                    """, (customer_id,)).fetchall()

                    for inv in unpaid_invs:
                        if remaining_payment <= 0:
                            break
                        needed = inv["grand_total"] - (inv["paid_amount"] or 0.0)
                        add_p = min(remaining_payment, needed)
                        new_paid = (inv["paid_amount"] or 0.0) + add_p
                        st = 'PAID' if new_paid >= inv["grand_total"] else ('PARTIALLY_PAID' if new_paid > 0 else 'UNPAID')
                        cursor.execute("UPDATE invoices SET paid_amount = ?, payment_status = ? WHERE id = ?", (new_paid, st, inv["id"]))
                        remaining_payment -= add_p

                conn.commit()
                return self.send_json({"message": "Payment recorded successfully.", "id": cursor.lastrowid}, status=201)

            # CREATE NEW BILL / INVOICE
            elif path == "/api/invoices":
                customer_id = body.get("customer_id")
                invoice_date = body.get("invoice_date") or datetime.date.today().isoformat()
                items = body.get("items", [])
                client_nonce = body.get("client_nonce")
                payment_mode = body.get("payment_mode", "PAID")
                payment_method = body.get("payment_method", "CASH").upper()
                initial_paid_amount = float(body.get("paid_amount", 0.0))
                notes = body.get("notes", "")

                if not customer_id:
                    return self.send_error_json("Please select a customer.", 400)
                if not items or len(items) == 0:
                    return self.send_error_json("Please add at least one battery model.", 400)

                partner_id = user["id"] if user["role"] == "PARTNER" else (body.get("partner_id") or user["id"])

                taxable_amount = 0.0
                discount_amount = 0.0
                gst_amount = 0.0
                grand_total = 0.0
                processed_items = []

                for item in items:
                    prod_id = item.get("product_id")
                    prod = cursor.execute("SELECT * FROM products WHERE id = ?", (prod_id,)).fetchone()
                    if not prod:
                        return self.send_error_json("Battery product not found.", 400)

                    qty = int(item.get("quantity", 1))
                    unit_price = float(item.get("unit_price", prod["selling_price"]))
                    disc = float(item.get("discount", 0.0))
                    gst_rate = float(item.get("gst_rate", prod["gst_rate"]))

                    line_base = (unit_price * qty) - disc
                    line_gst = line_base * (gst_rate / 100.0)
                    line_total = line_base + line_gst

                    taxable_amount += line_base
                    discount_amount += disc
                    gst_amount += line_gst
                    grand_total += line_total

                    b_code_norm = normalize_battery_code(item.get("battery_code", ""))

                    processed_items.append({
                        "product_id": prod["id"],
                        "product_name_snapshot": prod["name"],
                        "model_code_snapshot": prod["model_code"],
                        "battery_code": b_code_norm or None,
                        "mfg_period": item.get("mfg_period"),
                        "quantity": qty,
                        "unit_price": unit_price,
                        "discount": disc,
                        "gst_rate": gst_rate,
                        "gst_amount": line_gst,
                        "line_total": line_total
                    })

                seq_row = cursor.execute("SELECT COUNT(*) as cnt FROM invoices WHERE partner_id = ?", (partner_id,)).fetchone()
                seq = (seq_row["cnt"] if seq_row else 0) + 1001
                inv_number = f"MSI-{seq}"

                if payment_mode == 'PAID':
                    actual_paid = round(grand_total, 2)
                    pay_status = 'PAID'
                elif payment_mode == 'CREDIT':
                    actual_paid = 0.0
                    pay_status = 'UNPAID'
                else:
                    actual_paid = min(round(grand_total, 2), round(initial_paid_amount, 2))
                    pay_status = 'PAID' if actual_paid >= round(grand_total, 2) else ('PARTIALLY_PAID' if actual_paid > 0 else 'UNPAID')

                cursor.execute("""
                    INSERT INTO invoices (invoice_number, client_nonce, partner_id, customer_id, invoice_date, taxable_amount, discount_amount, gst_amount, grand_total, paid_amount, payment_status, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (inv_number, client_nonce, partner_id, customer_id, invoice_date, round(taxable_amount, 2), round(discount_amount, 2), round(gst_amount, 2), round(grand_total, 2), actual_paid, pay_status, notes))
                
                inv_id = cursor.lastrowid

                for pi in processed_items:
                    cursor.execute("""
                        INSERT INTO invoice_items (invoice_id, partner_id, product_id, product_name_snapshot, model_code_snapshot, battery_code, mfg_period, quantity, unit_price, discount, gst_rate, gst_amount, line_total)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (inv_id, partner_id, pi["product_id"], pi["product_name_snapshot"], pi["model_code_snapshot"], pi["battery_code"], pi["mfg_period"], pi["quantity"], pi["unit_price"], pi["discount"], pi["gst_rate"], round(pi["gst_amount"], 2), round(pi["line_total"], 2)))

                    if pi["battery_code"]:
                        try:
                            cursor.execute("""
                                INSERT INTO scanned_batteries (partner_id, battery_code, product_id, invoice_id)
                                VALUES (?, ?, ?, ?)
                            """, (partner_id, pi["battery_code"], pi["product_id"], inv_id))
                        except sqlite3.IntegrityError:
                            pass

                if actual_paid > 0:
                    cursor.execute("""
                        INSERT INTO payments (partner_id, customer_id, invoice_id, amount, payment_method, payment_date, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (partner_id, customer_id, inv_id, actual_paid, payment_method, invoice_date, f'Bill #{inv_number} payment'))

                calculate_and_award_referral_points(conn, partner_id, inv_id, processed_items)

                conn.commit()

                return self.send_json({
                    "message": "Bill generated successfully.",
                    "id": inv_id,
                    "invoice_number": inv_number,
                    "grand_total": round(grand_total, 2),
                    "paid_amount": actual_paid,
                    "outstanding": max(0.0, round(grand_total - actual_paid, 2)),
                    "payment_status": pay_status
                }, status=201)

            else:
                return self.send_error_json("Not Found", 404)

        finally:
            conn.close()

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        user = self.get_auth_user()
        if not user:
            return self.send_error_json("Unauthorized", 401)

        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            body = json.loads(body_bytes.decode('utf-8'))
        except Exception:
            body = {}

        conn = get_db()
        cursor = conn.cursor()

        try:
            # ADMIN PARTNER STATUS UPDATE
            if path.startswith("/api/admin/sellers/") and path.endswith("/status"):
                if user["role"] != "ADMIN":
                    return self.send_error_json("Forbidden: Admin access required", 403)
                
                parts = path.split("/")
                target_seller_id = parts[-2]
                action = body.get("action", "").upper()
                rejection_reason = body.get("rejection_reason", "").strip()

                target = cursor.execute("SELECT id, name FROM users WHERE id = ? AND role = 'PARTNER'", (target_seller_id,)).fetchone()
                if not target:
                    return self.send_error_json("Partner account not found.", 404)

                new_status = "ACTIVE" if action in ["APPROVE", "ACTIVATE"] else ("REJECTED" if action == "REJECT" else "SUSPENDED")

                cursor.execute("UPDATE users SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_status, rejection_reason if action == "REJECT" else None, target_seller_id))
                conn.commit()

                return self.send_json({"message": f"Partner account '{target['name']}' updated to {new_status}.", "status": new_status})

            # ADMIN APPROVE PENDING WARRANTY (Sections 7, 8, 9)
            elif path.startswith("/api/admin/warranties/") and path.endswith("/approve"):
                if user["role"] != "ADMIN":
                    return self.send_error_json("Admin access required", 403)
                
                w_id = path.split("/")[-2]
                w_rec = cursor.execute("SELECT * FROM warranty_registrations WHERE id = ?", (w_id,)).fetchone()
                if not w_rec:
                    return self.send_error_json("Warranty record not found.", 404)

                if w_rec["status"] == "VALID":
                    return self.send_error_json("This battery already has an active warranty registration.", 400)

                # Check duplicate active registration (Section 9)
                dup = cursor.execute("SELECT id FROM warranty_registrations WHERE battery_code = ? AND id != ? AND status IN ('VALID', 'EXPIRED')", (w_rec["battery_code"], w_id)).fetchone()
                if dup:
                    return self.send_error_json("This battery already has an active warranty registration.", 400)

                cursor.execute("UPDATE warranty_registrations SET status = 'VALID', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (w_id,))
                cursor.execute("INSERT INTO audit_logs (actor_user_id, action_type, target_entity, target_id, old_value, new_value, reason) VALUES (?, 'WARRANTY_APPROVED', 'warranty_registrations', ?, ?, 'VALID', 'Admin approved warranty')", (user["id"], w_id, w_rec["status"]))
                conn.commit()

                return self.send_json({"message": f"Warranty registration for serial '{w_rec['battery_code']}' approved."})

            # EDIT CUSTOMER DETAILS (Section 6)
            elif path.startswith("/api/customers/"):
                cust_id = path.split("/")[-1]
                cust = cursor.execute("SELECT * FROM customers WHERE id = ?", (cust_id,)).fetchone()
                if not cust:
                    return self.send_error_json("Customer not found.", 404)

                if user["role"] == "PARTNER" and cust["partner_id"] != user["id"]:
                    return self.send_error_json("Forbidden: Access denied to this customer.", 403)

                name = body.get("name", "").strip()
                mobile = body.get("mobile", "").strip()
                shop_name = body.get("shop_name", "").strip()
                address = body.get("address", "").strip()
                city = body.get("city", "").strip()
                gst_number = body.get("gst_number", "").strip().upper()
                vehicle_number = body.get("vehicle_number", "").strip().upper()

                if not name:
                    return self.send_error_json("Customer name required.", 400)
                if not mobile:
                    return self.send_error_json("Mobile number required.", 400)

                cursor.execute("""
                    UPDATE customers 
                    SET name = ?, mobile = ?, shop_name = ?, address = ?, city = ?, gst_number = ?, vehicle_number = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (name, mobile, shop_name, address, city, gst_number, vehicle_number, cust_id))
                conn.commit()

                updated_cust = cursor.execute("SELECT * FROM customers WHERE id = ?", (cust_id,)).fetchone()
                return self.send_json({"message": "✓ Customer updated successfully.", "customer": dict(updated_cust)})

            # ADMIN CANCEL EXISTING WARRANTY WITH AUDIT TRAIL (Section 10)
            elif path.startswith("/api/admin/warranties/") and path.endswith("/cancel"):
                if user["role"] != "ADMIN":
                    return self.send_error_json("Admin access required", 403)
                
                w_id = path.split("/")[-2]
                reason = body.get("reason", "").strip()
                if not reason:
                    return self.send_error_json("Please provide an audit reason for cancelling this warranty.", 400)

                w_rec = cursor.execute("SELECT * FROM warranty_registrations WHERE id = ?", (w_id,)).fetchone()
                if not w_rec:
                    return self.send_error_json("Warranty record not found.", 404)

                cancelled_code_marker = f"CANCELLED_{w_rec['id']}_{w_rec['battery_code']}"
                cursor.execute("UPDATE warranty_registrations SET status = 'CANCELLED', battery_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (cancelled_code_marker, w_id))
                cursor.execute("INSERT INTO audit_logs (actor_user_id, action_type, target_entity, target_id, old_value, new_value, reason) VALUES (?, 'WARRANTY_CANCELLED', 'warranty_registrations', ?, ?, 'CANCELLED', ?)", (user["id"], w_id, w_rec["status"], reason))
                conn.commit()

                return self.send_json({"message": f"Warranty for serial '{w_rec['battery_code']}' cancelled. Audit record created."})

            else:
                return self.send_error_json("Not Found", 404)

        finally:
            conn.close()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        user = self.get_auth_user()
        if not user:
            return self.send_error_json("Unauthorized", 401)

        conn = get_db()
        cursor = conn.cursor()

        try:
            # ARCHIVE / DELETE CUSTOMER (Section 7)
            if path.startswith("/api/customers/"):
                cust_id = path.split("/")[-1]
                cust = cursor.execute("SELECT * FROM customers WHERE id = ?", (cust_id,)).fetchone()
                if not cust:
                    return self.send_error_json("Customer not found.", 404)

                if user["role"] == "PARTNER" and cust["partner_id"] != user["id"]:
                    return self.send_error_json("Forbidden: Access denied.", 403)

                has_invs = cursor.execute("SELECT id FROM invoices WHERE customer_id = ?", (cust_id,)).fetchone()
                has_pmts = cursor.execute("SELECT id FROM payments WHERE customer_id = ?", (cust_id,)).fetchone()

                if has_invs or has_pmts:
                    cursor.execute("UPDATE customers SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (cust_id,))
                    conn.commit()
                    return self.send_json({"message": "✓ Customer archived successfully. Historical transaction records preserved.", "archived": True})
                else:
                    cursor.execute("DELETE FROM customers WHERE id = ?", (cust_id,))
                    conn.commit()
                    return self.send_json({"message": "✓ Customer deleted successfully.", "deleted": True})

            else:
                return self.send_error_json("Not Found", 404)
        finally:
            conn.close()


def run():
    init_db()
    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("", PORT), MechshaktiRequestHandler)
    print(f"Server started on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.server_close()

if __name__ == "__main__":
    run()
