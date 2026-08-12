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

    # 3. New Partner A & B Registration & Login
    email_a = f"seller_a_{ts}@mechshakti.com"
    mobile_a = f"98{ts % 100000008:08d}"
    st_reg_a, reg_a = request("/api/auth/register", "POST", {
        "name": "Seller A Garage", "mobile": mobile_a, "email": email_a,
        "password": "sellerpass123", "confirm_password": "sellerpass123",
        "shop_name": "Garage A", "city": "Surat"
    })
    assert st_reg_a == 201
    seller_a_id = reg_a["id"]
    request(f"/api/admin/sellers/{seller_a_id}/status", "PUT", {"action": "APPROVE"}, token=token_admin)
    _, seller_a_login = request("/api/auth/login", "POST", {"email": email_a, "password": "sellerpass123"})
    token_seller_a = seller_a_login["token"]

    email_b = f"seller_b_{ts}@mechshakti.com"
    mobile_b = f"97{ts % 100000008:08d}"
    st_reg_b, reg_b = request("/api/auth/register", "POST", {
        "name": "Seller B Garage", "mobile": mobile_b, "email": email_b,
        "password": "sellerpass123", "confirm_password": "sellerpass123",
        "shop_name": "Garage B", "city": "Surat"
    })
    assert st_reg_b == 201
    seller_b_id = reg_b["id"]
    request(f"/api/admin/sellers/{seller_b_id}/status", "PUT", {"action": "APPROVE"}, token=token_admin)
    _, seller_b_login = request("/api/auth/login", "POST", {"email": email_b, "password": "sellerpass123"})
    token_seller_b = seller_b_login["token"]
    print(f"✔ 4. SELLER PROVISIONING: Registered and approved Seller A (#{seller_a_id}) and Seller B (#{seller_b_id}).")

    # 4. ADMIN MASTER PRODUCT CREATION (MSX5, MSX7, MSX9)
    st_m1, m1_res = request("/api/admin/products", "POST", {
        "name": "Mechshakti MSX5", "model_code": f"MSX5-{ts}", "category": "BATTERY",
        "mrp": 4500.0, "selling_price": 3800.0, "warranty_months": 36, "battery_serial_required": True
    }, token=token_admin)
    assert st_m1 == 201
    master_prod_id = m1_res["id"]
    print("✔ 5. ADMIN MASTER PRODUCTS: Created Admin Master product Mechshakti MSX5.")

    # 5. VERIFY SELLER A & SELLER B BOTH SEE MASTER PRODUCT
    _, prods_a = request("/api/products", token=token_seller_a)
    _, prods_b = request("/api/products", token=token_seller_b)
    has_msx5_a = any(p["id"] == master_prod_id for p in prods_a)
    has_msx5_b = any(p["id"] == master_prod_id for p in prods_b)
    assert has_msx5_a and has_msx5_b
    print("✔ 6. MASTER PRODUCT SCOPING: Admin Master Product is automatically visible to ALL sellers.")

    # 6. SELLER A CREATES CUSTOM PRODUCT ("Castrol Oil 1L")
    st_c_a, cust_prod_a = request("/api/products/custom", "POST", {
        "name": "Castrol Oil 1L", "selling_price": 450.0, "mrp": 500.0
    }, token=token_seller_a)
    assert st_c_a == 201
    custom_prod_a_id = cust_prod_a["id"]

    # VERIFY SELLER A SEES CUSTOM PRODUCT, SELLER B DOES NOT
    _, prods_a_after = request("/api/products", token=token_seller_a)
    _, prods_b_after = request("/api/products", token=token_seller_b)
    assert any(p["id"] == custom_prod_a_id for p in prods_a_after)
    assert not any(p["id"] == custom_prod_a_id for p in prods_b_after)
    print("✔ 7. SELLER CUSTOM PRODUCT SCOPING: Custom product 'Castrol Oil 1L' visible ONLY to Seller A, hidden from Seller B.")

    # 7. SECURITY AUDIT: SELLER CANNOT EDIT ADMIN MASTER PRODUCT
    st_edit_m, _ = request(f"/api/admin/products/{master_prod_id}", "PUT", {
        "name": "Hacked MSX5 Name", "selling_price": 1.0
    }, token=token_seller_a)
    assert st_edit_m == 403
    print("✔ 8. ROLE AUTHORIZATION (RBAC): Seller rejected with 403 Forbidden when attempting to edit Admin Master Product.")

    # 8. Create Customer & Invoice
    st_cust, cust_res = request("/api/customers", "POST", {
        "name": "Rajesh Garage", "mobile": "9898765432", "shop_name": "Rajesh Motors", "city": "Surat"
    }, token=token_seller_a)
    assert st_cust == 201
    cust_id = cust_res["id"]

    serial_code = f"MS01{ts % 10000:04d}0099"
    st_inv, inv_res = request("/api/invoices", "POST", {
        "customer_id": cust_id, "invoice_date": "2026-08-12", "payment_mode": "PARTIAL",
        "payment_method": "UPI", "paid_amount": 1000.0,
        "items": [{
            "product_id": master_prod_id, "quantity": 1, "unit_price": 3800.0,
            "discount": 0.0, "battery_code": serial_code
        }]
    }, token=token_seller_a)
    assert st_inv == 201
    inv_id = inv_res["id"]
    inv_num = inv_res["invoice_number"]

    # 9. AUTO WARRANTY ACTIVATION CHECK
    st_w, w_res = request(f"/api/warranty/check?code={serial_code}")
    assert st_w == 200 and w_res["found"] is True and w_res["warranty"]["status"] == "VALID"
    print("✔ 9. AUTO WARRANTY ACTIVATION: Battery serial verified VALID in public warranty portal.")

    # 10. KHATABOOK LEDGER CHECK
    st_ledg, ledg_res = request(f"/api/customers/{cust_id}/ledger", token=token_seller_a)
    assert st_ledg == 200 and ledg_res["total_billed"] == 3800.0 and ledg_res["outstanding_balance"] == 2800.0
    print("✔ 10. KHATABOOK LEDGER: Verified customer balance (Billed: ₹3800, Paid: ₹1000, Outstanding: ₹2800).")

    # 11. SOFT DELETE / DEACTIVATION PROTECTION CHECK
    st_del, del_res = request(f"/api/admin/products/{master_prod_id}", "DELETE", token=token_admin)
    assert st_del == 200 and del_res.get("status") == "INACTIVE"
    print("✔ 11. HISTORICAL DATA PROTECTION: Product referenced in invoice was safely toggled to INACTIVE without data deletion.")

    print("=" * 80)
    print("🎉 ALL ACCEPTANCE TESTS PASSED 100%!")
    print("=" * 80)

if __name__ == "__main__":
    run_acceptance_tests()
