import http.server
import socketserver
import json
import urllib.parse
import os
import re
import datetime
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

def decode_mechshakti_battery_code(code: str, conn):
    code_clean = code.strip().upper()
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

        # Verify active status directly from DB on every call
        conn = get_db()
        cursor = conn.cursor()
        u = cursor.execute("SELECT id, name, email, role, phone, shop_name, status FROM users WHERE id = ?", (payload["id"],)).fetchone()
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
                # 1. ADMIN SELLERS / PARTNERS LIST (Filterable by status)
                if path == "/api/admin/sellers":
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

                # 1B. ADMIN SINGLE PARTNER DETAIL
                elif path.startswith("/api/admin/sellers/") and not path.endswith("/status"):
                    if user["role"] != "ADMIN":
                        return self.send_error_json("Forbidden: Admin access required", 403)
                    target_id = path.split("/")[-1]
                    seller = cursor.execute("SELECT * FROM users WHERE id = ? AND role = 'PARTNER'", (target_id,)).fetchone()
                    if not seller:
                        return self.send_error_json("Partner account not found.", 404)
                    return self.send_json({"partner": dict(seller)})

                # 2. CUSTOMERS LIST WITH SEARCH & OUTSTANDING BALANCES
                elif path == "/api/customers":
                    filter_status = query_params.get("status", [None])[0]
                    search_q = query_params.get("q", [None])[0]
                    
                    if user["role"] == "PARTNER":
                        sql = """
                            SELECT c.*, 
                                   COUNT(i.id) as total_invoices, 
                                   COALESCE(SUM(i.grand_total), 0.0) as total_billed,
                                   (COALESCE(SUM(i.grand_total), 0.0) - COALESCE(SUM(i.paid_amount), 0.0)) as outstanding_balance
                            FROM customers c
                            LEFT JOIN invoices i ON i.customer_id = c.id AND i.partner_id = c.partner_id
                            WHERE c.partner_id = ?
                            GROUP BY c.id
                            ORDER BY c.name ASC
                        """
                        customers = cursor.execute(sql, (user["id"],)).fetchall()
                    else:
                        seller_filter = query_params.get("seller_id", [None])[0]
                        if seller_filter:
                            sql = """
                                SELECT c.*, u.name as partner_name, 
                                       COUNT(i.id) as total_invoices, 
                                       COALESCE(SUM(i.grand_total), 0.0) as total_billed,
                                       (COALESCE(SUM(i.grand_total), 0.0) - COALESCE(SUM(i.paid_amount), 0.0)) as outstanding_balance
                                FROM customers c
                                JOIN users u ON u.id = c.partner_id
                                LEFT JOIN invoices i ON i.customer_id = c.id
                                WHERE c.partner_id = ?
                                GROUP BY c.id
                                ORDER BY c.name ASC
                            """
                            customers = cursor.execute(sql, (seller_filter,)).fetchall()
                        else:
                            sql = """
                                SELECT c.*, u.name as partner_name, 
                                       COUNT(i.id) as total_invoices, 
                                       COALESCE(SUM(i.grand_total), 0.0) as total_billed,
                                       (COALESCE(SUM(i.grand_total), 0.0) - COALESCE(SUM(i.paid_amount), 0.0)) as outstanding_balance
                                FROM customers c
                                JOIN users u ON u.id = c.partner_id
                                LEFT JOIN invoices i ON i.customer_id = c.id
                                GROUP BY c.id
                                ORDER BY c.name ASC
                            """
                            customers = cursor.execute(sql).fetchall()

                    res = []
                    for c in customers:
                        cd = dict(c)
                        cd["outstanding_balance"] = max(0.0, round(cd["outstanding_balance"], 2))
                        cd["payment_status"] = 'OUTSTANDING' if cd["outstanding_balance"] > 0 else 'PAID'
                        
                        if search_q:
                            sq = search_q.lower()
                            if not (sq in cd["name"].lower() or (cd["shop_name"] and sq in cd["shop_name"].lower()) or sq in cd["mobile"]):
                                continue

                        if filter_status == 'outstanding' and cd["outstanding_balance"] <= 0:
                            continue
                        if filter_status == 'paid' and cd["outstanding_balance"] > 0:
                            continue
                        res.append(cd)

                    return self.send_json(res)

                # 3. CUSTOMER LEDGER & TRANSACTIONS
                elif path.startswith("/api/customers/") and path.endswith("/ledger"):
                    parts = path.split("/")
                    cust_id = parts[-2]
                    
                    if user["role"] == "PARTNER":
                        cust = cursor.execute("SELECT * FROM customers WHERE id = ? AND partner_id = ?", (cust_id, user["id"])).fetchone()
                        if not cust:
                            return self.send_error_json("Customer not found or unauthorized", 404)
                    else:
                        cust = cursor.execute("SELECT c.*, u.name as partner_name FROM customers c JOIN users u ON u.id = c.partner_id WHERE c.id = ?", (cust_id,)).fetchone()
                        if not cust:
                            return self.send_error_json("Customer not found", 404)

                    invoices = cursor.execute("""
                        SELECT id, invoice_number, invoice_date, grand_total, paid_amount, payment_status, 'INVOICE' as type, created_at
                        FROM invoices
                        WHERE customer_id = ?
                        ORDER BY invoice_date DESC, id DESC
                    """, (cust_id,)).fetchall()

                    payments = cursor.execute("""
                        SELECT id, amount, payment_method, reference_no, payment_date, notes, 'PAYMENT' as type, created_at
                        FROM payments
                        WHERE customer_id = ?
                        ORDER BY payment_date DESC, id DESC
                    """, (cust_id,)).fetchall()

                    total_bills = sum(inv["grand_total"] for inv in invoices)
                    total_paid = sum(p["amount"] for p in payments)
                    outstanding = max(0.0, round(total_bills - total_paid, 2))

                    transactions = []
                    for inv in invoices:
                        transactions.append({
                            "type": "INVOICE",
                            "id": inv["id"],
                            "number": inv["invoice_number"],
                            "date": inv["invoice_date"],
                            "amount": inv["grand_total"],
                            "paid_amount": inv["paid_amount"],
                            "status": inv["payment_status"],
                            "timestamp": inv["created_at"]
                        })
                    for p in payments:
                        transactions.append({
                            "type": "PAYMENT",
                            "id": p["id"],
                            "method": p["payment_method"],
                            "ref": p["reference_no"],
                            "date": p["payment_date"],
                            "amount": p["amount"],
                            "notes": p["notes"],
                            "timestamp": p["created_at"]
                        })

                    transactions.sort(key=lambda x: x["timestamp"], reverse=True)

                    return self.send_json({
                        "customer": dict(cust),
                        "summary": {
                            "total_bills": round(total_bills, 2),
                            "total_paid": round(total_paid, 2),
                            "outstanding": outstanding
                        },
                        "transactions": transactions
                    })

                # 4. SINGLE CUSTOMER DETAILS
                elif path.startswith("/api/customers/"):
                    cust_id = path.split("/")[-1]
                    if user["role"] == "PARTNER":
                        cust = cursor.execute("SELECT * FROM customers WHERE id = ? AND partner_id = ?", (cust_id, user["id"])).fetchone()
                        if not cust:
                            return self.send_error_json("Customer not found or unauthorized", 404)
                    else:
                        cust = cursor.execute("SELECT c.*, u.name as partner_name FROM customers c JOIN users u ON u.id = c.partner_id WHERE c.id = ?", (cust_id,)).fetchone()
                        if not cust:
                            return self.send_error_json("Customer not found", 404)

                    return self.send_json({"customer": dict(cust)})

                # 5. PRODUCTS LIST
                elif path == "/api/products":
                    products = cursor.execute("SELECT * FROM products ORDER BY id ASC").fetchall()
                    return self.send_json([dict(p) for p in products])

                # 6. INVOICES LIST
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
                    else:
                        seller_filter = query_params.get("seller_id", [None])[0]
                        if seller_filter:
                            sql += " AND i.partner_id = ?"
                            params.append(seller_filter)

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

                # 7. GET SINGLE INVOICE DETAILS
                elif path.startswith("/api/invoices/"):
                    inv_id = path.split("/")[-1]
                    if user["role"] == "PARTNER":
                        inv = cursor.execute("""
                            SELECT i.*, c.name as customer_name, c.shop_name as customer_shop, c.mobile as customer_mobile,
                                   c.address as customer_address, c.city as customer_city, c.gst_number as customer_gst,
                                   u.name as seller_name, u.shop_name as seller_shop, u.phone as seller_phone
                            FROM invoices i
                            JOIN customers c ON c.id = i.customer_id
                            JOIN users u ON u.id = i.partner_id
                            WHERE i.id = ? AND i.partner_id = ?
                        """, (inv_id, user["id"])).fetchone()
                        if not inv:
                            return self.send_error_json("Invoice not found or unauthorized", 404)
                    else:
                        inv = cursor.execute("""
                            SELECT i.*, c.name as customer_name, c.shop_name as customer_shop, c.mobile as customer_mobile,
                                   c.address as customer_address, c.city as customer_city, c.gst_number as customer_gst,
                                   u.name as seller_name, u.shop_name as seller_shop, u.phone as seller_phone
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

                # 8. REPORTS API
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

                        w_clause = " WHERE 1=1"
                        w_params = []
                        if seller_filter:
                            w_clause += " AND i.partner_id = ?"
                            w_params.append(seller_filter)
                        if d_from and d_to:
                            w_clause += " AND i.invoice_date BETWEEN ? AND ?"
                            w_params.extend([d_from, d_to])

                        period_stats = cursor.execute(f"""
                            SELECT 
                                COUNT(DISTINCT i.id) as total_invoices,
                                COALESCE(SUM(i.grand_total), 0) as period_sales,
                                COUNT(DISTINCT i.customer_id) as total_customers,
                                COALESCE((SELECT SUM(ii.quantity) FROM invoice_items ii JOIN invoices i2 ON i2.id = ii.invoice_id {w_clause.replace('i.', 'i2.')}), 0) as period_batteries
                            FROM invoices i
                            {w_clause}
                        """, w_params + w_params).fetchone()

                        pending_partners_cnt = 0
                        if user["role"] == "ADMIN":
                            pending_partners_cnt = cursor.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'PARTNER' AND status = 'PENDING_APPROVAL'").fetchone()["cnt"]

                        return self.send_json({
                            "today_sales": round(t_sales, 2),
                            "today_collected": round(t_coll, 2),
                            "total_outstanding": round(tot_out, 2),
                            "today_batteries": t_batt,
                            "period_invoices": period_stats["total_invoices"] if period_stats else 0,
                            "period_sales": period_stats["period_sales"] if period_stats else 0.0,
                            "period_customers": period_stats["total_customers"] if period_stats else 0,
                            "period_batteries": period_stats["period_batteries"] if period_stats else 0,
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
                
            # Strict Status Model Checks
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
                "status": user["status"]
            }
            token = generate_token(user_data)
            return self.send_json({"token": token, "user": user_data})

        # 2. PARTNER SELF REGISTRATION (Unauthenticated Endpoint)
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

            # Input Validations
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

            # Duplicate email check
            existing_email = cursor.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing_email:
                conn.close()
                return self.send_error_json("An account with this email address already exists.", 400)

            # Duplicate mobile number check
            existing_mobile = cursor.execute("SELECT id FROM users WHERE phone = ?", (mobile,)).fetchone()
            if existing_mobile:
                conn.close()
                return self.send_error_json("An account with this mobile number already exists.", 400)

            # Insert with status PENDING_APPROVAL (No token issued)
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

        user = self.get_auth_user()
        if not user:
            return self.send_error_json("Unauthorized", 401)

        conn = get_db()
        cursor = conn.cursor()

        try:
            # 3. VERIFY & DECODE BATTERY QR CODE
            if path == "/api/batteries/verify-code":
                code = body.get("code", "").strip()
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

            # 4. CREATE PARTNER (Admin Direct Create)
            elif path == "/api/admin/sellers":
                if user["role"] != "ADMIN":
                    return self.send_error_json("Admin access required.", 403)
                
                name = body.get("name", "").strip()
                email = body.get("email", "").strip().lower()
                password = body.get("password", "").strip()
                phone = body.get("phone", "").strip()
                shop_name = body.get("shop_name", "").strip()

                if not name or not email or not password:
                    return self.send_error_json("Please enter seller name, email and password.", 400)

                existing = cursor.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                if existing:
                    return self.send_error_json("Email address is already registered.", 400)

                cursor.execute("""
                    INSERT INTO users (name, email, password_hash, role, phone, shop_name, status)
                    VALUES (?, ?, ?, 'PARTNER', ?, ?, 'ACTIVE')
                """, (name, email, hash_password(password), phone, shop_name))
                conn.commit()
                
                return self.send_json({"message": "Seller created successfully.", "id": cursor.lastrowid}, status=201)

            # 5. CREATE CUSTOMER (Enabled for BOTH Partner & Admin)
            elif path == "/api/customers":
                name = body.get("name", "").strip()
                mobile = body.get("mobile", "").strip()
                shop_name = body.get("shop_name", "").strip()
                address = body.get("address", "").strip()
                city = body.get("city", "").strip()
                gst_number = body.get("gst_number", "").strip().upper()

                if not name:
                    return self.send_error_json("Please enter the customer's name.", 400)
                if not mobile:
                    return self.send_error_json("Please enter the mobile number.", 400)

                partner_id = user["id"] if user["role"] == "PARTNER" else (body.get("partner_id") or user["id"])

                cursor.execute("""
                    INSERT INTO customers (partner_id, name, shop_name, mobile, address, city, gst_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (partner_id, name, shop_name, mobile, address, city, gst_number))
                conn.commit()
                
                new_cust_id = cursor.lastrowid
                created_cust = cursor.execute("SELECT * FROM customers WHERE id = ?", (new_cust_id,)).fetchone()

                return self.send_json({
                    "message": "Customer added successfully.", 
                    "id": new_cust_id,
                    "customer": dict(created_cust)
                }, status=201)

            # 6. CREATE PRODUCT / BATTERY MODEL (Enabled for BOTH Partner & Admin)
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

                cursor.execute("""
                    INSERT INTO products (name, model_code, category, selling_price, gst_rate)
                    VALUES (?, ?, ?, ?, ?)
                """, (name, model_code, category, selling_price, gst_rate))
                conn.commit()

                new_prod_id = cursor.lastrowid
                created_prod = cursor.execute("SELECT * FROM products WHERE id = ?", (new_prod_id,)).fetchone()

                return self.send_json({
                    "message": "Battery product added to catalog successfully.",
                    "id": new_prod_id,
                    "product": dict(created_prod)
                }, status=201)

            # 7. RECORD PAYMENT
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

                cust = cursor.execute("SELECT id FROM customers WHERE id = ? AND partner_id = ?", (customer_id, partner_id)).fetchone()
                if not cust and user["role"] == "PARTNER":
                    return self.send_error_json("Customer not found or unauthorized.", 403)

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

            # 8. CREATE NEW BILL / INVOICE
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

                cust = cursor.execute("SELECT id FROM customers WHERE id = ? AND partner_id = ?", (customer_id, partner_id)).fetchone()
                if not cust and user["role"] == "PARTNER":
                    return self.send_error_json("Customer not found or unauthorized.", 403)

                if client_nonce:
                    existing_inv = cursor.execute("SELECT id, invoice_number FROM invoices WHERE client_nonce = ?", (client_nonce,)).fetchone()
                    if existing_inv:
                        return self.send_json({
                            "message": "Bill already created.",
                            "id": existing_inv["id"],
                            "invoice_number": existing_inv["invoice_number"]
                        })

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

                    line_base = (unit_price * qty) - disc;
                    line_gst = line_base * (gst_rate / 100.0)
                    line_total = line_base + line_gst

                    taxable_amount += line_base
                    discount_amount += disc
                    gst_amount += line_gst
                    grand_total += line_total

                    processed_items.append({
                        "product_id": prod["id"],
                        "product_name_snapshot": prod["name"],
                        "model_code_snapshot": prod["model_code"],
                        "battery_code": item.get("battery_code"),
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
                else: # PARTIALLY_PAID
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
            # ADMIN APPROVAL / REJECTION / SUSPENSION OF PARTNERS
            if path.startswith("/api/admin/sellers/") and path.endswith("/status"):
                if user["role"] != "ADMIN":
                    return self.send_error_json("Forbidden: Admin access required", 403)
                
                parts = path.split("/")
                target_seller_id = parts[-2]

                action = body.get("action", "").upper()
                rejection_reason = body.get("rejection_reason", "").strip()

                if action not in ["APPROVE", "REJECT", "SUSPEND", "ACTIVATE"]:
                    return self.send_error_json("Invalid action specified.", 400)

                target = cursor.execute("SELECT id, name, email FROM users WHERE id = ? AND role = 'PARTNER'", (target_seller_id,)).fetchone()
                if not target:
                    return self.send_error_json("Partner account not found.", 404)

                new_status = "ACTIVE" if action in ["APPROVE", "ACTIVATE"] else ("REJECTED" if action == "REJECT" else "SUSPENDED")

                cursor.execute("""
                    UPDATE users
                    SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (new_status, rejection_reason if action == "REJECT" else None, target_seller_id))
                conn.commit()

                return self.send_json({
                    "message": f"Partner account '{target['name']}' updated to {new_status}.",
                    "status": new_status,
                    "partner_id": target["id"]
                })

            elif path.startswith("/api/customers/"):
                cust_id = path.split("/")[-1]
                
                if user["role"] == "PARTNER":
                    cust = cursor.execute("SELECT id FROM customers WHERE id = ? AND partner_id = ?", (cust_id, user["id"])).fetchone()
                    if not cust:
                        return self.send_error_json("Customer not found or unauthorized", 403)

                name = body.get("name", "").strip()
                mobile = body.get("mobile", "").strip()
                shop_name = body.get("shop_name", "").strip()
                address = body.get("address", "").strip()
                city = body.get("city", "").strip()
                gst_number = body.get("gst_number", "").strip().upper()

                cursor.execute("""
                    UPDATE customers
                    SET name = ?, shop_name = ?, mobile = ?, address = ?, city = ?, gst_number = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (name, shop_name, mobile, address, city, gst_number, cust_id))
                conn.commit()

                return self.send_json({"message": "Customer updated successfully."})

            elif path.startswith("/api/products/"):
                prod_id = path.split("/")[-1]
                name = body.get("name", "").strip()
                model_code = body.get("model_code", "").strip().upper()
                selling_price = float(body.get("selling_price", 0.0))
                gst_rate = float(body.get("gst_rate", 18.0))

                cursor.execute("""
                    UPDATE products
                    SET name = ?, model_code = ?, selling_price = ?, gst_rate = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (name, model_code, selling_price, gst_rate, prod_id))
                conn.commit()

                return self.send_json({"message": "Product updated successfully."})

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
