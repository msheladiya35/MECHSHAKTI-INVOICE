// Mechshakti Sales Invoice Portal - Master Application Frontend Script
let currentToken = localStorage.getItem('mech_token') || null;
let currentUser = JSON.parse(localStorage.getItem('mech_user') || 'null');
let currentTheme = localStorage.getItem('mech_theme') || 'dark';

let currentInvoiceDraft = {
  customer_id: null,
  items: [],
  payment_mode: 'PAID',
  payment_method: 'CASH',
  paid_amount: 0
};

let activeScannerMode = 'NEW_BILL';
let cameraStream = null;
let activeSellerFilter = 'PENDING_APPROVAL';

const tabTitlesMap = {
  'dashboard': 'Home Dashboard',
  'customers': 'Customers Directory',
  'new-invoice': 'New Battery Bill',
  'invoices': 'Invoices & Bills',
  'payments': 'Payments Ledger',
  'reports': 'Sales & Hierarchy Reports',
  'warranty': 'Battery Warranty Portal',
  'rewards': 'Referral & Rewards',
  'profile': 'Account Profile & Settings',
  'sellers': 'Partner Approvals & List',
  'admin-products': 'Master Product Catalogue',
  'admin-warranties': 'Admin Warranty Queue',
  'admin-search': 'Admin Global Search'
};

// Double submission & Loading State Utility (Sections 32 & 33)
async function withLoadingState(btnElement, asyncFn) {
  if (!btnElement) return await asyncFn();
  const origText = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '⏳ Processing...';
  try {
    return await asyncFn();
  } finally {
    btnElement.disabled = false;
    btnElement.innerHTML = origText;
  }
}

// Audio Feedback Beep for QR Scanner (Section 20)
function triggerAudioBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz A5 pitch
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}

  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  initAppStatus();

  if (currentToken && currentUser) {
    showAuthenticatedUI();
    switchTab('dashboard');
  } else {
    showUnauthenticatedUI();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => reg.update())
      .catch(err => console.log('SW registration error:', err));
  }
});

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mech_theme', theme);
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light';
}

function toggleAppTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

function toggleNavDrawer() {
  const drawer = document.getElementById('nav-drawer');
  drawer.style.display = (drawer.style.display === 'none' || !drawer.style.display) ? 'block' : 'none';
}

function initAppStatus() {
  const updateOnlineStatus = () => {
    const netStatus = document.getElementById('drawer-network-status');
    if (netStatus) {
      if (navigator.onLine) {
        netStatus.textContent = '🟢 Online';
        netStatus.style.color = 'var(--status-active-text)';
      } else {
        netStatus.textContent = '🔴 Offline';
        netStatus.style.color = 'var(--status-rejected-text)';
      }
    }
  };
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

function performLogout() {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('mech_token');
  localStorage.removeItem('mech_user');
  const drawer = document.getElementById('nav-drawer');
  if (drawer) drawer.style.display = 'none';
  showUnauthenticatedUI();
}

function showAuthenticatedUI() {
  const userDisp = document.getElementById('user-display');
  if (userDisp && currentUser) {
    userDisp.textContent = `${currentUser.name} (${currentUser.role})`;
  }
  
  const menuBtn = document.getElementById('btn-menu-toggle');
  if (menuBtn) menuBtn.style.display = 'inline-block';

  const headerLogoutBtn = document.getElementById('header-logout-btn');
  if (headerLogoutBtn) headerLogoutBtn.style.display = 'inline-block';

  document.querySelector('.bottom-nav').style.display = 'flex';

  if (currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN')) {
    if (document.getElementById('drawer-admin-sellers-btn')) document.getElementById('drawer-admin-sellers-btn').style.display = 'block';
    if (document.getElementById('drawer-admin-products-btn')) document.getElementById('drawer-admin-products-btn').style.display = 'block';
    if (document.getElementById('drawer-admin-warranties-btn')) document.getElementById('drawer-admin-warranties-btn').style.display = 'block';
    if (document.getElementById('drawer-admin-search-btn')) document.getElementById('drawer-admin-search-btn').style.display = 'block';
    if (document.getElementById('drawer-admin-audit-btn')) document.getElementById('drawer-admin-audit-btn').style.display = 'block';
    if (document.getElementById('drawer-admin-backup-btn')) document.getElementById('drawer-admin-backup-btn').style.display = 'block';
    if (document.getElementById('btn-admin-edit-product')) document.getElementById('btn-admin-edit-product').style.display = 'inline-block';
  } else {
    if (document.getElementById('drawer-admin-sellers-btn')) document.getElementById('drawer-admin-sellers-btn').style.display = 'none';
    if (document.getElementById('drawer-admin-products-btn')) document.getElementById('drawer-admin-products-btn').style.display = 'none';
    if (document.getElementById('drawer-admin-warranties-btn')) document.getElementById('drawer-admin-warranties-btn').style.display = 'none';
    if (document.getElementById('drawer-admin-search-btn')) document.getElementById('drawer-admin-search-btn').style.display = 'none';
    if (document.getElementById('drawer-admin-audit-btn')) document.getElementById('drawer-admin-audit-btn').style.display = 'none';
    if (document.getElementById('drawer-admin-backup-btn')) document.getElementById('drawer-admin-backup-btn').style.display = 'none';
    if (document.getElementById('btn-admin-edit-product')) document.getElementById('btn-admin-edit-product').style.display = 'none';
  }
}

function showUnauthenticatedUI() {
  const menuBtn = document.getElementById('btn-menu-toggle');
  if (menuBtn) menuBtn.style.display = 'none';

  const headerLogoutBtn = document.getElementById('header-logout-btn');
  if (headerLogoutBtn) headerLogoutBtn.style.display = 'none';

  const adminBadge = document.getElementById('admin-pending-badge');
  if (adminBadge) adminBadge.style.display = 'none';

  document.querySelector('.bottom-nav').style.display = 'none';
  showView('view-login');
}

function switchTab(tabId) {
  if (!currentToken && tabId !== 'login' && tabId !== 'warranty') {
    showUnauthenticatedUI();
    return;
  }

  const subTitle = document.getElementById('header-active-tab-title');
  if (subTitle && tabTitlesMap[tabId]) {
    subTitle.textContent = tabTitlesMap[tabId];
  }

  document.querySelectorAll('.bottom-nav .nav-item').forEach(el => {
    if (el.getAttribute('data-tab') === tabId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  if (tabId === 'dashboard') {
    showView('view-dashboard');
    loadDashboardStats();
  } else if (tabId === 'customers') {
    showView('view-customers');
    loadCustomersList();
  } else if (tabId === 'new-invoice') {
    showView('view-new-invoice');
    initNewBillWorkflow();
  } else if (tabId === 'invoices') {
    showView('view-invoices');
    loadInvoicesList();
  } else if (tabId === 'payments') {
    showView('view-payments');
    loadPaymentsList();
  } else if (tabId === 'reports') {
    showView('view-reports');
    loadReportsTree();
  } else if (tabId === 'warranty') {
    showView('view-public-warranty');
    setWarrantySubTab('REG');
  } else if (tabId === 'rewards') {
    showView('view-rewards');
    loadRewardsSummary();
    loadReferralsNetwork();
  } else if (tabId === 'profile') {
    showView('view-profile');
    loadProfileDetails();
  } else if (tabId === 'sellers') {
    showView('view-admin-sellers');
    loadAdminSellersList();
  } else if (tabId === 'admin-products') {
    showView('view-admin-products');
    loadAdminMasterProducts();
  } else if (tabId === 'admin-warranties') {
    showView('view-admin-warranties');
    loadAdminWarrantiesQueue();
  } else if (tabId === 'admin-search') {
    showView('view-admin-search');
  } else if (tabId === 'admin-audit') {
    showView('view-admin-audit');
    loadAdminAuditLogs();
  }
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  const target = document.getElementById(viewId);
  if (target) target.style.display = 'block';
}

async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const config = { method, headers };
  if (data) {
    config.body = JSON.stringify(data);
  }

  try {
    const res = await fetch(endpoint, config);
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || result.message || 'Server request failed');
    }
    return result;
  } catch (err) {
    throw err;
  }
}

// 1. LOGIN HANDLER
document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/auth/login', 'POST', { email, password });
      currentToken = res.token;
      currentUser = res.user;
      localStorage.setItem('mech_token', currentToken);
      localStorage.setItem('mech_user', JSON.stringify(currentUser));

      showAuthenticatedUI();
      switchTab('dashboard');
    } catch (err) {
      alert(err.message);
    }
  });
});

document.getElementById('btn-logout')?.addEventListener('click', performLogout);

function openRegisterModal() { 
  document.getElementById('modal-register').style.display = 'flex'; 
  try {
    const hash = window.location.hash;
    const query = hash.includes('?') ? hash.split('?')[1] : window.location.search;
    const urlParams = new URLSearchParams(query);
    const refParam = urlParams.get('ref');
    if (refParam) {
      const input = document.getElementById('reg-referral-code');
      if (input) input.value = refParam;
    }
  } catch (e) {}
}
function closeRegisterModal() { document.getElementById('modal-register').style.display = 'none'; }

document.getElementById('form-register')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const mobile = document.getElementById('reg-mobile').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const confirm_password = document.getElementById('reg-confirm-password').value;
  const shop_name = document.getElementById('reg-shop').value;
  const city = document.getElementById('reg-city').value;
  const referral_code = document.getElementById('reg-referral-code')?.value || '';
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/auth/register', 'POST', {
        name, mobile, email, password, confirm_password, shop_name, city, referral_code
      });
      closeRegisterModal();
      alert(`Registration Submitted!\n${res.sub_message}`);
    } catch (err) {
      alert(err.message);
    }
  });
});

// WARRANTY SYSTEM HANDLERS
function showPublicWarrantyView(mode = 'REG') {
  showView('view-public-warranty');
  setWarrantySubTab(mode === 'REG' ? 'REG' : 'CHK');
}

function hidePublicWarrantyView() {
  if (currentToken) switchTab('dashboard');
  else showView('view-login');
}

function setWarrantySubTab(tab) {
  if (tab === 'REG') {
    document.getElementById('section-w-reg').style.display = 'block';
    document.getElementById('section-w-chk').style.display = 'none';
    document.getElementById('tab-w-reg').className = 'btn btn-primary btn-sm';
    document.getElementById('tab-w-chk').className = 'btn btn-secondary btn-sm';
  } else {
    document.getElementById('section-w-reg').style.display = 'none';
    document.getElementById('section-w-chk').style.display = 'block';
    document.getElementById('tab-w-reg').className = 'btn btn-secondary btn-sm';
    document.getElementById('tab-w-chk').className = 'btn btn-primary btn-sm';
  }
}

async function validateWarrantySerialBeforeSubmit() {
  const code = document.getElementById('w-reg-code').value.trim();
  const feedback = document.getElementById('w-reg-serial-feedback');
  if (!code) {
    feedback.style.display = 'none';
    return;
  }

  feedback.style.display = 'block';
  feedback.className = 'status-pill';
  feedback.textContent = 'Verifying battery serial...';

  try {
    const res = await apiRequest(`/api/warranty/validate-serial?code=${encodeURIComponent(code)}`);
    if (res.requires_admin_verification) {
      feedback.style.background = 'rgba(2, 132, 199, 0.18)';
      feedback.style.color = '#38bdf8';
      feedback.textContent = 'ℹ️ Serial not in sales registry. Registration will require Admin verification.';
    } else {
      feedback.style.background = 'rgba(34, 197, 94, 0.15)';
      feedback.style.color = '#22c55e';
      feedback.textContent = `✓ ${res.message}`;
    }
  } catch (err) {
    feedback.style.background = 'rgba(239, 68, 68, 0.18)';
    feedback.style.color = '#ef4444';
    feedback.innerHTML = `⚠ <strong>${err.message}</strong> <button type="button" class="btn btn-secondary btn-sm" onclick="setWarrantySubTab('CHK'); document.getElementById('w-chk-code').value='${code}'; checkPublicWarranty();" style="margin-left:8px; padding:2px 8px;">Check Status</button>`;
  }
}

document.getElementById('w-reg-code')?.addEventListener('blur', validateWarrantySerialBeforeSubmit);

document.getElementById('form-public-warranty-reg')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const battery_code = document.getElementById('w-reg-code').value.trim();
  const customer_name = document.getElementById('w-reg-name').value.trim();
  const customer_mobile = document.getElementById('w-reg-mobile').value.trim();
  const purchase_date = document.getElementById('w-reg-date').value;
  const vehicle_number = document.getElementById('w-reg-vehicle').value.trim();
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/warranty/register', 'POST', {
        battery_code, customer_name, customer_mobile, purchase_date, vehicle_number
      });

      const resCard = document.getElementById('w-reg-success-card');
      resCard.style.display = 'block';
      resCard.innerHTML = `
        <div style="background:var(--bg-card-elevated); border:1px solid var(--status-active-border); border-radius:12px; padding:16px; margin-top:16px;">
          <strong style="color:var(--status-active-text); font-size:1.15rem;">✓ WARRANTY REGISTERED</strong>
          <div style="font-size:0.9rem; margin-top:8px;"><strong>Serial Code:</strong> ${res.battery_code}</div>
          <div style="font-size:0.9rem;"><strong>Purchase Date:</strong> ${res.purchase_date}</div>
          <div style="font-size:0.9rem;"><strong>Warranty Valid Until:</strong> ${res.expiry_date}</div>
          <div style="font-size:0.9rem;"><strong>Registered Timestamp:</strong> ${res.registered_at}</div>
          <div style="font-size:0.9rem;"><strong>Warranty Status:</strong> <span class="badge badge-active">${res.status}</span></div>
        </div>
      `;

      document.getElementById('form-public-warranty-reg').reset();
    } catch (err) {
      alert(err.message);
    }
  });
});

async function checkPublicWarranty() {
  const code = document.getElementById('w-chk-code').value.trim();
  if (!code) return alert('Please enter a battery serial code.');

  const resContainer = document.getElementById('w-chk-result');
  resContainer.style.display = 'block';
  resContainer.innerHTML = '<div style="color: var(--text-muted);">Searching...</div>';

  try {
    const res = await apiRequest(`/api/warranty/check?code=${encodeURIComponent(code)}`);
    if (!res.found) {
      resContainer.innerHTML = `<div style="color: var(--mech-orange); padding:10px;">✕ ${res.message}</div>`;
      return;
    }

    const w = res.warranty;
    resContainer.innerHTML = `
      <div style="background: var(--bg-card-elevated); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px;">
        <strong style="color: var(--mech-orange); font-size: 1.05rem;">✓ Mechshakti Battery Warranty</strong>
        <div style="font-size: 0.9rem; margin-top: 6px;"><strong>Product:</strong> ${w.product_name || 'Mechshakti Battery'}</div>
        <div style="font-size: 0.9rem;"><strong>Serial:</strong> ${w.battery_code}</div>
        <div style="font-size: 0.9rem;"><strong>Purchase Date:</strong> ${w.purchase_date}</div>
        <div style="font-size: 0.9rem;"><strong>Warranty Expiry:</strong> ${w.expiry_date}</div>
        <div style="font-size: 0.9rem;"><strong>Registered Timestamp:</strong> ${w.registered_at}</div>
        <div style="font-size: 0.9rem; margin-top: 4px;"><strong>Status:</strong> <span class="badge ${w.status === 'VALID' ? 'badge-active' : 'badge-pending'}">${w.status}</span></div>
      </div>
    `;
  } catch (err) {
    resContainer.innerHTML = `<div style="color: red; padding:10px;">${err.message}</div>`;
  }
}

// DASHBOARD STATS
async function loadDashboardStats() {
  try {
    const data = await apiRequest('/api/reports/dashboard?preset=today');
    document.getElementById('stat-today-sales').textContent = `₹${data.today_sales.toLocaleString('en-IN')}`;
    document.getElementById('stat-today-collected').textContent = `₹${data.today_collected.toLocaleString('en-IN')}`;
    document.getElementById('stat-total-outstanding').textContent = `₹${data.total_outstanding.toLocaleString('en-IN')}`;
    document.getElementById('stat-today-batteries').textContent = data.today_batteries;

    if (currentUser.role === 'ADMIN' && data.pending_partners_count > 0) {
      document.getElementById('dash-admin-approval-banner').style.display = 'flex';
      const badge = document.getElementById('admin-pending-badge');
      if (badge) {
        badge.style.display = 'inline-block';
        document.getElementById('admin-pending-count').textContent = `[ ${data.pending_partners_count} ]`;
      }
    } else {
      document.getElementById('dash-admin-approval-banner').style.display = 'none';
      const badge = document.getElementById('admin-pending-badge');
      if (badge) badge.style.display = 'none';
    }
  } catch (err) {
    console.log('Error loading dashboard stats:', err);
  }
}

// NEW BILL WORKFLOW
async function initNewBillWorkflow(resetDraft = true) {
  if (resetDraft) {
    currentInvoiceDraft = { customer_id: null, items: [], payment_mode: 'PAID', payment_method: 'CASH', paid_amount: 0 };
  }
  renderBillItemsTable();

  const custSelect = document.getElementById('bill-customer-select');
  const selectedCustomerId = currentInvoiceDraft.customer_id;
  custSelect.innerHTML = '<option value="">-- Choose Customer --</option>';
  try {
    const customers = await apiRequest('/api/customers');
    customers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.mobile}) - ${c.shop_name || 'Individual'}`;
      custSelect.appendChild(opt);
    });
    if (selectedCustomerId) custSelect.value = String(selectedCustomerId);
  } catch (err) { console.log(err); }

  const prodSelect = document.getElementById('bill-product-select');
  const selectedProductId = resetDraft ? '' : prodSelect.value;
  prodSelect.innerHTML = '<option value="">-- Select Product --</option>';
  try {
    const products = await apiRequest('/api/products');
    const masterProds = products.filter(p => p.is_custom === 0 || !p.custom_partner_id);
    const customProds = products.filter(p => p.is_custom === 1 && p.custom_partner_id);

    if (masterProds.length > 0) {
      const gMaster = document.createElement('optgroup');
      gMaster.label = 'MECHSHAKTI MASTER PRODUCTS';
      masterProds.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.model_code} - ${p.name} (₹${p.selling_price})`;
        gMaster.appendChild(opt);
      });
      prodSelect.appendChild(gMaster);
    }

    if (customProds.length > 0) {
      const gCustom = document.createElement('optgroup');
      gCustom.label = 'MY CUSTOM PRODUCTS';
      customProds.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.model_code} - ${p.name} (₹${p.selling_price})`;
        gCustom.appendChild(opt);
      });
      prodSelect.appendChild(gCustom);
    }

    if (selectedProductId) prodSelect.value = selectedProductId;
  } catch (err) { console.log(err); }
}

async function onBillCustomerSelected() {
  const custId = document.getElementById('bill-customer-select').value;
  currentInvoiceDraft.customer_id = custId ? parseInt(custId) : null;
  onBillProductSelected();
}

async function onBillProductSelected() {
  const custId = document.getElementById('bill-customer-select').value;
  const prodId = document.getElementById('bill-product-select').value;
  const rateInput = document.getElementById('bill-rate-input');
  const badge = document.getElementById('rate-auto-badge');

  if (!custId || !prodId) {
    badge.textContent = '';
    return;
  }

  try {
    const res = await apiRequest(`/api/customers/${custId}/last-rate?product_id=${prodId}`);
    rateInput.value = res.rate;
    badge.textContent = res.source === 'PREVIOUS_CUSTOMER_RATE' ? '(Auto-Fetched Previous Rate)' : '(Catalog Rate)';
  } catch (err) {
    badge.textContent = '';
  }
}

// SELLER OTHER PRODUCT MODAL HANDLERS (Sections 10, 11, 12)
function openOtherProductModal() { document.getElementById('modal-other-product').style.display = 'flex'; }
function closeOtherProductModal() { document.getElementById('modal-other-product').style.display = 'none'; }

document.getElementById('form-other-product')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('other-prod-name').value.trim();
  const price = parseFloat(document.getElementById('other-prod-price').value || '0');
  const qty = parseInt(document.getElementById('other-prod-qty').value || '1');
  const btn = e.target.querySelector('button[type="submit"]');

  if (!Number.isFinite(price) || price <= 0) return alert('Please enter a valid selling rate.');
  if (!Number.isInteger(qty) || qty < 1) return alert('Quantity must be at least 1.');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/products/custom', 'POST', {
        name, selling_price: price
      });
      closeOtherProductModal();
      alert(res.message);

      const p = res.product;
      const line_base = Number((p.selling_price * qty).toFixed(2));
      
      const item = {
        product_id: p.id,
        product_label: `${p.name} (Custom)`,
        unit_price: p.selling_price,
        quantity: qty,
        battery_code: null,
        discount: 0,
        gst_rate: 0,
        total: line_base
      };

      currentInvoiceDraft.items.push(item);
      renderBillItemsTable();

      const prodSelect = document.getElementById('bill-product-select');
      if (prodSelect) {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.model_code} - ${p.name}`;
        prodSelect.appendChild(option);
        prodSelect.value = p.id;
        onBillProductSelected();
      }
    } catch (err) { alert(err.message); }
  });
});

function addBillItem() {
  const prodSelect = document.getElementById('bill-product-select');
  const prodId = parseInt(prodSelect.value);
  const rate = parseFloat(document.getElementById('bill-rate-input').value);
  const qty = parseInt(document.getElementById('bill-qty-input').value);
  const scannedText = document.getElementById('bill-scanned-code-text').textContent;

  if (!prodId) return alert('Please select a battery model.');
  if (!Number.isFinite(rate) || rate <= 0) return alert('Please enter a valid rate.');
  if (!Number.isInteger(qty) || qty < 1) return alert('Quantity must be at least 1.');

  const optText = prodSelect.options[prodSelect.selectedIndex].text;
  const item = {
    product_id: prodId,
    product_label: optText.split(' - ')[0],
    unit_price: rate,
    quantity: qty,
    battery_code: scannedText || null,
    discount: 0,
    gst_rate: 0,
    total: Number((rate * qty).toFixed(2))
  };

  currentInvoiceDraft.items.push(item);
  document.getElementById('bill-scanned-card').style.display = 'none';
  document.getElementById('bill-scanned-code-text').textContent = '';
  renderBillItemsTable();
}

function renderBillItemsTable() {
  const container = document.getElementById('bill-items-table-container');
  if (currentInvoiceDraft.items.length === 0) {
    container.innerHTML = '<div style="font-size:0.85rem; color:var(--text-muted); text-align:center;">No items added to current bill yet.</div>';
    return;
  }

  let html = `
    <table class="table" style="font-size:0.85rem;">
      <thead>
        <tr><th>Model</th><th>Rate</th><th>Qty</th><th>Total</th><th>Action</th></tr>
      </thead>
      <tbody>
  `;
  let grand = 0;
  currentInvoiceDraft.items.forEach((it, idx) => {
    grand += it.total;
    html += `
      <tr>
        <td>${it.product_label} ${it.battery_code ? `<br><small style="color:var(--mech-orange); font-family:monospace;">${it.battery_code}</small>` : ''}</td>
        <td>₹${it.unit_price}</td>
        <td>${it.quantity}</td>
        <td>₹${it.total.toFixed(2)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="removeBillItem(${idx})">✕</button></td>
      </tr>
    `;
  });
  html += `</tbody></table><div style="text-align:right; font-weight:700; font-size:1.05rem; margin-top:8px;">Grand Total: ₹${grand.toFixed(2)}</div>`;
  container.innerHTML = html;
}

function removeBillItem(idx) {
  currentInvoiceDraft.items.splice(idx, 1);
  renderBillItemsTable();
}

function onBillPaymentModeChanged() {
  const mode = document.getElementById('bill-payment-mode').value;
  const pGroup = document.getElementById('bill-paid-amount-group');
  pGroup.style.display = mode === 'PARTIAL' ? 'block' : 'none';
}

function onBillPaymentMethodChanged() {
  const method = document.getElementById('bill-payment-method').value;
  const upiCard = document.getElementById('seller-upi-qr-card');
  if (method === 'UPI') {
    upiCard.style.display = 'block';
    document.getElementById('seller-upi-id-display').textContent = currentUser.upi_id ? `UPI ID: ${currentUser.upi_id}` : 'Seller UPI ID: mechshakti@upi';

    const qrWrapper = document.getElementById('seller-qr-img-wrapper');
    const qrImg = document.getElementById('seller-bill-qr-img');
    if (currentUser.upi_qr_url && qrWrapper && qrImg) {
      qrImg.src = currentUser.upi_qr_url;
      qrWrapper.style.display = 'block';
    } else if (qrWrapper) {
      qrWrapper.style.display = 'none';
    }
  } else {
    upiCard.style.display = 'none';
  }
}

async function submitGenerateInvoice() {
  if (!currentInvoiceDraft.customer_id) return alert('Please select a customer.');
  if (currentInvoiceDraft.items.length === 0) return alert('Please add at least one battery model.');

  const mode = document.getElementById('bill-payment-mode').value;
  const method = document.getElementById('bill-payment-method').value;
  const paid = parseFloat(document.getElementById('bill-paid-amount').value || '0');

  try {
    const res = await apiRequest('/api/invoices', 'POST', {
      customer_id: currentInvoiceDraft.customer_id,
      items: currentInvoiceDraft.items,
      payment_mode: mode,
      payment_method: method,
      paid_amount: paid
    });

    alert(`✓ Bill Generated Successfully!\nInvoice #: ${res.invoice_number}\nGrand Total: ₹${res.grand_total}`);
    openInvoicePreviewModal(res.id);
    switchTab('invoices');
  } catch (err) {
    alert(err.message);
  }
}

// INVOICE PREVIEW
let activePreviewInvoice = null;

async function openInvoicePreviewModal(invId) {
  try {
    const res = await apiRequest(`/api/invoices/${invId}`);
    activePreviewInvoice = res;
    const inv = res.invoice;
    const items = res.items;

    let itemsHtml = items.map(it => `
      <tr>
        <td>${it.product_name_snapshot} (${it.model_code_snapshot}) ${it.battery_code ? `<br><small style="font-family:monospace; color:var(--mech-orange);">${it.battery_code}</small>` : ''}</td>
        <td>₹${it.unit_price}</td>
        <td>${it.quantity}</td>
        <td>₹${it.line_total}</td>
      </tr>
    `).join('');

    document.getElementById('invoice-preview-body').innerHTML = `
      <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:10px; padding:16px;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:12px;">
          <div>
            <strong style="color:var(--mech-orange); font-size:1.2rem;">MECHSHAKTI BATTERIES</strong>
            <div>${inv.seller_shop || inv.seller_name}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Phone: ${inv.seller_phone || ''}</div>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:1.1rem;">SALES BILL / CASH MEMO</strong>
            <div style="font-family:monospace; font-weight:700; color:var(--mech-orange);">${inv.invoice_number}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${inv.invoice_date}</div>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <strong>Billed To:</strong>
          <div>${inv.customer_name} (${inv.customer_shop || 'Individual'})</div>
          <div style="font-size:0.85rem; color:var(--text-muted);">${inv.customer_mobile}</div>
        </div>

        <table class="table" style="font-size:0.85rem; margin-bottom:12px;">
          <thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Total</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:16px; border-top:1px solid var(--border-color); padding-top:12px;">
          <div>
            ${inv.seller_upi_qr ? `
              <div style="text-align:center;">
                <div style="font-size:0.75rem; font-weight:700; color:var(--mech-orange); margin-bottom:4px;">SCAN TO PAY SELLER</div>
                <img src="${inv.seller_upi_qr}" style="max-width:130px; max-height:130px; border-radius:6px; border:1px solid var(--mech-orange); padding:2px; background:#fff;" alt="Seller Payment QR">
                ${inv.seller_upi ? `<div style="font-size:0.75rem; font-family:monospace; margin-top:2px;">${inv.seller_upi}</div>` : ''}
              </div>
            ` : (inv.seller_upi ? `<div style="font-size:0.8rem;"><strong>Seller UPI:</strong> ${inv.seller_upi}</div>` : '')}
          </div>
          <div style="text-align:right; font-size:0.95rem;">
            <div>Grand Total: <strong>₹${inv.grand_total}</strong></div>
            <div>Paid: <strong style="color:green;">₹${inv.paid_amount}</strong></div>
            <div>Outstanding: <strong style="color:red;">₹${inv.outstanding}</strong></div>
          </div>
        </div>

        <div style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--border-color); font-size:0.75rem; color:var(--text-muted);">
          <strong style="color:var(--text-main);">Terms & Conditions:</strong>
          <ol style="margin-left:16px; margin-top:4px; padding:0;">
            <li>Physical damage, broken seals, or burnt battery terminals are strictly excluded from warranty.</li>
            <li>Battery warranty is subject to manufacturer terms and registration at warranty portal.</li>
            <li>Goods once sold will not be taken back or exchanged.</li>
          </ol>
        </div>
      </div>
    `;
    document.getElementById('modal-invoice-preview').style.display = 'flex';
  } catch (err) {
    alert(err.message);
  }
}

function closeInvoicePreviewModal() {
  document.getElementById('modal-invoice-preview').style.display = 'none';
}

function downloadInvoicePDF() { window.print(); }

function shareInvoiceWhatsApp() {
  if (!activePreviewInvoice) return;
  const inv = activePreviewInvoice.invoice;
  const items = activePreviewInvoice.items || [];
  const itemsSummary = items.map(it => `• ${it.product_name_snapshot} x${it.quantity} (₹${it.line_total})`).join('\n');

  const text = `⚡ *MECHSHAKTI SALES BILL*\n` +
    `🧾 *Invoice #*: ${inv.invoice_number}\n` +
    `📅 *Date*: ${inv.invoice_date}\n` +
    `👤 *Customer*: ${inv.customer_name} (${inv.customer_shop || 'Individual'})\n` +
    `🏪 *Seller*: ${inv.seller_shop || inv.seller_name}\n` +
    `---------------------------------\n` +
    `📦 *Items*:\n${itemsSummary}\n` +
    `---------------------------------\n` +
    `💵 *Grand Total*: ₹${inv.grand_total}\n` +
    `✅ *Amount Paid*: ₹${inv.paid_amount}\n` +
    `📌 *Outstanding*: ₹${inv.outstanding}\n` +
    `---------------------------------\n` +
    `Thank you for choosing Mechshakti Power Systems!`;

  const cleanPhone = (inv.customer_mobile || '').replace(/[^0-9]/g, '');
  const phoneParam = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  const url = `https://api.whatsapp.com/send?phone=${phoneParam}&text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

async function downloadDatabaseBackup() {
  try {
    const data = await apiRequest('/api/admin/export-database');
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mechshakti_db_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('✓ Full database backup downloaded successfully!');
  } catch (err) {
    alert('Failed to download backup: ' + err.message);
  }
}

// CUSTOMER MANAGEMENT (EDIT, ARCHIVE, LEDGER - Sections 5, 6, 7, 17)
let activeCustomersList = [];

async function loadCustomersList() {
  const container = document.getElementById('customers-list-container');
  container.innerHTML = 'Loading customers...';
  try {
    activeCustomersList = await apiRequest('/api/customers');
    renderFilteredCustomers(activeCustomersList);
  } catch (err) { container.innerHTML = `<div class="card">${err.message}</div>`; }
}

function filterCustomersList() {
  const q = (document.getElementById('customer-search-input')?.value || '').toLowerCase().trim();
  if (!q) {
    renderFilteredCustomers(activeCustomersList);
    return;
  }
  const filtered = activeCustomersList.filter(c => 
    c.name.toLowerCase().includes(q) || 
    c.mobile.includes(q) || 
    (c.shop_name && c.shop_name.toLowerCase().includes(q))
  );
  renderFilteredCustomers(filtered);
}

function renderFilteredCustomers(list) {
  const container = document.getElementById('customers-list-container');
  if (list.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align:center; padding:24px;">
        <div style="font-size:1.1rem; font-weight:700; margin-bottom:8px;">No customers found.</div>
        <button class="btn btn-primary btn-sm" onclick="openCustomerModal()">+ Add Customer</button>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(c => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:start;">
        <div>
          <strong style="font-size:1.05rem;">${c.name}</strong>
          <div style="font-size:0.85rem; color:var(--text-muted);">${c.mobile} | ${c.shop_name || 'Individual'}</div>
          ${c.city ? `<div style="font-size:0.8rem; color:var(--text-muted);">City: ${c.city}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.8rem; color:var(--text-muted);">Outstanding</div>
          <strong style="color:${c.outstanding_balance > 0 ? 'red' : 'green'}; font-size:1.05rem;">₹${c.outstanding_balance}</strong>
        </div>
      </div>

      <div style="display:flex; gap:6px; margin-top:12px; border-top:1px solid var(--border-color); padding-top:8px;">
        <button class="btn btn-secondary btn-sm" onclick="openCustomerLedgerModal(${c.id})" style="flex:1;">📜 Khatabook</button>
        <button class="btn btn-secondary btn-sm" onclick="openEditCustomerModal(${c.id})" style="flex:1;">✏️ Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="archiveCustomer(${c.id})" style="flex:1; color:var(--status-rejected-text);">📦 Archive</button>
      </div>
    </div>
  `).join('');
}

function openEditCustomerModal(custId) {
  const cust = activeCustomersList.find(c => c.id === custId);
  if (!cust) return;
  document.getElementById('edit-cust-id').value = cust.id;
  document.getElementById('edit-cust-name').value = cust.name;
  document.getElementById('edit-cust-mobile').value = cust.mobile;
  document.getElementById('edit-cust-shop').value = cust.shop_name || '';
  document.getElementById('edit-cust-city').value = cust.city || '';
  document.getElementById('edit-cust-address').value = cust.address || '';
  document.getElementById('modal-edit-customer').style.display = 'flex';
}
function closeEditCustomerModal() { document.getElementById('modal-edit-customer').style.display = 'none'; }

document.getElementById('form-edit-customer')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cId = document.getElementById('edit-cust-id').value;
  const name = document.getElementById('edit-cust-name').value;
  const mobile = document.getElementById('edit-cust-mobile').value;
  const shop_name = document.getElementById('edit-cust-shop').value;
  const city = document.getElementById('edit-cust-city').value;
  const address = document.getElementById('edit-cust-address').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest(`/api/customers/${cId}`, 'PUT', { name, mobile, shop_name, city, address });
      closeEditCustomerModal();
      alert(res.message);
      loadCustomersList();
    } catch (err) { alert(err.message); }
  });
});

async function archiveCustomer(custId) {
  if (!confirm('Are you sure you want to archive this customer?')) return;
  try {
    const res = await apiRequest(`/api/customers/${custId}`, 'DELETE');
    alert(res.message);
    loadCustomersList();
  } catch (err) { alert(err.message); }
}

async function openCustomerLedgerModal(custId) {
  const container = document.getElementById('customer-ledger-body');
  container.innerHTML = 'Loading statement...';
  document.getElementById('modal-customer-ledger').style.display = 'flex';

  try {
    const data = await apiRequest(`/api/customers/${custId}/ledger`);
    const c = data.customer;
    let txHtml = data.transactions.map(t => `
      <tr>
        <td>${t.tx_date}</td>
        <td>${t.type === 'PURCHASE' ? `Bill #${t.invoice_number}` : `Payment (${t.status})`}</td>
        <td style="color:${t.type==='PURCHASE'?'red':'green'}; font-weight:700;">${t.type === 'PURCHASE' ? `+₹${t.amount}` : `-₹${t.amount}`}</td>
        <td>₹${t.running_balance}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="margin-bottom:12px;">
        <strong style="font-size:1.1rem; color:var(--mech-orange);">${c.name}</strong> (${c.mobile})
        <div>Shop: ${c.shop_name || 'Individual'}</div>
        <div style="display:flex; justify-content:space-between; margin-top:8px; background:var(--bg-card-elevated); padding:8px 12px; border-radius:8px;">
          <div>Total Billed: <strong>₹${data.total_billed}</strong></div>
          <div>Total Paid: <strong style="color:green;">₹${data.total_paid}</strong></div>
          <div>Outstanding: <strong style="color:red;">₹${data.outstanding_balance}</strong></div>
        </div>
      </div>
      <table class="table" style="font-size:0.85rem;">
        <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Balance</th></tr></thead>
        <tbody>${txHtml || '<tr><td colspan="4" style="text-align:center;">No transactions yet.</td></tr>'}</tbody>
      </table>
    `;
  } catch (err) { container.innerHTML = `<div style="color:red;">${err.message}</div>`; }
}
function closeCustomerLedgerModal() { document.getElementById('modal-customer-ledger').style.display = 'none'; }

// ADMIN PARTNERS & SELLERS QUEUE
function setSellerFilter(status) {
  activeSellerFilter = status;
  loadAdminSellersList();
}

async function loadAdminSellersList() {
  const container = document.getElementById('admin-sellers-list-container');
  if (!container) return;
  container.innerHTML = 'Loading partners list...';

  try {
    const data = await apiRequest(`/api/admin/sellers?status=${activeSellerFilter}`);
    const sellers = data.sellers;

    if (sellers.length === 0) {
      container.innerHTML = `<div class="card">No partners found for status filter '${activeSellerFilter}'.</div>`;
      return;
    }

    container.innerHTML = sellers.map(s => `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div>
            <strong style="font-size:1.1rem; color:var(--text-main);">${s.name}</strong>
            <div style="font-size:0.85rem; color:var(--text-muted);">${s.shop_name} | ${s.city}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Phone: ${s.phone} | Email: ${s.email}</div>
            ${s.dealer_code ? `<div style="font-size:0.8rem; color:var(--mech-orange);">Dealer Code: ${s.dealer_code}</div>` : ''}
          </div>
          <div>
            <span class="badge ${s.status === 'ACTIVE' ? 'badge-active' : (s.status === 'PENDING_APPROVAL' ? 'badge-pending' : 'badge-rejected')}">${s.status}</span>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-top:12px; border-top:1px solid var(--border-color); padding-top:10px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="openEditPartnerModal(${s.id})">✏️ Edit Profile</button>
          ${s.status === 'PENDING_APPROVAL' ? `
            <button class="btn btn-primary btn-sm" onclick="updatePartnerStatus(${s.id}, 'APPROVE')">✓ Approve Partner</button>
            <button class="btn btn-secondary btn-sm" onclick="updatePartnerStatus(${s.id}, 'REJECT')">✕ Reject</button>
          ` : ''}
          ${s.status === 'ACTIVE' ? `
            <button class="btn btn-secondary btn-sm" onclick="updatePartnerStatus(${s.id}, 'SUSPEND')">🚫 Suspend Partner</button>
          ` : ''}
          ${s.status === 'SUSPENDED' || s.status === 'REJECTED' ? `
            <button class="btn btn-primary btn-sm" onclick="updatePartnerStatus(${s.id}, 'ACTIVATE')">✓ Activate Partner</button>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) { container.innerHTML = err.message; }
}

async function updatePartnerStatus(sellerId, action) {
  let rejection_reason = '';
  if (action === 'REJECT') {
    rejection_reason = prompt('Enter rejection reason for this partner account:') || '';
  }

  try {
    const res = await apiRequest(`/api/admin/sellers/${sellerId}/status`, 'PUT', { action, rejection_reason });
    alert(res.message);
    loadAdminSellersList();
    loadDashboardStats();
  } catch (err) { alert(err.message); }
}

// ADMIN WARRANTY QUEUE
async function loadAdminWarrantiesQueue() {
  const container = document.getElementById('admin-warranties-list-container');
  if (!container) return;
  container.innerHTML = 'Loading pending warranty registrations...';

  try {
    const data = await apiRequest('/api/admin/warranties?status=PENDING_VERIFICATION');
    const list = data.warranties;

    if (list.length === 0) {
      container.innerHTML = '<div class="card">No pending warranty registrations requiring Admin approval.</div>';
      return;
    }

    container.innerHTML = list.map(w => `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between;">
          <div>
            <strong style="color:var(--mech-orange); font-size:1.05rem;">Serial: ${w.battery_code}</strong>
            <div style="font-size:0.85rem;">Customer: ${w.customer_name} (${w.customer_mobile})</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Purchase Date: ${w.purchase_date} | Registered: ${w.created_at}</div>
          </div>
          <div>
            <span class="badge badge-pending">${w.status}</span>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-primary btn-sm" onclick="adminApproveWarranty(${w.id})">✓ Approve Warranty</button>
          <button class="btn btn-secondary btn-sm" onclick="adminCancelWarranty(${w.id})">✕ Cancel / Override</button>
        </div>
      </div>
    `).join('');
  } catch (err) { container.innerHTML = err.message; }
}

async function adminApproveWarranty(wId) {
  try {
    const res = await apiRequest(`/api/admin/warranties/${wId}/approve`, 'PUT');
    alert(res.message);
    loadAdminWarrantiesQueue();
  } catch (err) { alert(err.message); }
}

async function adminCancelWarranty(wId) {
  const reason = prompt('Enter audit reason for cancelling this warranty registration:');
  if (!reason) return;

  try {
    const res = await apiRequest(`/api/admin/warranties/${wId}/cancel`, 'PUT', { reason });
    alert(res.message);
    loadAdminWarrantiesQueue();
  } catch (err) { alert(err.message); }
}

// PROFILE DETAILS & UPI QR CODE UPLOAD
let uploadedQRBase64 = null;

function previewUploadedUPIQR(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    uploadedQRBase64 = e.target.result;
    const img = document.getElementById('prof-qr-preview-img');
    const container = document.getElementById('prof-qr-preview-container');
    if (img && container) {
      img.src = uploadedQRBase64;
      container.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

async function loadProfileDetails() {
  document.getElementById('prof-display-name').textContent = currentUser.name;
  document.getElementById('prof-display-email').textContent = currentUser.email;
  document.getElementById('prof-display-role-badge').textContent = currentUser.role;

  document.getElementById('prof-name').value = currentUser.name || '';
  document.getElementById('prof-phone').value = currentUser.phone || '';
  document.getElementById('prof-shop').value = currentUser.shop_name || '';
  document.getElementById('prof-city').value = currentUser.city || '';
  if (document.getElementById('prof-address')) document.getElementById('prof-address').value = currentUser.address || '';
  if (document.getElementById('prof-gst')) document.getElementById('prof-gst').value = currentUser.gst_number || '';
  if (document.getElementById('prof-dealer-code')) document.getElementById('prof-dealer-code').value = currentUser.dealer_code || '';
  document.getElementById('prof-upi-id').value = currentUser.upi_id || '';

  if (currentUser.upi_qr_url) {
    uploadedQRBase64 = currentUser.upi_qr_url;
    const img = document.getElementById('prof-qr-preview-img');
    const container = document.getElementById('prof-qr-preview-container');
    if (img && container) {
      img.src = currentUser.upi_qr_url;
      container.style.display = 'block';
    }
  }
}

async function saveProfileDetails(event) {
  if (event) event.preventDefault();

  const name = document.getElementById('prof-name').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  const shop_name = document.getElementById('prof-shop').value.trim();
  const city = document.getElementById('prof-city').value.trim();
  const address = document.getElementById('prof-address')?.value.trim() || '';
  const gst_number = document.getElementById('prof-gst')?.value.trim() || '';
  const dealer_code = document.getElementById('prof-dealer-code')?.value.trim() || '';
  const upi_id = document.getElementById('prof-upi-id').value.trim();

  try {
    const res = await apiRequest('/api/profile', 'PUT', {
      name, phone, shop_name, city, address, gst_number, dealer_code, upi_id, upi_qr_url: uploadedQRBase64
    });
    currentUser = res.user;
    localStorage.setItem('mech_user', JSON.stringify(currentUser));
    showAuthenticatedUI();
    alert('✓ Profile & payment details updated successfully!');
  } catch (err) {
    alert('Failed to save profile: ' + err.message);
  }
}

async function saveProfileUPI() {
  saveProfileDetails(null);
}

// PAYMENTS LIST & MODAL
async function loadPaymentsList() {
  const container = document.getElementById('payments-list-container');
  if (!container) return;
  container.innerHTML = 'Loading payment transactions...';

  try {
    const list = await apiRequest('/api/payments');
    if (list.length === 0) {
      container.innerHTML = '<div class="card" style="text-align:center; padding:24px;">No payment transactions recorded yet.</div>';
      return;
    }

    container.innerHTML = list.map(p => `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:var(--text-main);">${p.customer_name}</strong>
            <div style="font-size:0.85rem; color:var(--text-muted);">${p.payment_date} | Method: <strong>${p.payment_method}</strong></div>
            ${p.reference_no ? `<div style="font-size:0.8rem; color:var(--mech-orange);">Ref: ${p.reference_no}</div>` : ''}
          </div>
          <div style="font-size:1.15rem; font-weight:800; color:#22c55e;">
            +₹${p.amount}
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) { container.innerHTML = err.message; }
}

function openPaymentModal() {
  const select = document.getElementById('pay-customer-select');
  select.innerHTML = '<option value="">-- Select Customer --</option>';
  apiRequest('/api/customers').then(custs => {
    custs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.mobile}) - Outstanding: ₹${c.outstanding_balance}`;
      select.appendChild(opt);
    });
  });
  document.getElementById('modal-payment').style.display = 'flex';
}
function closePaymentModal() { document.getElementById('modal-payment').style.display = 'none'; }

document.getElementById('form-payment')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const customer_id = parseInt(document.getElementById('pay-customer-select').value);
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const payment_method = document.getElementById('pay-method').value;
  const reference_no = document.getElementById('pay-ref').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/payments', 'POST', { customer_id, amount, payment_method, reference_no });
      closePaymentModal();
      alert('✓ Payment recorded successfully!');
      if (document.getElementById('view-payments').style.display !== 'none') {
        loadPaymentsList();
      } else {
        loadDashboardStats();
      }
    } catch (err) { alert(err.message); }
  });
});

// REWARDS & REFERRALS
async function loadRewardsSummary() {
  try {
    const data = await apiRequest('/api/rewards/summary');
    document.getElementById('reward-avail-pts').textContent = data.available_points.toFixed(2);
    document.getElementById('reward-lifetime-pts').textContent = data.lifetime_earned.toFixed(2);

    const list = document.getElementById('reward-txns-list');
    if (data.transactions.length === 0) {
      list.innerHTML = '<div style="font-size:0.85rem; color:var(--text-muted);">No reward transactions yet. Earn points when your referral network sells batteries!</div>';
      return;
    }
    list.innerHTML = data.transactions.map(t => `
      <div style="background:var(--bg-card-elevated); border:1px solid var(--border-color); border-radius:8px; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; font-size:0.85rem;">
        <div>
          <strong>${t.product_name}</strong> (Level ${t.referral_level})
          <div style="color:var(--text-muted); font-size:0.75rem;">${t.created_at}</div>
        </div>
        <div style="font-weight:700; color:var(--status-active-text);">+${t.points_earned} pts</div>
      </div>
    `).join('');
  } catch (err) { console.log(err); }
}

let currentReferralCode = '';

async function loadReferralsNetwork() {
  try {
    const data = await apiRequest('/api/referrals/network');
    currentReferralCode = data.referral_code || 'MS-REF-PORTAL';
    const codeEl = document.getElementById('reward-my-ref-code');
    if (codeEl) codeEl.textContent = currentReferralCode;

    const container = document.getElementById('referrals-network-tree');
    if (!container) return;

    const l1 = data.level1_referrals || [];
    const l2 = data.level2_referrals || [];

    if (l1.length === 0 && l2.length === 0) {
      container.innerHTML = `
        <div style="font-size:0.85rem; color:var(--text-muted); background:var(--bg-card-elevated); padding:14px; border-radius:8px; text-align:center;">
          No referred partners linked yet.<br>
          Tap <strong>💬 Share on WhatsApp</strong> above to invite mechanics & garages to join your network and earn 50 Points (₹50) per battery sold!
        </div>`;
      return;
    }

    let html = '';

    // Level 1 Direct Referrals Section
    html += `<div style="font-size:0.9rem; font-weight:700; color:var(--mech-orange); margin-bottom:8px;">🥇 Direct Level 1 Referrals (${l1.length} Partners)</div>`;
    if (l1.length === 0) {
      html += `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">No direct referrals yet.</div>`;
    } else {
      html += l1.map(r => `
        <div style="background:var(--bg-card); border-left:4px solid var(--mech-orange); border-radius:8px; padding:12px; margin-bottom:8px; box-shadow:var(--shadow-sm);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:0.95rem; color:var(--text-main);">${escapeHtml(r.name)}</strong>
              <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(r.shop_name || 'Garage')} | 📱 ${r.phone} | 📍 ${escapeHtml(r.city || '-')}</div>
            </div>
            <span class="badge ${r.status === 'ACTIVE' ? 'badge-active' : 'badge-pending'}">${r.status}</span>
          </div>
          <div style="margin-top:8px; padding-top:6px; border-top:1px dashed var(--border-color); display:flex; justify-content:space-between; font-size:0.8rem;">
            <span>🔋 Batteries Sold: <strong>${r.total_batteries_sold} units</strong> (₹${r.total_sales_amount.toLocaleString()})</span>
            <span style="color:var(--status-active-text); font-weight:700;">Earned for you: +${r.points_earned_for_you} pts</span>
          </div>
        </div>
      `).join('');
    }

    // Level 2 Indirect Referrals Section
    if (l2.length > 0) {
      html += `<div style="font-size:0.9rem; font-weight:700; color:var(--text-muted); margin-top:16px; margin-bottom:8px;">🥈 2nd-Tier Level 2 Referrals (${l2.length} Partners)</div>`;
      html += l2.map(r => `
        <div style="background:var(--bg-card); border-left:4px solid var(--text-muted); border-radius:8px; padding:10px; margin-bottom:6px; font-size:0.82rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${escapeHtml(r.name)}</strong> (${escapeHtml(r.shop_name || 'Garage')}) - ${escapeHtml(r.city || '-')}
              <div style="color:var(--text-muted); font-size:0.75rem;">Referred by Level 1 Partner: <strong>${escapeHtml(r.referrer_name)}</strong></div>
            </div>
            <span style="color:var(--status-active-text); font-weight:700;">+${r.points_earned_for_you} pts</span>
          </div>
        </div>
      `).join('');
    }

    container.innerHTML = html;
  } catch (err) { console.log(err); }
}

function shareReferralWhatsApp() {
  const code = currentReferralCode || 'MS-REF-PORTAL';
  const url = `${window.location.origin}/#register?ref=${code}`;
  const text = `⚡ Join Mechshakti Battery Partner Portal!\n\nSell batteries, register digital warranties, track khatabook, and earn referral reward points on every battery sold!\n\nRegister your Mechshakti Partner Account here:\n👉 ${url}\n\nUse Referral Code: *${code}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function copyReferralLink() {
  const code = currentReferralCode || 'MS-REF-PORTAL';
  const url = `${window.location.origin}/#register?ref=${code}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('✔ Referral link copied to clipboard!\nShare this link with mechanics & garages to earn points.');
  }).catch(() => {
    alert(`Your referral code is: ${code}`);
  });
}

function openReferralModal() { document.getElementById('modal-referral').style.display = 'flex'; }
function closeReferralModal() { document.getElementById('modal-referral').style.display = 'none'; }
function openRedeemModal() { document.getElementById('modal-redeem').style.display = 'flex'; }
function closeRedeemModal() { document.getElementById('modal-redeem').style.display = 'none'; }

document.getElementById('form-referral')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mobile = document.getElementById('ref-mobile').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/referrals', 'POST', { mobile });
      closeReferralModal();
      alert(res.message);
      loadReferralsNetwork();
    } catch (err) { alert(err.message); }
  });
});

document.getElementById('form-redeem')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const points = parseFloat(document.getElementById('redeem-pts').value);
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/rewards/redeem', 'POST', { points });
      closeRedeemModal();
      alert(res.message);
      loadRewardsSummary();
    } catch (err) { alert(err.message); }
  });
});

// ADMIN GLOBAL SEARCH
async function executeAdminSearch() {
  const q = document.getElementById('admin-search-input').value.trim();
  if (!q) return;

  const container = document.getElementById('admin-search-results');
  container.innerHTML = '<div style="color:var(--text-muted);">Searching across ecosystem...</div>';

  try {
    const res = await apiRequest(`/api/admin/global-search?q=${encodeURIComponent(q)}`);
    let html = '';

    if (res.batteries.length > 0) {
      html += '<h4>Battery Traceability Records</h4>';
      res.batteries.forEach(b => {
        html += `
          <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:10px; margin-bottom:8px; font-size:0.85rem;">
            <strong style="color:var(--mech-orange);">${b.battery_code}</strong> - ${b.product_name}<br>
            Seller: ${b.seller_name} | Customer: ${b.customer_name} | Invoice #: ${b.invoice_number}<br>
            Warranty Status: <span class="badge badge-active">${b.warranty_status || 'NOT_REGISTERED'}</span>
          </div>
        `;
      });
    }

    if (res.customers.length > 0) {
      html += '<h4>Matching Customers</h4>';
      res.customers.forEach(c => {
        html += `<div style="font-size:0.85rem; margin-bottom:4px;">👤 <strong>${c.name}</strong> (${c.mobile}) - ${c.partner_name}</div>`;
      });
    }

    container.innerHTML = html || '<div style="color:var(--text-muted);">No matching records found.</div>';
  } catch (err) { container.innerHTML = `<div style="color:red;">${err.message}</div>`; }
}

// INVOICES & REPORTS LISTING
async function loadInvoicesList() {
  const container = document.getElementById('invoices-list-container');
  container.innerHTML = 'Loading invoices...';
  try {
    const list = await apiRequest('/api/invoices');
    if (list.length === 0) {
      container.innerHTML = '<div class="card" style="text-align:center; padding:24px;">No invoices recorded yet. Click + New Bill to create your first bill.</div>';
      return;
    }
    container.innerHTML = list.map(inv => `
      <div class="card" style="margin-bottom:12px; cursor:pointer;" onclick="openInvoicePreviewModal(${inv.id})">
        <div style="display:flex; justify-content:space-between;">
          <div>
            <strong style="color:var(--mech-orange);">${inv.invoice_number}</strong>
            <div style="font-size:0.85rem;">Customer: ${inv.customer_name}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${inv.invoice_date}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;">₹${inv.grand_total}</div>
            <span class="badge ${inv.payment_status === 'PAID' ? 'badge-active' : (inv.payment_status === 'CANCELLED' ? 'badge-rejected' : 'badge-pending')}">${inv.payment_status}</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) { container.innerHTML = err.message; }
}

async function loadReportsTree() {
  const container = document.getElementById('reports-tree-container');
  container.innerHTML = 'Loading hierarchical reports...';
  try {
    const tree = await apiRequest('/api/reports/hierarchical?preset=this_month');
    if (tree.length === 0) {
      container.innerHTML = '<div class="card" style="text-align:center; padding:24px;">No sales recorded for this period.</div>';
      return;
    }
    let html = '';
    tree.forEach(s => {
      html += `
        <div class="card" style="margin-bottom:16px;">
          <h3 style="color:var(--mech-orange); margin-bottom:8px;">Seller: ${s.seller_name} (${s.seller_shop || 'Store'})</h3>
          <div style="font-size:0.85rem; margin-bottom:12px;">Total Batteries Sold: <strong>${s.total_batteries}</strong> | Total Sales: <strong>₹${s.total_amount}</strong></div>
          ${s.customers.map(c => `
            <div style="background:var(--bg-card-elevated); border:1px solid var(--border-color); border-radius:8px; padding:10px; margin-top:8px;">
              <strong>Customer: ${c.customer_name}</strong> (${c.total_batteries} batteries - ₹${c.total_amount})
              <div style="margin-top:6px; font-size:0.8rem;">
                ${c.batteries.map(b => `• ${b.product_name}: ${b.quantity} units (₹${b.total_amount})`).join('<br>')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) { container.innerHTML = err.message; }
}

// CAMERA SCANNER HELPER WITH REAL-TIME DECODING & AUDIO/HAPTIC FEEDBACK (Section 20)
let scanAnimationId = null;

function startCameraScanner(mode = 'NEW_BILL') {
  activeScannerMode = mode;
  document.getElementById('modal-camera').style.display = 'flex';

  const statusEl = document.getElementById('camera-scan-status');
  if (statusEl) {
    statusEl.style.background = 'var(--bg-card-elevated)';
    statusEl.style.color = 'var(--mech-orange)';
    statusEl.textContent = '🔍 Point camera at Mechshakti Battery QR code...';
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (statusEl) {
      statusEl.style.background = 'rgba(239, 68, 68, 0.18)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = '✕ Camera access not supported by browser. Please type serial code manually.';
    }
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
    cameraStream = stream;
    const video = document.getElementById('camera-video');
    video.srcObject = stream;
    video.setAttribute('playsinline', true);
    video.play();

    scanAnimationId = requestAnimationFrame(scanQRCodeFrame);
  }).catch(err => {
    if (statusEl) {
      statusEl.style.background = 'rgba(239, 68, 68, 0.18)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `⚠ Camera Error: ${err.message || 'Permission denied. Please allow camera or type code.'}`;
    }
  });
}

function scanQRCodeFrame() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  if (!video || !canvas || !cameraStream) return;

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.height = video.videoHeight;
    canvas.width = video.videoWidth;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let code = null;
    if (typeof jsQR !== 'undefined') {
      const qr = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });
      if (qr && qr.data) {
        code = qr.data;
      }
    }

    if (code) {
      onQRCodeSuccessfullyScanned(code);
      return;
    }
  }

  if (cameraStream) {
    scanAnimationId = requestAnimationFrame(scanQRCodeFrame);
  }
}

function onQRCodeSuccessfullyScanned(scannedCode) {
  triggerAudioBeep();

  const normCode = scannedCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  stopCameraScanner();

  if (activeScannerMode === 'NEW_BILL') {
    document.getElementById('bill-scanned-card').style.display = 'block';
    document.getElementById('bill-scanned-code-text').textContent = normCode;

    const prodSelect = document.getElementById('bill-product-select');
    if (prodSelect) {
      for (let i = 0; i < prodSelect.options.length; i++) {
        const text = prodSelect.options[i].text;
        const prefix = text.split(' - ')[0].trim();
        if (prefix && normCode.startsWith(prefix)) {
          prodSelect.selectedIndex = i;
          onBillProductSelected();
          break;
        }
      }
    }
  } else if (activeScannerMode === 'WARRANTY_REG') {
    const input = document.getElementById('w-reg-code');
    if (input) {
      input.value = normCode;
      validateWarrantySerialBeforeSubmit();
    }
  }
}

function stopCameraScanner() {
  if (scanAnimationId) {
    cancelAnimationFrame(scanAnimationId);
    scanAnimationId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  document.getElementById('modal-camera').style.display = 'none';
}

function openCustomerModal() { document.getElementById('modal-customer').style.display = 'flex'; }
function closeCustomerModal() { document.getElementById('modal-customer').style.display = 'none'; }
function openProductModal() { document.getElementById('modal-product').style.display = 'flex'; }
function closeProductModal() { document.getElementById('modal-product').style.display = 'none'; }
function openPartnerCreateModal() { openRegisterModal(); }
function togglePhoneSimulation() {
  document.body.classList.toggle('phone-simulated');
  const btn = document.getElementById('btn-phone-preview');
  if (btn) {
    if (document.body.classList.contains('phone-simulated')) {
      btn.innerHTML = '📱 Normal View';
    } else {
      btn.innerHTML = '📱 Phone View';
    }
  }
}

document.getElementById('form-customer')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('cust-name').value;
  const mobile = document.getElementById('cust-mobile').value;
  const shop_name = document.getElementById('cust-shop').value;
  const city = document.getElementById('cust-city').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/customers', 'POST', { name, mobile, shop_name, city });
      closeCustomerModal();
      alert('✓ Customer added successfully!');
      if (document.getElementById('view-new-invoice').style.display !== 'none') {
        currentInvoiceDraft.customer_id = res.id;
        initNewBillWorkflow(false);
      } else {
        loadCustomersList();
      }
    } catch (err) { alert(err.message); }
  });
});

window.allProductsMap = window.allProductsMap || {};

async function loadAdminMasterProducts() {
  const searchQ = document.getElementById('admin-prod-search')?.value.trim() || '';
  const statusF = document.getElementById('admin-prod-status-filter')?.value || 'ALL';
  const container = document.getElementById('admin-products-table-container');

  if (!container) return;
  container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading product catalogue...</div>';

  try {
    const query = new URLSearchParams({ q: searchQ, status: statusF }).toString();
    const products = await apiRequest(`/api/admin/products?${query}`);

    if (products.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No products found matching filters.</div>';
      return;
    }

    products.forEach(p => { window.allProductsMap[p.id] = p; });

    const rows = products.map((p) => `
      <tr>
        <td style="font-weight:700;">${p.model_code}</td>
        <td>
          <strong>${p.name}</strong>
          ${p.warranty_months ? `<br><small style="color:var(--text-muted);">${p.warranty_months} Months Warranty</small>` : ''}
        </td>
        <td><span class="badge" style="background:var(--bg-secondary);">${p.category || 'BATTERY'}</span></td>
        <td>₹${(p.mrp || 0).toFixed(2)}</td>
        <td style="font-weight:700; color:var(--mech-orange);">₹${p.selling_price.toFixed(2)}</td>
        <td>${p.battery_serial_required ? 'YES' : 'NO'}</td>
        <td>
          ${p.is_custom === 1 ? '<span class="badge" style="background:#8b5cf6; color:#fff;">CUSTOM</span>' : '<span class="badge" style="background:#0284c7; color:#fff;">ADMIN MASTER</span>'}
        </td>
        <td>
          <span class="status-badge status-${p.status === 'ACTIVE' ? 'active' : 'suspended'}">${p.status || 'ACTIVE'}</span>
        </td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="btn btn-secondary btn-sm" onclick="openEditProductModalById(${p.id})">✏️ Edit</button>
            <button class="btn ${p.status === 'ACTIVE' ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="toggleProductStatus('${p.id}', '${p.status || 'ACTIVE'}')">
              ${p.status === 'ACTIVE' ? '🚫 Deactivate' : '🟢 Activate'}
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="table" style="font-size:0.85rem;">
        <thead>
          <tr>
            <th>Model/SKU</th>
            <th>Product Name</th>
            <th>Category</th>
            <th>MRP</th>
            <th>Selling Price</th>
            <th>Serial Req</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--status-rejected-text); text-align:center; padding:20px;">Error: ${err.message}</div>`;
  }
}

function openAddMasterProductModal() {
  document.getElementById('prod-name').value = '';
  document.getElementById('prod-code').value = '';
  document.getElementById('prod-category').value = 'BATTERY';
  document.getElementById('prod-mrp').value = '0.00';
  document.getElementById('prod-price').value = '';
  document.getElementById('prod-warranty').value = '24';
  document.getElementById('prod-serial-req').checked = true;
  document.getElementById('prod-status').value = 'ACTIVE';
  document.getElementById('modal-product').style.display = 'flex';
}
function closeProductModal() { document.getElementById('modal-product').style.display = 'none'; }

document.getElementById('form-product')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('prod-name').value.trim();
  const model_code = document.getElementById('prod-code').value.trim();
  const category = document.getElementById('prod-category').value;
  const mrp = parseFloat(document.getElementById('prod-mrp').value || '0');
  const selling_price = parseFloat(document.getElementById('prod-price').value);
  const warranty_months = parseInt(document.getElementById('prod-warranty').value || '24');
  const battery_serial_required = document.getElementById('prod-serial-req').checked;
  const status = document.getElementById('prod-status').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest('/api/products', 'POST', {
        name, model_code, category, mrp, selling_price, warranty_months, battery_serial_required, status
      });
      closeProductModal();
      alert(res.message);
      if (document.getElementById('view-admin-products')?.style.display !== 'none') {
        loadAdminMasterProducts();
      }
      if (document.getElementById('view-new-invoice')?.style.display !== 'none') {
        initNewBillWorkflow(false);
      }
    } catch (err) { alert(err.message); }
  });
});

async function openEditProductModalById(prodId) {
  if (!prodId) return alert('Please select a product to edit.');
  let p = window.allProductsMap[prodId];
  if (!p) {
    try {
      const products = await apiRequest('/api/admin/products?status=ALL');
      (products || []).forEach(item => { window.allProductsMap[item.id] = item; });
      p = window.allProductsMap[prodId];
    } catch (err) { console.log(err); }
  }

  if (!p) return alert('Product details not found.');
  openEditProductModal(p.id, p.name, p.model_code, p.category, p.mrp, p.selling_price, p.warranty_months, p.battery_serial_required, p.status);
}

function openSelectedBillProductEdit() {
  const prodId = document.getElementById('bill-product-select')?.value;
  if (!prodId) return alert('Please select a product from the dropdown list first.');
  openEditProductModalById(prodId);
}

function openEditProductModal(id, name, code, category, mrp, price, warranty, serialReq, status) {
  document.getElementById('edit-prod-id').value = id;
  document.getElementById('edit-prod-name').value = name || '';
  document.getElementById('edit-prod-code').value = code || '';
  document.getElementById('edit-prod-category').value = category || 'BATTERY';
  document.getElementById('edit-prod-mrp').value = mrp || 0;
  document.getElementById('edit-prod-price').value = price || '';
  document.getElementById('edit-prod-warranty').value = warranty || 24;
  document.getElementById('edit-prod-serial-req').checked = (serialReq == 1);
  document.getElementById('edit-prod-status').value = status || 'ACTIVE';
  document.getElementById('modal-edit-product').style.display = 'flex';
}
function closeEditProductModal() { document.getElementById('modal-edit-product').style.display = 'none'; }

document.getElementById('form-edit-product')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prodId = document.getElementById('edit-prod-id').value;
  const name = document.getElementById('edit-prod-name').value.trim();
  const model_code = document.getElementById('edit-prod-code').value.trim();
  const category = document.getElementById('edit-prod-category').value;
  const mrp = parseFloat(document.getElementById('edit-prod-mrp').value || '0');
  const selling_price = parseFloat(document.getElementById('edit-prod-price').value);
  const warranty_months = parseInt(document.getElementById('edit-prod-warranty').value || '24');
  const battery_serial_required = document.getElementById('edit-prod-serial-req').checked;
  const status = document.getElementById('edit-prod-status').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest(`/api/admin/products/${prodId}`, 'PUT', {
        name, model_code, category, mrp, selling_price, warranty_months, battery_serial_required, status
      });
      closeEditProductModal();
      alert(res.message);
      if (document.getElementById('view-admin-products')?.style.display !== 'none') {
        loadAdminMasterProducts();
      }
      if (document.getElementById('view-new-invoice')?.style.display !== 'none') {
        initNewBillWorkflow(false);
      }
    } catch (err) { alert(err.message); }
  });
});

async function toggleProductStatus(id, currentStatus) {
  const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (!confirm(`Are you sure you want to change this product status to ${newStatus}?`)) return;

  try {
    const res = await apiRequest(`/api/admin/products/${id}`, 'PUT', { status: newStatus });
    alert(res.message);
    loadAdminMasterProducts();
  } catch (err) { alert(err.message); }
}

document.getElementById('form-edit-partner-profile')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const partnerId = document.getElementById('edit-partner-id').value;
  const name = document.getElementById('edit-partner-name').value.trim();
  const phone = document.getElementById('edit-partner-phone').value.trim();
  const shop_name = document.getElementById('edit-partner-shop').value.trim();
  const city = document.getElementById('edit-partner-city').value.trim();
  const address = document.getElementById('edit-partner-address').value.trim();
  const upi_id = document.getElementById('edit-partner-upi').value.trim();
  const status = document.getElementById('edit-partner-status').value;
  const btn = e.target.querySelector('button[type="submit"]');

  await withLoadingState(btn, async () => {
    try {
      await apiRequest(`/api/admin/sellers/${partnerId}/profile`, 'PUT', { name, phone, shop_name, city, address, upi_id, status });
      closeEditPartnerModal();
      alert('✓ Partner profile updated by Admin!');
      loadAdminSellersList();
    } catch (err) { alert(err.message); }
  });
});

// ADMIN AUDIT LOGS & DATABASE BACKUP FUNCTIONS (Phase 0.2 & 0.3)
async function loadAdminAuditLogs() {
  const container = document.getElementById('admin-audit-logs-container');
  if (!container) return;

  const q = document.getElementById('audit-log-search-input')?.value.trim() || '';
  try {
    const logs = await apiRequest(`/api/admin/audit-logs?q=${encodeURIComponent(q)}`);
    if (!logs || logs.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No audit log entries found.</div>';
      return;
    }

    let html = `
      <table class="table" style="font-size:0.82rem;">
        <thead>
          <tr>
            <th>ID</th>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Reason / Details</th>
            <th>IP Address</th>
          </tr>
        </thead>
        <tbody>
    `;

    logs.forEach(l => {
      html += `
        <tr>
          <td>#${l.id}</td>
          <td><small style="color:var(--text-muted);">${l.created_at}</small></td>
          <td><strong>${l.actor_name || 'System'}</strong><br><small>${l.actor_email || ''}</small></td>
          <td><span class="badge badge-${l.action_type.includes('CANCEL') || l.action_type.includes('DENIED') ? 'rejected' : 'active'}">${l.action_type}</span></td>
          <td>${l.target_entity} ${l.target_id ? `#${l.target_id}` : ''}</td>
          <td>${l.reason || l.new_value || '-'}</td>
          <td><code>${l.ip_address || 'local'}</code></td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:red; text-align:center; padding:12px;">${err.message}</div>`;
  }
}

async function downloadDatabaseBackup() {
  try {
    const res = await apiRequest('/api/admin/export-database');
    const jsonStr = JSON.stringify(res, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mechshakti_db_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('✓ Full Database Backup (.json) downloaded securely!');
  } catch (err) {
    alert('Backup Export Failed: ' + err.message);
  }
}

// INVOICE CANCELLATION HANDLERS (Phase 1.2)
function openCancelInvoiceModal(invId) {
  document.getElementById('cancel-invoice-id').value = invId;
  document.getElementById('cancel-invoice-reason').value = '';
  document.getElementById('modal-cancel-invoice').style.display = 'flex';
}

function closeCancelInvoiceModal() {
  document.getElementById('modal-cancel-invoice').style.display = 'none';
}

document.getElementById('form-cancel-invoice')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const invId = document.getElementById('cancel-invoice-id').value;
  const reason = document.getElementById('cancel-invoice-reason').value.trim();
  if (!reason) return alert('Please enter a cancellation reason.');

  const btn = e.target.querySelector('button[type="submit"]');
  await withLoadingState(btn, async () => {
    try {
      const res = await apiRequest(`/api/invoices/${invId}/cancel`, 'POST', { reason });
      closeCancelInvoiceModal();
      closeInvoicePreviewModal();
      alert(res.message);
      loadInvoicesList();
      if (typeof loadDashboardStats === 'function') loadDashboardStats();
    } catch (err) { alert(err.message); }
  });
});
