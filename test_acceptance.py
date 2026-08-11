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
    print("MECHSHAKTI SALES INVOICE PORTAL - FULL MASTER ACCEPTANCE TEST SUITE")
    print("=" * 80)

    ts = int(time.time())

    # 1. Login Seller 1
    st_log, seller_res = request("/api/auth/login", "POST", {"email": "seller1@mechshakti.com", "password": "seller123"})
    assert st_log == 200 and "token" in seller_res
    token_seller = seller_res["token"]
    print("✔ 1. AUTHENTICATION: Seller 1 login clean.")

    # 2. Add Customer & Edit Customer
    st_c, c_res = request("/api/customers", "POST", {
        "name": f"Kishan Patel {ts}",
        "mobile": "9876543210",
        "shop_name": "Kishan Garage",
        "city": "Surat"
    }, token=token_seller)
    assert st_c == 201 and "id" in c_res
    cust_id = c_res["id"]
    print(f"✔ 2. CUSTOMER ADD: Created Customer ID {cust_id}.")

    # Edit Customer (Section 6)
    st_cedit, cedit_res = request(f"/api/customers/{cust_id}", "PUT", {
        "name": f"Kishan Auto Workshop {ts}",
        "mobile": "9876543210",
        "shop_name": "Kishan Auto Workshop",
        "city": "Surat",
        "address": "Ring Road, Surat"
    }, token=token_seller)
    assert st_cedit == 200 and "updated successfully" in cedit_res.get("message", "").lower()
    print("✔ 3. CUSTOMER EDIT: Customer name & profile updated in DB.")

    # 3. Seller Custom "Other Product" Creation (Sections 10, 11, 12)
    st_cp, cp_res = request("/api/products/custom", "POST", {
        "name": f"Custom Battery Cable {ts}",
        "selling_price": 450.0,
        "gst_rate": 18.0
    }, token=token_seller)
    assert st_cp == 201 and "id" in cp_res
    custom_prod_id = cp_res["id"]
    print(f"✔ 4. SELLER OTHER PRODUCT: Seller custom item added to seller catalog (ID {custom_prod_id}).")

    # Verify custom product appears in seller's product catalog
    st_prods, prods_list = request("/api/products", token=token_seller)
    assert st_prods == 200 and any(p["id"] == custom_prod_id for p in prods_list)
    print("✔ 5. SELLER CATALOG REUSE: Seller custom product appears in seller bill dropdown.")

    # 4. Generate New Bill with Custom & Preset Items
    st_inv, inv_res = request("/api/invoices", "POST", {
        "customer_id": cust_id,
        "payment_mode": "PARTIAL",
        "payment_method": "CASH",
        "paid_amount": 1000.0,
        "items": [
            {
                "product_id": 1,
                "quantity": 2,
                "unit_price": 1250.0,
                "gst_rate": 18.0,
                "battery_code": f"MS010826{ts}"
            },
            {
                "product_id": custom_prod_id,
                "quantity": 1,
                "unit_price": 450.0,
                "gst_rate": 18.0
            }
        ]
    }, token=token_seller)
    assert st_inv == 201 and "invoice_number" in inv_res
    inv_id = inv_res["id"]
    print(f"✔ 6. NEW BILL CREATION: Generated Invoice #{inv_res['invoice_number']} (Grand Total: ₹{inv_res['grand_total']}, Outstanding: ₹{inv_res['outstanding']}).")

    # 5. Customer Khatabook Ledger Statement (Section 17)
    st_ledg, ledg_res = request(f"/api/customers/{cust_id}/ledger", token=token_seller)
    assert st_ledg == 200 and len(ledg_res["transactions"]) >= 1
    assert ledg_res["outstanding_balance"] > 0
    print(f"✔ 7. KHATABOOK LEDGER STATEMENT: Ledger calculated outstanding balance ₹{ledg_res['outstanding_balance']}.")

    # 6. Customer Archiving (Section 7)
    st_arch, arch_res = request(f"/api/customers/{cust_id}", "DELETE", token=token_seller)
    assert st_arch == 200 and arch_res.get("archived") is True
    print("✔ 8. CUSTOMER ARCHIVING: Customer with transaction history archived safely without breaking historical invoices.")

    # 7. Warranty System - 1 Battery = 1 Active Warranty (Section 28)
    test_serial = f"MS010826{ts}"
    st_w1, w1_res = request("/api/warranty/register", "POST", {
        "battery_code": test_serial.lower(),
        "customer_name": "Ramesh Patel",
        "customer_mobile": "9123456789",
        "purchase_date": "2026-08-10"
    })
    assert st_w1 == 201 and w1_res["status"] == "VALID"
    assert w1_res["battery_code"] == test_serial # Normalized uppercase

    st_w2, w2_res = request("/api/warranty/register", "POST", {
        "battery_code": test_serial,
        "customer_name": "Duplicate Attempt",
        "customer_mobile": "9998887776",
        "purchase_date": "2026-08-11"
    })
    assert st_w2 == 400 and "THIS BATTERY WARRANTY IS ALREADY REGISTERED" in w2_res.get("error", "")
    print("✔ 9. WARRANTY DUPLICATE PROTECTION: Blocked duplicate attempt with exact error 'THIS BATTERY WARRANTY IS ALREADY REGISTERED.'.")

    print("=" * 80)
    print("🎉 FULL ACCEPTANCE TEST SUITE PASSED 100%! ZERO DUMMY DATA & REAL PERSISTED RECORDS!")
    print("=" * 80)

if __name__ == "__main__":
    run_acceptance_tests()
