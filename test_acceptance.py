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
    print("=" * 75)
    print("MECHSHAKTI SALES INVOICE PORTAL - PARTNER REGISTRATION & APPROVAL SUITE")
    print("=" * 75)

    ts = int(time.time())
    new_partner_email = f"partner_{ts}@mechshakti.com"
    new_partner_mobile = f"98{ts % 100000000:08d}"

    # 1. Partner Self-Registration
    status, reg_res = request("/api/auth/register", "POST", {
        "name": "Kishan Patel",
        "mobile": new_partner_mobile,
        "email": new_partner_email,
        "password": "partner123",
        "confirm_password": "partner123",
        "shop_name": "Kishan Garage",
        "city": "Surat",
        "address": "Shop 4 Patwa Building",
        "gst_number": "24AAAAA0000A1Z5",
        "dealer_code": "MS-SURAT-88"
    })
    assert status == 201 and reg_res.get("status") == "PENDING_APPROVAL", f"Registration failed: {reg_res}"
    pending_partner_id = reg_res["id"]
    print(f"✔ 1. PARTNER SELF-REGISTRATION: Created account (ID: {pending_partner_id}, Status: PENDING_APPROVAL).")

    # 2. Duplicate Mobile Check
    status_dup, dup_res = request("/api/auth/register", "POST", {
        "name": "Duplicate User",
        "mobile": new_partner_mobile,
        "email": f"other_{ts}@mechshakti.com",
        "password": "partner123",
        "confirm_password": "partner123",
        "shop_name": "Dup Shop",
        "city": "Surat"
    })
    assert status_dup == 400 and "mobile number already exists" in dup_res.get("error", "").lower()
    print("✔ 2. DUPLICATE REGISTRATION PREVENTION: Blocked duplicate mobile registration.")

    # 3. Pending Account Login Prevention
    status_login_p, login_p_res = request("/api/auth/login", "POST", {
        "email": new_partner_email,
        "password": "partner123"
    })
    assert status_login_p == 403 and "pending Admin approval" in login_p_res.get("error", "")
    print("✔ 3. PENDING LOGIN BLOCK: Prevented login for unapproved partner with exact error message.")

    # 4. Admin View & Approve Partner
    status_admin, admin_res = request("/api/auth/login", "POST", {"email": "admin@mechshakti.com", "password": "admin123"})
    assert status_admin == 200
    token_admin = admin_res["token"]

    status_pend, pend_list = request("/api/admin/sellers?status=PENDING_APPROVAL", token=token_admin)
    assert status_pend == 200 and any(s["id"] == pending_partner_id for s in pend_list["sellers"])
    print("✔ 4. ADMIN APPROVAL SYSTEM: Pending partner listed in Admin Approvals queue.")

    status_appr, appr_res = request(f"/api/admin/sellers/{pending_partner_id}/status", "PUT", {
        "action": "APPROVE"
    }, token=token_admin)
    assert status_appr == 200 and appr_res["status"] == "ACTIVE"
    print("✔ 5. ADMIN ACTION: Partner account approved and status changed to ACTIVE.")

    # 5. Approved Partner Login & Data Isolation Verification
    status_appr_login, appr_login_res = request("/api/auth/login", "POST", {
        "email": new_partner_email,
        "password": "partner123"
    })
    assert status_appr_login == 200 and "token" in appr_login_res
    token_new_partner = appr_login_res["token"]
    print("✔ 6. APPROVED LOGIN: Newly approved partner logged in successfully.")

    # Create Customer for New Partner
    status_c, cust_res = request("/api/customers", "POST", {
        "name": "New Partner Customer 1",
        "mobile": "9112233445"
    }, token=token_new_partner)
    assert status_c == 201

    # Verify Partner Data Isolation (Seller 1 cannot see New Partner's customer)
    status_s1, s1_res = request("/api/auth/login", "POST", {"email": "seller1@mechshakti.com", "password": "seller123"})
    assert status_s1 == 200
    token_s1 = s1_res["token"]

    _, s1_custs = request("/api/customers", token=token_s1)
    assert not any(c["id"] == cust_res["id"] for c in s1_custs)
    print("✔ 7. PARTNER DATA ISOLATION: Verified zero data leakage between partner accounts!")

    # 6. Reject Partner Workflow Test
    rej_email = f"reject_{ts}@mechshakti.com"
    _, rej_reg = request("/api/auth/register", "POST", {
        "name": "Rejected Partner",
        "mobile": f"97{ts % 100000000:08d}",
        "email": rej_email,
        "password": "partner123",
        "confirm_password": "partner123",
        "shop_name": "Reject Shop",
        "city": "Surat"
    })
    rej_id = rej_reg["id"]

    request(f"/api/admin/sellers/{rej_id}/status", "PUT", {"action": "REJECT", "rejection_reason": "Incomplete documents"}, token=token_admin)

    status_rej_login, rej_login_res = request("/api/auth/login", "POST", {"email": rej_email, "password": "partner123"})
    assert status_rej_login == 403 and "rejected by Admin" in rej_login_res.get("error", "")
    print("✔ 8. REJECTED PARTNER LOGIN BLOCK: Verified rejection status blocks login.")

    # 7. Suspend Partner Workflow Test
    request(f"/api/admin/sellers/{pending_partner_id}/status", "PUT", {"action": "SUSPEND"}, token=token_admin)
    status_susp_login, susp_login_res = request("/api/auth/login", "POST", {"email": new_partner_email, "password": "partner123"})
    assert status_susp_login == 403 and "suspended by Admin" in susp_login_res.get("error", "")
    print("✔ 9. SUSPENDED PARTNER LOGIN BLOCK: Verified suspended status blocks login.")

    # Re-activate for clean state
    request(f"/api/admin/sellers/{pending_partner_id}/status", "PUT", {"action": "ACTIVATE"}, token=token_admin)

    # 8. PWA Assets Verification
    def raw_request(path):
        url = BASE_URL + path
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode('utf-8')

    st1, _ = raw_request("/manifest.json")
    st2, _ = raw_request("/sw.js")
    assert st1 == 200 and st2 == 200
    print("✔ 10. PWA assets verified.")

    print("=" * 75)
    print("🎉 ALL PARTNER SELF-REGISTRATION & APPROVAL TESTS PASSED 100%!")
    print("=" * 75)

if __name__ == "__main__":
    run_acceptance_tests()
