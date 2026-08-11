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
    print("MECHSHAKTI SALES INVOICE PORTAL - NEW PARTNER DATA ISOLATION TEST")
    print("=" * 80)

    ts = int(time.time())
    new_email = f"newpartner{ts}@mechshakti.com"
    new_mobile = f"99{ts % 100000000:08d}"

    # 1. New Partner Registration
    st_reg, reg_res = request("/api/auth/register", "POST", {
        "name": "New Test Partner",
        "mobile": new_mobile,
        "email": new_email,
        "password": "partnerpass123",
        "confirm_password": "partnerpass123",
        "shop_name": "New Auto Garage",
        "city": "Surat"
    })
    assert st_reg == 201 and reg_res["status"] == "PENDING_APPROVAL"
    new_partner_id = reg_res["id"]
    print(f"✔ 1. SELF REGISTRATION: New partner registered (ID {new_partner_id}).")

    # 2. Admin Login & Approval
    _, admin_res = request("/api/auth/login", "POST", {"email": "admin@mechshakti.com", "password": "admin123"})
    token_admin = admin_res["token"]

    st_appr, _ = request(f"/api/admin/sellers/{new_partner_id}/status", "PUT", {"action": "APPROVE"}, token=token_admin)
    assert st_appr == 200
    print("✔ 2. ADMIN APPROVAL: Admin approved new partner account.")

    # 3. New Partner Login
    st_log, partner_res = request("/api/auth/login", "POST", {"email": new_email, "password": "partnerpass123"})
    assert st_log == 200 and "token" in partner_res
    token_new = partner_res["token"]
    print("✔ 3. NEW PARTNER LOGIN: Successfully logged into new partner account.")

    # 4. Verify ZERO Data Isolation Constraints (Section 1 & User Request)
    st_c, new_custs = request("/api/customers", token=token_new)
    assert st_c == 200 and len(new_custs) == 0
    print("✔ 4. CUSTOMERS ISOLATION: Exactly 0 customers for new partner.")

    st_inv, new_invs = request("/api/invoices", token=token_new)
    assert st_inv == 200 and len(new_invs) == 0
    print("✔ 5. INVOICES ISOLATION: Exactly 0 invoices for new partner.")

    st_pmt, new_pmts = request("/api/payments", token=token_new)
    assert st_pmt == 200 and len(new_pmts) == 0
    print("✔ 6. PAYMENTS ISOLATION: Exactly 0 payments for new partner.")

    st_dash, dash_res = request("/api/reports/dashboard?preset=today", token=token_new)
    assert st_dash == 200
    assert dash_res["today_sales"] == 0
    assert dash_res["today_collected"] == 0
    assert dash_res["total_outstanding"] == 0
    assert dash_res["today_batteries"] == 0
    print("✔ 7. DASHBOARD ISOLATION: All dashboard statistics are strictly 0.")

    print("=" * 80)
    print("🎉 NEW PARTNER DATA ISOLATION VERIFIED 100%! ZERO DUMMY DATA OR CROSS-PARTNER DATA EXPOSURE!")
    print("=" * 80)

if __name__ == "__main__":
    run_acceptance_tests()
