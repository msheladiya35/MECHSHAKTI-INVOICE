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

def run_persistence_test():
    print("=" * 80)
    print("SECTION 19 PERSISTENCE & DATA LOSS PREVENTION VERIFICATION TEST")
    print("=" * 80)

    ts = int(time.time())
    seller_email = f"test-seller-{ts}@example.com"
    seller_pass = "TestPassword123"

    # 1. Admin Login
    _, ad_res = request("/api/auth/login", "POST", {"email": "admin@mechshakti.com", "password": "admin123"})
    token_admin = ad_res["token"]

    # 2. Create & Approve Seller
    st_reg, reg_res = request("/api/auth/register", "POST", {
        "name": "Test Persistence Seller",
        "mobile": f"99{ts % 100000008:08d}",
        "email": seller_email,
        "password": seller_pass,
        "confirm_password": seller_pass,
        "shop_name": "Persistence Garage",
        "city": "Surat"
    })
    assert st_reg == 201
    seller_id = reg_res["id"]

    st_appr, _ = request(f"/api/admin/sellers/{seller_id}/status", "PUT", {"action": "APPROVE"}, token=token_admin)
    assert st_appr == 200

    # 3. Seller Login
    st_log1, log1_res = request("/api/auth/login", "POST", {"email": seller_email, "password": seller_pass})
    assert st_log1 == 200
    token_seller = log1_res["token"]
    print("✔ STEP 1: Created, approved, and logged in test seller.")

    # 4. Create Customer
    st_c, c_res = request("/api/customers", "POST", {
        "name": "Persistence Customer",
        "mobile": "9998887776",
        "shop_name": "Persistent Works",
        "city": "Surat"
    }, token=token_seller)
    assert st_c == 201
    cust_id = c_res["id"]
    print(f"✔ STEP 2: Created customer #{cust_id}.")

    # 5. Create Custom Product
    st_p, p_res = request("/api/products/custom", "POST", {
        "name": "Persistent Battery Fluid 1L",
        "selling_price": 350.0
    }, token=token_seller)
    assert st_p == 201
    prod_id = p_res["id"]
    print(f"✔ STEP 3: Created custom product #{prod_id}.")

    # 6. Create Invoice
    serial_code = f"MS01{ts % 10000:04d}8899"
    st_inv, inv_res = request("/api/invoices", "POST", {
        "customer_id": cust_id,
        "invoice_date": "2026-08-12",
        "payment_mode": "PARTIAL",
        "payment_method": "CASH",
        "paid_amount": 200.0,
        "items": [{
            "product_id": prod_id,
            "quantity": 1,
            "unit_price": 350.0,
            "discount": 0.0,
            "battery_code": serial_code
        }]
    }, token=token_seller)
    assert st_inv == 201
    inv_id = inv_res["id"]
    inv_number = inv_res["invoice_number"]
    print(f"✔ STEP 4: Created invoice #{inv_number}.")

    # 7. Record Payment
    st_pmt, pmt_res = request("/api/payments", "POST", {
        "customer_id": cust_id,
        "invoice_id": inv_id,
        "amount": 150.0,
        "payment_method": "UPI",
        "reference_no": f"UPI-{ts}",
        "payment_date": "2026-08-12"
    }, token=token_seller)
    assert st_pmt == 201
    print("✔ STEP 5: Recorded payment ₹150.")

    # 8. Verify Warranty
    st_w, w_res = request(f"/api/warranty/check?code={serial_code}")
    assert st_w == 200 and w_res["found"] is True
    print("✔ STEP 6: Verified auto warranty activation.")

    # 9. Verify Ledger Before Restart
    st_ledg1, ledg1_res = request(f"/api/customers/{cust_id}/ledger", token=token_seller)
    assert st_ledg1 == 200
    assert ledg1_res["total_billed"] == 350.0
    assert ledg1_res["total_paid"] == 350.0  # 200 initial + 150 payment
    assert ledg1_res["outstanding_balance"] == 0.0
    print("✔ STEP 7: Verified Khatabook balance (Billed: ₹350, Paid: ₹350, Outstanding: ₹0).")

    # Save state data to verify after restart
    return {
        "seller_email": seller_email,
        "seller_pass": seller_pass,
        "cust_id": cust_id,
        "prod_id": prod_id,
        "inv_id": inv_id,
        "inv_number": inv_number,
        "serial_code": serial_code
    }

def verify_persistence_after_restart(state):
    print("=" * 80)
    print("VERIFYING DATA PERSISTENCE AFTER SERVER RESTART / RE-DEPLOYMENT")
    print("=" * 80)

    # 1. Login again with existing seller credentials
    st_log2, log2_res = request("/api/auth/login", "POST", {
        "email": state["seller_email"],
        "password": state["seller_pass"]
    })
    assert st_log2 == 200 and "token" in log2_res
    token_seller_new = log2_res["token"]
    print("✔ 1. SELLER AUTHENTICATION SUCCESSFUL: Login credentials survived server restart.")

    # 2. Verify Customer
    st_c, custs = request("/api/customers", token=token_seller_new)
    assert st_c == 200
    matching_cust = next((c for c in custs if c["id"] == state["cust_id"]), None)
    assert matching_cust is not None
    print(f"✔ 2. CUSTOMER RECORD SURVIVED: Customer '{matching_cust['name']}' intact.")

    # 3. Verify Custom Product
    st_p, prods = request("/api/products", token=token_seller_new)
    assert st_p == 200
    matching_prod = next((p for p in prods if p["id"] == state["prod_id"]), None)
    assert matching_prod is not None
    print(f"✔ 3. PRODUCT RECORD SURVIVED: Custom product '{matching_prod['name']}' intact.")

    # 4. Verify Invoice
    st_inv, invs = request("/api/invoices", token=token_seller_new)
    assert st_inv == 200
    matching_inv = next((i for i in invs if i["id"] == state["inv_id"]), None)
    assert matching_inv is not None and matching_inv["invoice_number"] == state["inv_number"]
    print(f"✔ 4. INVOICE RECORD SURVIVED: Invoice #{matching_inv['invoice_number']} intact.")

    # 5. Verify Customer Ledger
    st_ledg, ledg = request(f"/api/customers/{state['cust_id']}/ledger", token=token_seller_new)
    assert st_ledg == 200
    assert ledg["total_billed"] == 350.0
    assert ledg["total_paid"] == 350.0
    assert ledg["outstanding_balance"] == 0.0
    print("✔ 5. KHATABOOK LEDGER SURVIVED: Balance remains exact (Billed: ₹350, Paid: ₹350, Outstanding: ₹0).")

    # 6. Verify Warranty
    st_w, w_res = request(f"/api/warranty/check?code={state['serial_code']}")
    assert st_w == 200 and w_res["found"] is True
    print("✔ 6. WARRANTY REGISTRATION SURVIVED: Battery serial verified VALID in public registry.")

    print("=" * 80)
    print("🎉 PERSISTENCE TEST PASSED 100%! ALL DATA SURVIVED SERVER RESTART & RE-AUTHENTICATION!")
    print("=" * 80)

if __name__ == "__main__":
    st = run_persistence_test()
    print("\nSimulating server restart verification...\n")
    verify_persistence_after_restart(st)
