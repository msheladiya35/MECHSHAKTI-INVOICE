import urllib.request
import urllib.parse
import json
import sys
import subprocess
import time
import os

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")

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

def run_tests():
    print("=" * 60)
    print("RUNNING STRICT PARTNER DATA ISOLATION & API SECURITY TESTS")
    print("=" * 60)

    # 1. Login Admin
    status, res = request("/api/auth/login", "POST", {"email": "admin@mechshakti.com", "password": "admin123"})
    assert status == 200, f"Admin login failed: {res}"
    admin_token = res["token"]
    print("✔ Admin login successful.")

    # 2. Login Seller 1 & Seller 2
    status, res1 = request("/api/auth/login", "POST", {"email": "seller1@mechshakti.com", "password": "seller123"})
    assert status == 200, f"Seller 1 login failed: {res1}"
    seller1_token = res1["token"]
    s1_user = res1["user"]
    print("✔ Seller 1 login successful.")

    status, res2 = request("/api/auth/login", "POST", {"email": "seller2@mechshakti.com", "password": "seller123"})
    assert status == 200, f"Seller 2 login failed: {res2}"
    seller2_token = res2["token"]
    s2_user = res2["user"]
    print("✔ Seller 2 login successful.")

    # 3. Seller 1 Creates Customer A
    status, cust_a = request("/api/customers", "POST", {
        "name": "ABC Auto Garage",
        "shop_name": "ABC Auto Workshop",
        "mobile": "9898012345",
        "city": "Ahmedabad"
    }, token=seller1_token)
    assert status == 201, f"Seller 1 create customer failed: {cust_a}"
    cust_a_id = cust_a["id"]
    print(f"✔ Seller 1 created Customer A (ID: {cust_a_id}).")

    # 4. Seller 2 Creates Customer B
    status, cust_b = request("/api/customers", "POST", {
        "name": "XYZ Motors",
        "shop_name": "XYZ Garage",
        "mobile": "9797012345",
        "city": "Surat"
    }, token=seller2_token)
    assert status == 201, f"Seller 2 create customer failed: {cust_b}"
    cust_b_id = cust_b["id"]
    print(f"✔ Seller 2 created Customer B (ID: {cust_b_id}).")

    # 5. ISOLATION TEST: Seller 1 tries to fetch Seller 2's Customer B
    status, res = request(f"/api/customers/{cust_b_id}", "GET", token=seller1_token)
    assert status in (403, 404), f"DATA LEAKAGE FAILURE! Seller 1 was able to read Seller 2 Customer: status {status}, res {res}"
    print("✔ ISOLATION PASSED: Seller 1 CANNOT view Seller 2 Customer B.")

    # 6. ISOLATION TEST: Seller 1 tries to edit Seller 2's Customer B
    status, res = request(f"/api/customers/{cust_b_id}", "PUT", {"name": "Hacked Garage"}, token=seller1_token)
    assert status in (403, 404), f"UNAUTHORIZED MUTATION FAILURE! Seller 1 was able to edit Seller 2 Customer: {res}"
    print("✔ ISOLATION PASSED: Seller 1 CANNOT edit Seller 2 Customer B.")

    # 7. Fetch Products
    status, prods = request("/api/products", "GET", token=seller1_token)
    assert status == 200 and len(prods) > 0, "Fetch products failed"
    p1 = prods[0]
    p2 = prods[1]
    print(f"✔ Loaded battery product catalog ({len(prods)} models).")

    # 7a. ISOLATION TEST: Seller 1 cannot create a bill or payment for Seller 2's customer
    status, res = request("/api/invoices", "POST", {
        "customer_id": cust_b_id,
        "items": [{"product_id": p1["id"], "quantity": 1, "unit_price": p1["selling_price"]}]
    }, token=seller1_token)
    assert status == 403, f"UNAUTHORIZED BILLING FAILURE! Seller 1 billed Seller 2's customer: {res}"

    status, res = request("/api/payments", "POST", {
        "customer_id": cust_b_id,
        "amount": 1.0,
        "payment_method": "CASH"
    }, token=seller1_token)
    assert status == 403, f"UNAUTHORIZED PAYMENT FAILURE! Seller 1 recorded payment for Seller 2's customer: {res}"
    print("✔ ISOLATION PASSED: Seller 1 CANNOT bill or record payments for Seller 2 Customer B.")

    # 8. Seller 1 Creates Invoice for Customer A
    status, inv_a = request("/api/invoices", "POST", {
        "customer_id": cust_a_id,
        "items": [
            {"product_id": p1["id"], "quantity": 3, "unit_price": p1["selling_price"], "discount": 100},
            {"product_id": p2["id"], "quantity": 2, "unit_price": p2["selling_price"], "discount": 0}
        ]
    }, token=seller1_token)
    assert status == 201, f"Seller 1 create invoice failed: {inv_a}"
    inv_a_id = inv_a["id"]
    print(f"✔ Seller 1 created Invoice #{inv_a['invoice_number']} for Customer A.")

    # 9. ISOLATION TEST: Seller 2 tries to read Seller 1's Invoice
    status, res = request(f"/api/invoices/{inv_a_id}", "GET", token=seller2_token)
    assert status in (403, 404), f"DATA LEAKAGE FAILURE! Seller 2 was able to read Seller 1 Invoice: {res}"
    print("✔ ISOLATION PASSED: Seller 2 CANNOT view Seller 1 Invoice.")

    # 10. ISOLATION TEST: Seller 2 queries sales report (Must return 0 batteries from Seller 1)
    status, rep2 = request("/api/reports/dashboard?preset=this_month", "GET", token=seller2_token)
    assert status == 200
    assert rep2["total_batteries"] == 0, f"DATA LEAKAGE FAILURE! Seller 2 report includes Seller 1 sales: {rep2}"
    print("✔ ISOLATION PASSED: Seller 2 report shows 0 batteries from Seller 1.")

    # 11. Admin Report Verification (Must show all sellers and hierarchical drilldown)
    status, admin_rep = request("/api/reports/hierarchical?preset=this_month", "GET", token=admin_token)
    assert status == 200
    assert len(admin_rep) > 0, "Admin report returned empty tree"
    print("✔ ADMIN REPORT PASSED: Admin can view multi-seller hierarchical drilldown.")

    print("=" * 60)
    print("ALL SECURITY, DATA ISOLATION & REPORTING TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
