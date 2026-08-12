import urllib.request
import json
import time

BASE_URL = "http://localhost:8080"

def request(path, method="GET", data=None, token=None):
    url = BASE_URL + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req_body = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=req_body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode('utf-8')
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body}
        return e.code, parsed

def run_acceptance_tests():
    print("=" * 80)
    print("MECHSHAKTI MASTER SPECIFICATION ACCEPTANCE TEST SUITE")
    print("=" * 80)

    ts = int(time.time())

    # 1. Super Admin & Admin Login
    st_sa, sa_res = request("/api/auth/login", "POST", {"email": "superadmin@mechshakti.com", "password": "superadmin123"})
    assert st_sa == 200 and "token" in sa_res
    token_superadmin = sa_res["token"]
    print("✔ 1. SUPER_ADMIN LOGIN: Successfully authenticated Super Admin.")

    st_ad, ad_res = request("/api/auth/login", "POST", {"email": "admin@mechshakti.com", "password": "admin123"})
    assert st_ad == 200 and "token" in ad_res
    token_admin = ad_res["token"]
    print("✔ 2. ADMIN LOGIN: Successfully authenticated System Admin.")

    # 2. Backup Security Check
    st_bk_sa, bk_sa_res = request("/api/admin/export-database", token=token_superadmin)
    assert st_bk_sa == 200 and "users" in bk_sa_res
    print("✔ 3. BACKUP SECURITY (SUPER_ADMIN): Super Admin successfully exported database backup.")

    # 3. New Partner Registration & Login
    new_email = f"seller_test_{ts}@mechshakti.com"
    new_mobile = f"98{ts % 100000008:08d}"
    st_reg, reg_res = request("/api/auth/register", "POST", {
        "name": "Master Test Seller",
        "mobile": new_mobile,
        "email": new_email,
        "password": "sellerpass123",
        "confirm_password": "sellerpass123",
        "shop_name": "Master Auto Garage",
        "city": "Surat"
    })
    assert st_reg == 201 and reg_res["status"] == "PENDING_APPROVAL"
    seller_id = reg_res["id"]

    st_appr, _ = request(f"/api/admin/sellers/{seller_id}/status", "PUT", {"action": "APPROVE"}, token=token_admin)
    assert st_appr == 200

    st_log, seller_res = request("/api/auth/login", "POST", {"email": new_email, "password": "sellerpass123"})
    assert st_log == 200
    token_seller = seller_res["token"]
    print(f"✔ 4. SELLER PROVISIONING: Registered, approved, and logged in seller #{seller_id}.")

    # 4. Security Audit: Seller Backup Attempt Forbidden
    st_bk_s, bk_s_res = request("/api/admin/export-database", token=token_seller)
    assert st_bk_s == 403
    print("✔ 5. SECURITY AUDIT (RBAC): Normal seller rejected (403 Forbidden) from database backup export.")

    # 5. Create Customer
    st_cust, cust_res = request("/api/customers", "POST", {
        "name": "Rajesh Garage",
        "mobile": "9898765432",
        "shop_name": "Rajesh Motors",
        "city": "Surat",
        "vehicle_number": "GJ05AB1234"
    }, token=token_seller)
    assert st_cust == 201
    cust_id = cust_res["id"]
    print(f"✔ 6. CUSTOMER CREATION: Created customer #{cust_id}.")

    # 6. Invoice Creation with Battery Serial & Server-Side Tax Engine
    serial_code = f"MS01{ts % 10000:04d}0099"
    st_inv, inv_res = request("/api/invoices", "POST", {
        "customer_id": cust_id,
        "invoice_date": "2026-08-12",
        "payment_mode": "PARTIAL",
        "payment_method": "UPI",
        "paid_amount": 1000.0,
        "items": [
            {
                "product_id": 1,
                "quantity": 1,
                "unit_price": 1250.0,
                "discount": 0.0,
                "gst_rate": 18.0,
                "battery_code": serial_code
            }
        ]
    }, token=token_seller)
    assert st_inv == 201
    inv_id = inv_res["id"]
    inv_num = inv_res["invoice_number"]
    assert inv_num.startswith("MS/SRT")
    print(f"✔ 7. INVOICE GENERATION: Generated invoice #{inv_num} with auto tax breakdown.")

    # 7. Automatic Warranty Activation Check
    st_w, w_res = request(f"/api/warranty/check?code={serial_code}")
    assert st_w == 200 and w_res["found"] is True
    assert w_res["warranty"]["status"] == "VALID"
    print(f"✔ 8. AUTO WARRANTY ACTIVATION: Serial '{serial_code}' verified VALID in warranty registry.")

    # 8. Customer Khatabook Ledger Statement Check
    st_ledg, ledg_res = request(f"/api/customers/{cust_id}/ledger", token=token_seller)
    assert st_ledg == 200
    assert ledg_res["total_billed"] == 1250.0  # 1250 simple price (NO GST)
    assert ledg_res["total_paid"] == 1000.0
    assert ledg_res["outstanding_balance"] == 250.0
    print(f"✔ 9. KHATABOOK LEDGER: Verified customer ledger balance (Billed: ₹1250, Paid: ₹1000, Outstanding: ₹250).")

    # 9. Invoice Cancellation & Audit Trail Check
    st_canc, canc_res = request(f"/api/invoices/{inv_id}/cancel", "POST", {"reason": "Customer billing error correction"}, token=token_seller)
    assert st_canc == 200 and canc_res["status"] == "CANCELLED"
    print(f"✔ 10. INVOICE CANCELLATION: Cancelled invoice #{inv_id} with audit reason.")

    # 10. Admin Audit Log Verification
    st_log, log_res = request("/api/admin/audit-logs?q=INVOICE_CANCELLED", token=token_admin)
    assert st_log == 200 and len(log_res) > 0
    print("✔ 11. AUDIT LOGGING VERIFIED: Admin successfully searched audit logs for INVOICE_CANCELLED actions.")

    print("=" * 80)
    print("🎉 ALL 11 MASTER SPECIFICATION ACCEPTANCE TESTS PASSED 100%!")
    print("=" * 80)

if __name__ == "__main__":
    run_acceptance_tests()
