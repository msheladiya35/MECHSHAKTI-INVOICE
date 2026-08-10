/**
 * Mechshakti Sales & Invoice Portal - Official Production Application Script
 * Features: Self Registration, Admin Approvals & Status Model Management
 */

let currentUser = null;
let currentToken = null;
let productsCache = [];
let customersCache = [];
let sellersCache = [];
let currentLedgerCustId = null;
let selectedPaymentMethod = 'CASH';
let selectedBillPaymentMethod = 'CASH';
let selectedBillPaymentMode = 'PAID';
let customerStatusFilter = 'all';
let sellerStatusFilter = 'PENDING_APPROVAL';
let reportDatePreset = 'this_month';

let activeCameraStream = null;
let scanDebounceLock = false;
let currentScannedBattery = null;
let isInlineCustomerAdd = false;

// Theme Toggle State & Persistence
let currentTheme = localStorage.getItem('mechshakti_theme') || 'dark';

function initTheme() {
  setAppTheme(currentTheme);
}

function toggleAppTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setAppTheme(currentTheme);
}

function setAppTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mechshakti_theme', theme);

  const iconEl = document.getElementById('theme-icon');
  const labelEl = document.getElementById('theme-label');
  if (iconEl && labelEl) {
    if (theme === 'light') {
      iconEl.textContent = '☀️';
      labelEl.textContent = 'Light';
    } else {
      iconEl.textContent = '🌙';
      labelEl.textContent = 'Dark';
    }
  }
}

// IndexedDB Helper for Offline Invoices
const DB_NAME = 'mechshakti_offline_db';
const STORE_NAME = 'pending_invoices';

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'client_nonce' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveOfflineInvoice(invoiceData) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(invoiceData);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOfflineInvoices() {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

async function removeOfflineInvoice(client_nonce) {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(client_nonce);
    tx.oncomplete = () => resolve();
  });
}

// -------------------------------------------------------------
// WEB AUDIO BEEP & HAPTIC VIBRATION FEEDBACK
// -------------------------------------------------------------
function playBeepSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.log('Audio beep unavailable:', e);
  }
}

function triggerVibration() {
  if ('vibrate' in navigator) {
    navigator.vibrate(150);
  }
}

// -------------------------------------------------------------
// PWA & Phone Simulation Manager
// -------------------------------------------------------------
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('btn-install-pwa');
  if (installBtn) installBtn.style.display = 'inline-flex';
});

async function triggerPWAInstall() {
  if (!deferredPrompt) {
    alert('📲 To install Mechshakti on your Phone:\n\n• Android: Tap Chrome menu (3 dots) → "Install App"\n• iPhone: Tap Safari Share icon → "Add to Home Screen"');
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('btn-install-pwa').style.display = 'none';
  }
  deferredPrompt = null;
}

function togglePhoneSimulation() {
  const body = document.body;
  const btn = document.getElementById('btn-phone-preview');
  body.classList.toggle('simulating-phone');
  
  if (body.classList.contains('simulating-phone')) {
    btn.textContent = '🖥️ Desktop View';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
  } else {
    btn.textContent = '📱 Phone View';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
  }
}

function updateNetworkStatus() {
  const statusEl = document.getElementById('network-status');
  const textEl = document.getElementById('status-text');
  if (navigator.onLine) {
    statusEl.className = 'status-pill';
    textEl.textContent = 'Online';
    syncPendingInvoices();
  } else {
    statusEl.className = 'status-pill offline';
    textEl.textContent = 'Offline';
  }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

async function syncPendingInvoices() {
  if (!navigator.onLine || !currentToken) return;
  const pending = await getOfflineInvoices();
  if (pending.length === 0) return;

  let synced = 0;
  for (const inv of pending) {
    try {
      const res = await apiRequest('/api/invoices', 'POST', inv);
      if (res && res.id) {
        await removeOfflineInvoice(inv.client_nonce);
        synced++;
      }
    } catch (e) {
      console.error('Offline sync error:', e);
    }
  }

  if (synced > 0) {
    alert(`🟢 ${synced} offline bill(s) synced successfully!`);
    loadDashboard();
    loadInvoices();
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error(err));
  });
}

// -------------------------------------------------------------
// API Helper
// -------------------------------------------------------------
async function apiRequest(path, method = 'GET', data = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  const opts = { method, headers };
  if (data) opts.body = JSON.stringify(data);

  const res = await fetch(path, opts);
  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || 'Something went wrong. Please try again.');
  }
  return json;
}

// -------------------------------------------------------------
// App Initialization & Auth Guards
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  updateNetworkStatus();

  currentToken = localStorage.getItem('mechshakti_token');
  if (currentToken) {
    try {
      const res = await apiRequest('/api/auth/me');
      currentUser = res.user;
      initAppUI();
    } catch (e) {
      logout();
    }
  } else {
    logout();
  }

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await apiRequest('/api/auth/login', 'POST', { email, password });
      currentToken = res.token;
      currentUser = res.user;
      localStorage.setItem('mechshakti_token', currentToken);
      initAppUI();
    } catch (err) {
      if (err.message.includes('pending Admin approval')) {
        showPendingConfirmationModal(
          "Account Pending Approval",
          "Your account is pending Admin approval.",
          "Please wait until your Mechshakti account is approved by Admin before logging in."
        );
      } else {
        alert(err.message);
      }
    }
  });

  document.getElementById('btn-logout').addEventListener('click', logout);
});

function logout() {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('mechshakti_token');
  document.getElementById('user-display').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('admin-pending-badge').style.display = 'none';
  
  // Hide bottom navigation bar when logged out
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) bottomNav.style.display = 'none';
  
  showView('login');
}

function initAppUI() {
  const userDisp = document.getElementById('user-display');
  userDisp.textContent = `${currentUser.name} (${currentUser.role})`;
  userDisp.style.display = 'inline-block';
  document.getElementById('btn-logout').style.display = 'inline-block';

  document.getElementById('dash-welcome-text').textContent = `Good Morning, ${currentUser.name}`;

  // Show bottom navigation bar when authenticated
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) bottomNav.style.display = 'flex';

  const sellerBtn = document.getElementById('nav-sellers-btn');
  const sellerFilterWrap = document.getElementById('admin-seller-filter-wrap');

  if (currentUser.role === 'ADMIN') {
    sellerBtn.style.display = 'flex';
    sellerFilterWrap.style.display = 'block';
    loadSellersDropdown();
  } else {
    sellerBtn.style.display = 'none';
    sellerFilterWrap.style.display = 'none';
    document.getElementById('dash-admin-approval-banner').style.display = 'none';
  }

  loadProductsCatalog();
  loadCustomers();
  switchTab('dashboard');
}

function switchTab(tabName) {
  // Security Navigation Guard: Block unauthenticated access to tabs
  if (!currentToken || !currentUser) {
    logout();
    return;
  }

  document.querySelectorAll('.bottom-nav .nav-item').forEach(el => {
    if (el.getAttribute('data-tab') === tabName) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  showView(tabName);

  if (tabName === 'dashboard') loadDashboard();
  else if (tabName === 'customers') loadCustomers();
  else if (tabName === 'new-invoice') prepareNewInvoiceForm();
  else if (tabName === 'invoices') loadInvoices();
  else if (tabName === 'reports') loadActiveReport();
  else if (tabName === 'sellers') loadSellers();
}

function showView(viewId) {
  if (viewId !== 'login' && (!currentToken || !currentUser)) {
    return logout();
  }

  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  const target = document.getElementById(`view-${viewId}`);
  if (target) target.style.display = 'block';
}

// -------------------------------------------------------------
// PARTNER SELF REGISTRATION & APPROVAL MODALS
// -------------------------------------------------------------
function openRegisterModal() {
  document.getElementById('form-register').reset();
  document.getElementById('modal-register').classList.add('active');
}

function closeRegisterModal() {
  document.getElementById('modal-register').classList.remove('active');
}

async function submitPartnerRegistration(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const mobile = document.getElementById('reg-mobile').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;
  const confirm_password = document.getElementById('reg-confirm-password').value;
  const shop_name = document.getElementById('reg-shop').value.trim();
  const city = document.getElementById('reg-city').value.trim();
  const address = document.getElementById('reg-address').value.trim();
  const gst_number = document.getElementById('reg-gst').value.trim();
  const dealer_code = document.getElementById('reg-dealer-code').value.trim();

  if (password !== confirm_password) {
    alert('Passwords do not match. Please verify.');
    return;
  }

  try {
    const res = await apiRequest('/api/auth/register', 'POST', {
      name,
      mobile,
      email,
      password,
      confirm_password,
      shop_name,
      city,
      address,
      gst_number,
      dealer_code
    });

    closeRegisterModal();
    showPendingConfirmationModal(
      "Registration Submitted Successfully",
      "Your account is waiting for Admin approval.",
      "You will be able to login after your account is approved by Mechshakti Admin."
    );
  } catch (err) {
    alert(err.message);
  }
}

function showPendingConfirmationModal(title, msg1, msg2) {
  document.getElementById('pending-modal-title').textContent = title;
  document.getElementById('pending-modal-msg1').textContent = msg1;
  document.getElementById('pending-modal-msg2').textContent = msg2;
  document.getElementById('modal-pending-confirmation').classList.add('active');
}

function closePendingConfirmationModal() {
  document.getElementById('modal-pending-confirmation').classList.remove('active');
}

// -------------------------------------------------------------
// DASHBOARD MODULE
// -------------------------------------------------------------
async function loadDashboard() {
  try {
    const stats = await apiRequest('/api/reports/dashboard?preset=today');
    document.getElementById('stat-today-sales').textContent = `₹${stats.today_sales.toLocaleString()}`;
    document.getElementById('stat-today-collected').textContent = `₹${stats.today_collected.toLocaleString()}`;
    document.getElementById('stat-total-outstanding').textContent = `₹${stats.total_outstanding.toLocaleString()}`;
    document.getElementById('stat-today-batteries').textContent = stats.today_batteries.toLocaleString();

    // Update Admin pending approvals banner & badge
    if (currentUser.role === 'ADMIN') {
      const badge = document.getElementById('admin-pending-badge');
      const countEl = document.getElementById('admin-pending-count');
      const banner = document.getElementById('dash-admin-approval-banner');
      
      const pendingCnt = stats.pending_partners_count || 0;
      if (pendingCnt > 0) {
        countEl.textContent = `[ ${pendingCnt} Pending ]`;
        badge.style.display = 'inline-flex';
        banner.style.display = 'flex';
      } else {
        badge.style.display = 'none';
        banner.style.display = 'none';
      }
    }

    const recent = await apiRequest('/api/invoices?preset=this_month');
    renderRecentInvoices(recent.slice(0, 5));
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function renderRecentInvoices(invoices) {
  const container = document.getElementById('dash-recent-invoices-list');
  if (!invoices || invoices.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No invoices generated yet</div>`;
    return;
  }

  container.innerHTML = invoices.map(i => `
    <div class="txn-card invoice" onclick="openInvoiceModal('${i.id}')">
      <div>
        <div style="font-weight:700; font-size:0.95rem;">${i.customer_name}</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">${i.invoice_number} | ${i.invoice_date}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:800; font-size:1.05rem; color:var(--mech-red);">₹${i.grand_total.toLocaleString()}</div>
        <span class="badge badge-${(i.payment_status || 'UNPAID').toLowerCase()}">${(i.payment_status || 'UNPAID').replace('_', ' ')}</span>
      </div>
    </div>
  `).join('');
}

// -------------------------------------------------------------
// CUSTOMERS & KHATA MODULE
// -------------------------------------------------------------
async function loadCustomers(selectNewCustId = null) {
  try {
    customersCache = await apiRequest('/api/customers');
    renderCustomersList(customersCache);
    updateCustomerSelectDropdowns();

    if (selectNewCustId) {
      const invSelect = document.getElementById('inv-customer-select');
      if (invSelect) {
        invSelect.value = selectNewCustId;
        onCustomerChange();
      }
    }
  } catch (err) {
    console.error('Load customers error:', err);
  }
}

function setCustomerFilter(status) {
  customerStatusFilter = status;
  document.querySelectorAll('.cust-filter-btn').forEach(btn => {
    if (btn.getAttribute('data-status') === status) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  filterCustomers();
}

function filterCustomers() {
  const q = document.getElementById('customer-search').value.toLowerCase().trim();
  let list = customersCache;

  if (customerStatusFilter === 'outstanding') {
    list = list.filter(c => c.outstanding_balance > 0);
  } else if (customerStatusFilter === 'paid') {
    list = list.filter(c => c.outstanding_balance <= 0);
  }

  if (q) {
    list = list.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.shop_name && c.shop_name.toLowerCase().includes(q)) || 
      c.mobile.includes(q)
    );
  }

  renderCustomersList(list);
}

function renderCustomersList(customers) {
  const container = document.getElementById('customers-list-container');
  if (!customers || customers.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No customers found</div>`;
    return;
  }

  container.innerHTML = customers.map(c => {
    const isOut = c.outstanding_balance > 0;
    return `
      <div class="customer-item" onclick="openCustomerLedger('${c.id}')">
        <div>
          <div class="customer-name">${c.name}</div>
          <div class="customer-sub">${c.shop_name ? `${c.shop_name} • ` : ''}${c.mobile}</div>
        </div>
        <div style="text-align:right;">
          ${isOut 
            ? `<div style="font-weight:800; font-size:1.05rem; color:var(--status-unpaid-text);">Outstanding ₹${c.outstanding_balance.toLocaleString()}</div>` 
            : `<span class="badge badge-paid">Paid ✓</span>`}
        </div>
      </div>
    `;
  }).join('');
}

async function openCustomerLedger(custId) {
  currentLedgerCustId = custId;
  showView('customer-ledger');

  try {
    const data = await apiRequest(`/api/customers/${custId}/ledger`);
    document.getElementById('ledger-cust-name').textContent = data.customer.name;
    document.getElementById('ledger-cust-sub').textContent = `${data.customer.shop_name ? `${data.customer.shop_name} | ` : ''}Mobile: ${data.customer.mobile}`;

    document.getElementById('ledger-total-bills').textContent = `₹${data.summary.total_bills.toLocaleString()}`;
    document.getElementById('ledger-total-paid').textContent = `₹${data.summary.total_paid.toLocaleString()}`;
    document.getElementById('ledger-outstanding').textContent = `₹${data.summary.outstanding.toLocaleString()}`;

    const container = document.getElementById('ledger-transactions-list');
    if (!data.transactions || data.transactions.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No transactions recorded yet</div>`;
      return;
    }

    container.innerHTML = data.transactions.map(t => {
      if (t.type === 'INVOICE') {
        return `
          <div class="txn-card invoice" onclick="openInvoiceModal('${t.id}')">
            <div>
              <div style="font-weight:700;">Invoice #${t.number}</div>
              <div style="font-size:0.8rem; color:var(--text-muted);">${t.date}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:800; color:var(--mech-red);">₹${t.amount.toLocaleString()}</div>
              <span class="badge badge-${(t.status || 'UNPAID').toLowerCase()}">${(t.status || 'UNPAID').replace('_', ' ')}</span>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="txn-card payment">
            <div>
              <div style="font-weight:700; color:var(--status-paid-text);">Payment Received (${t.method})</div>
              <div style="font-size:0.8rem; color:var(--text-muted);">${t.date} ${t.ref ? `• Ref: ${t.ref}` : ''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:800; color:var(--status-paid-text);">+ ₹${t.amount.toLocaleString()}</div>
            </div>
          </div>
        `;
      }
    }).join('');
  } catch (err) {
    alert('Failed to load ledger: ' + err.message);
  }
}

function openCustomerModal() {
  isInlineCustomerAdd = false;
  document.getElementById('form-add-customer').reset();
  document.getElementById('modal-customer').classList.add('active');
}

function openInlineCustomerModal() {
  isInlineCustomerAdd = true;
  document.getElementById('form-add-customer').reset();
  document.getElementById('modal-customer').classList.add('active');
}

function closeCustomerModal() {
  document.getElementById('modal-customer').classList.remove('active');
}

async function saveCustomer(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('cust-name').value.trim(),
    mobile: document.getElementById('cust-mobile').value.trim(),
    shop_name: document.getElementById('cust-shop').value.trim()
  };

  try {
    const res = await apiRequest('/api/customers', 'POST', data);
    closeCustomerModal();
    await loadCustomers(res.id);
    alert('Customer added successfully!');
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// PRODUCT CATALOG MANAGEMENT
// -------------------------------------------------------------
function openProductModal() {
  document.getElementById('form-add-product').reset();
  document.getElementById('modal-product').classList.add('active');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.remove('active');
}

async function saveProduct(e) {
  e.preventDefault();
  const name = document.getElementById('prod-name').value.trim();
  const model_code = document.getElementById('prod-code').value.trim().toUpperCase();
  const selling_price = parseFloat(document.getElementById('prod-price').value);
  const gst_rate = parseFloat(document.getElementById('prod-gst').value) || 18.0;

  if (!name || !model_code || selling_price <= 0) {
    alert('Please fill out all required product fields.');
    return;
  }

  try {
    const res = await apiRequest('/api/products', 'POST', {
      name,
      model_code,
      selling_price,
      gst_rate
    });
    closeProductModal();
    alert('Battery product added to catalog successfully!');
    await loadProductsCatalog();
    if (res.product) {
      quickAddBatteryToInvoice(res.product.id);
    }
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// PAYMENT RECORDING MODULE
// -------------------------------------------------------------
function openGlobalPaymentModal() {
  document.getElementById('form-record-payment').reset();
  document.getElementById('pay-invoice-id').value = '';
  document.getElementById('pay-outstanding-box').style.display = 'none';
  setPaymentMethod('CASH');
  document.getElementById('modal-payment').classList.add('active');
}

function openPaymentModalForCustomer() {
  openGlobalPaymentModal();
  if (currentLedgerCustId) {
    document.getElementById('pay-customer-select').value = currentLedgerCustId;
    onPaymentCustomerChange();
  }
}

function openPaymentModalForInvoice(invId, custId, outstanding) {
  openGlobalPaymentModal();
  document.getElementById('pay-invoice-id').value = invId;
  document.getElementById('pay-customer-select').value = custId;
  document.getElementById('pay-amount').value = outstanding;
  onPaymentCustomerChange();
}

function closePaymentModal() {
  document.getElementById('modal-payment').classList.remove('active');
}

function setPaymentMethod(method) {
  selectedPaymentMethod = method;
  document.querySelectorAll('#modal-payment .pm-pill').forEach(el => {
    if (el.getAttribute('data-method') === method) el.classList.add('active');
    else el.classList.remove('active');
  });
}

function onPaymentCustomerChange() {
  const custId = document.getElementById('pay-customer-select').value;
  const box = document.getElementById('pay-outstanding-box');
  if (!custId) {
    box.style.display = 'none';
    return;
  }
  const cust = customersCache.find(c => c.id == custId);
  if (cust && cust.outstanding_balance > 0) {
    box.style.display = 'block';
    document.getElementById('pay-outstanding-val').textContent = `₹${cust.outstanding_balance.toLocaleString()}`;
    if (!document.getElementById('pay-amount').value) {
      document.getElementById('pay-amount').value = cust.outstanding_balance;
    }
  } else {
    box.style.display = 'none';
  }
}

async function savePayment(e) {
  e.preventDefault();
  const customer_id = document.getElementById('pay-customer-select').value;
  const invoice_id = document.getElementById('pay-invoice-id').value || null;
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const reference_no = document.getElementById('pay-ref').value.trim();

  if (!customer_id || amount <= 0) {
    alert('Please select a customer and enter a valid amount.');
    return;
  }

  try {
    await apiRequest('/api/payments', 'POST', {
      customer_id: parseInt(customer_id),
      invoice_id: invoice_id ? parseInt(invoice_id) : null,
      amount,
      payment_method: selectedPaymentMethod,
      reference_no
    });
    closePaymentModal();
    alert('Payment recorded successfully!');
    loadCustomers();
    loadDashboard();
    if (currentLedgerCustId == customer_id) openCustomerLedger(customer_id);
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// BATTERY QR CAMERA SCANNER MODULE
// -------------------------------------------------------------
function openQRScannerModal() {
  scanDebounceLock = false;
  document.getElementById('manual-qr-input').value = '';
  document.getElementById('modal-qr-scanner').classList.add('active');
  startCameraScanner();
}

function closeQRScannerModal() {
  stopCameraScanner();
  document.getElementById('modal-qr-scanner').classList.remove('active');
}

async function startCameraScanner() {
  const videoEl = document.getElementById('qr-video-preview');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.log('Camera API unavailable');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    activeCameraStream = stream;
    videoEl.srcObject = stream;
    videoEl.play();
  } catch (err) {
    console.warn('Camera access error:', err);
  }
}

function stopCameraScanner() {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach(track => track.stop());
    activeCameraStream = null;
  }
}

async function processManualQRInput() {
  const code = document.getElementById('manual-qr-input').value.trim();
  if (!code) {
    alert('Please enter a battery code.');
    return;
  }
  await processBatteryCodeScan(code);
}

async function processBatteryCodeScan(code) {
  if (scanDebounceLock) return;
  scanDebounceLock = true;

  try {
    const res = await apiRequest('/api/batteries/verify-code', 'POST', { code });
    playBeepSound();
    triggerVibration();

    currentScannedBattery = res;
    closeQRScannerModal();
    displayScannedBatterySuccessCard(res);
    quickAddBatteryToInvoice(res.product.id, res.battery_code, res.mfg_period);
  } catch (err) {
    playBeepSound();
    alert('✕ Scan Error: ' + err.message);
    scanDebounceLock = false;
  }
}

function displayScannedBatterySuccessCard(data) {
  const card = document.getElementById('qr-success-card');
  card.style.display = 'block';
  document.getElementById('qr-card-prod-name').textContent = data.product.name;
  document.getElementById('qr-card-code').textContent = `Serial Code: ${data.battery_code}`;
  document.getElementById('qr-card-mfg').textContent = `Manufacturing Period: ${data.mfg_period}`;
}

function clearScannedBatteryCard() {
  currentScannedBattery = null;
  document.getElementById('qr-success-card').style.display = 'none';
}

// -------------------------------------------------------------
// BATTERY CATALOG & PRODUCTS
// -------------------------------------------------------------
async function loadProductsCatalog() {
  try {
    productsCache = await apiRequest('/api/products');
    renderQuickSelectBatteryCards();
  } catch (err) {
    console.error(err);
  }
}

function renderQuickSelectBatteryCards() {
  const container = document.getElementById('battery-quick-select-grid');
  if (!container || !productsCache) return;

  container.innerHTML = productsCache.map(p => `
    <div class="battery-card">
      <div>
        <div class="battery-card-title">${p.name}</div>
        <div class="battery-card-code">${p.model_code}</div>
        <div class="battery-card-price">₹${p.selling_price.toLocaleString()}</div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="quickAddBatteryToInvoice('${p.id}')">+ Add</button>
    </div>
  `).join('');
}

function toggleProductPresetGrid() {
  const wrap = document.getElementById('product-preset-wrapper');
  wrap.style.display = (wrap.style.display === 'none') ? 'block' : 'none';
}

function updateCustomerSelectDropdowns() {
  const options = `<option value="">-- Search Customer by Name or Mobile --</option>` + 
    customersCache.map(c => `<option value="${c.id}">${c.name} ${c.shop_name ? `(${c.shop_name})` : ''} - ${c.mobile}</option>`).join('');

  document.getElementById('inv-customer-select').innerHTML = options;
  document.getElementById('pay-customer-select').innerHTML = options;
}

// -------------------------------------------------------------
// NEW BILL MECHANIC 5-STEP FLOW
// -------------------------------------------------------------
function prepareNewInvoiceForm() {
  document.getElementById('form-invoice').reset();
  document.getElementById('customer-info-box').style.display = 'none';
  clearScannedBatteryCard();

  setPaymentMode('PAID');
  setBillPaymentMethod('CASH');

  const itemsBody = document.getElementById('invoice-items-body');
  itemsBody.innerHTML = '';
  addInvoiceItemRow();
  recalculateInvoiceTotals();
}

function setPaymentMode(mode) {
  selectedBillPaymentMode = mode;
  document.querySelectorAll('.pay-mode-pill').forEach(el => {
    if (el.getAttribute('data-mode') === mode) el.classList.add('active');
    else el.classList.remove('active');
  });

  const paySection = document.getElementById('pay-method-section');
  const partialGroup = document.getElementById('partial-amount-group');

  if (mode === 'CREDIT') {
    paySection.style.display = 'none';
    partialGroup.style.display = 'none';
  } else if (mode === 'PARTIALLY_PAID') {
    paySection.style.display = 'block';
    partialGroup.style.display = 'block';
  } else { // PAID
    paySection.style.display = 'block';
    partialGroup.style.display = 'none';
  }
  recalculateInvoiceTotals();
}

function setBillPaymentMethod(method) {
  selectedBillPaymentMethod = method;
  document.querySelectorAll('.bill-pm-pill').forEach(el => {
    if (el.getAttribute('data-method') === method) el.classList.add('active');
    else el.classList.remove('active');
  });
}

function onCustomerChange() {
  const custId = document.getElementById('inv-customer-select').value;
  const box = document.getElementById('customer-info-box');
  if (!custId) {
    box.style.display = 'none';
    return;
  }
  const cust = customersCache.find(c => c.id == custId);
  if (cust) {
    box.style.display = 'block';
    box.innerHTML = `<strong>${cust.name}</strong> ${cust.shop_name ? `(${cust.shop_name})` : ''} | Mobile: ${cust.mobile} ${cust.outstanding_balance > 0 ? `| <span style="color:var(--status-unpaid-text); font-weight:700;">Outstanding: ₹${cust.outstanding_balance}</span>` : ''}`;
  }
}

function quickAddBatteryToInvoice(prodId, batteryCode = null, mfgPeriod = null) {
  const tbody = document.getElementById('invoice-items-body');
  const firstSelect = tbody.querySelector('.item-prod-select');
  if (firstSelect && !firstSelect.value) {
    firstSelect.value = prodId;
    const tr = firstSelect.closest('tr');
    if (batteryCode) tr.setAttribute('data-battery-code', batteryCode);
    if (mfgPeriod) tr.setAttribute('data-mfg-period', mfgPeriod);
    onItemProductChange(firstSelect);
  } else {
    addInvoiceItemRow(prodId, batteryCode, mfgPeriod);
  }
}

function stepQuantity(btn, delta) {
  const tr = btn.closest('tr');
  const qtyInput = tr.querySelector('.item-qty');
  let currentVal = parseInt(qtyInput.value) || 1;
  currentVal = Math.max(1, currentVal + delta);
  qtyInput.value = currentVal;
  recalculateInvoiceTotals();
}

function addInvoiceItemRow(preselectProdId = null, batteryCode = null, mfgPeriod = null) {
  const tbody = document.getElementById('invoice-items-body');
  const tr = document.createElement('tr');
  if (batteryCode) tr.setAttribute('data-battery-code', batteryCode);
  if (mfgPeriod) tr.setAttribute('data-mfg-period', mfgPeriod);

  const productOptions = productsCache.map(p => 
    `<option value="${p.id}" ${preselectProdId == p.id ? 'selected' : ''} data-price="${p.selling_price}">${p.name} (${p.model_code}) - ₹${p.selling_price}</option>`
  ).join('');

  tr.innerHTML = `
    <td>
      <select class="form-select item-prod-select" onchange="onItemProductChange(this)" required>
        <option value="">-- Select Battery Model --</option>
        ${productOptions}
      </select>
      ${batteryCode ? `<div style="font-size:0.75rem; color:var(--accent);">Code: ${batteryCode}</div>` : ''}
    </td>
    <td>
      <div class="touch-stepper">
        <button type="button" class="touch-stepper-btn" onclick="stepQuantity(this, -1)">−</button>
        <input type="number" min="1" value="1" class="item-qty touch-stepper-val" oninput="recalculateInvoiceTotals()" required>
        <button type="button" class="touch-stepper-btn" onclick="stepQuantity(this, 1)">+</button>
      </div>
    </td>
    <td><input type="number" step="0.01" value="0.00" class="form-control item-price" oninput="recalculateInvoiceTotals()" required style="min-width: 90px;"></td>
    <td><input type="number" step="0.01" value="0.00" class="form-control item-discount" oninput="recalculateInvoiceTotals()" style="min-width: 80px;"></td>
    <td><strong class="item-total-text" style="font-size: 0.95rem;">₹0.00</strong></td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="removeInvoiceItemRow(this)">✕</button></td>
  `;

  tbody.appendChild(tr);
  if (preselectProdId) {
    const sel = tr.querySelector('.item-prod-select');
    onItemProductChange(sel);
  }
}

function onItemProductChange(selectEl) {
  const tr = selectEl.closest('tr');
  const opt = selectEl.options[selectEl.selectedIndex];
  if (opt && opt.value) {
    tr.querySelector('.item-price').value = opt.getAttribute('data-price');
  } else {
    tr.querySelector('.item-price').value = '0.00';
  }
  recalculateInvoiceTotals();
}

function removeInvoiceItemRow(btn) {
  const tbody = document.getElementById('invoice-items-body');
  if (tbody.children.length > 1) {
    btn.closest('tr').remove();
    recalculateInvoiceTotals();
  }
}

function recalculateInvoiceTotals() {
  let subtotal = 0.0;
  let totalDiscount = 0.0;
  let totalGst = 0.0;
  let grandTotal = 0.0;

  const rows = document.querySelectorAll('#invoice-items-body tr');
  rows.forEach(tr => {
    const qty = parseInt(tr.querySelector('.item-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.item-price').value) || 0.0;
    const disc = parseFloat(tr.querySelector('.item-discount').value) || 0.0;
    const gstRate = 18.0;

    const lineBase = (price * qty) - disc;
    const lineGst = lineBase * (gstRate / 100.0);
    const lineTotal = lineBase + lineGst;

    tr.querySelector('.item-total-text').textContent = `₹${lineTotal.toFixed(2)}`;

    subtotal += (price * qty);
    totalDiscount += disc;
    totalGst += lineGst;
    grandTotal += lineTotal;
  });

  document.getElementById('inv-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
  document.getElementById('inv-discount').textContent = `₹${totalDiscount.toFixed(2)}`;
  document.getElementById('inv-gst').textContent = `₹${totalGst.toFixed(2)}`;
  document.getElementById('inv-grandtotal').textContent = `₹${grandTotal.toFixed(2)}`;

  let summaryPaid = 0.0;
  if (selectedBillPaymentMode === 'PAID') {
    summaryPaid = grandTotal;
  } else if (selectedBillPaymentMode === 'PARTIALLY_PAID') {
    summaryPaid = parseFloat(document.getElementById('inv-paid-amount-input').value) || 0.0;
  } else { // CREDIT
    summaryPaid = 0.0;
  }

  const summaryOut = maxVal(0.0, grandTotal - summaryPaid);
  document.getElementById('inv-summary-paid').textContent = `₹${summaryPaid.toFixed(2)}`;
  document.getElementById('inv-summary-outstanding').textContent = `₹${summaryOut.toFixed(2)}`;
}

function maxVal(a, b) {
  return a > b ? a : b;
}

async function saveInvoice(e) {
  e.preventDefault();
  const customer_id = document.getElementById('inv-customer-select').value;
  const invoice_date = new Date().toISOString().split('T')[0];
  const paid_amount = parseFloat(document.getElementById('inv-paid-amount-input').value) || 0.0;

  const items = [];
  const rows = document.querySelectorAll('#invoice-items-body tr');
  rows.forEach(tr => {
    const product_id = tr.querySelector('.item-prod-select').value;
    if (product_id) {
      items.push({
        product_id: parseInt(product_id),
        quantity: parseInt(tr.querySelector('.item-qty').value),
        unit_price: parseFloat(tr.querySelector('.item-price').value),
        discount: parseFloat(tr.querySelector('.item-discount').value) || 0.0,
        battery_code: tr.getAttribute('data-battery-code') || null,
        mfg_period: tr.getAttribute('data-mfg-period') || null
      });
    }
  });

  if (!customer_id || items.length === 0) {
    alert('Please select a customer and add at least one battery product.');
    return;
  }

  const client_nonce = 'nonce_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const payload = {
    customer_id: parseInt(customer_id),
    invoice_date,
    items,
    client_nonce,
    payment_mode: selectedBillPaymentMode,
    payment_method: selectedBillPaymentMethod,
    paid_amount
  };

  if (!navigator.onLine) {
    await saveOfflineInvoice(payload);
    alert('🔴 Network Offline! Bill saved locally as draft. It will sync automatically when internet connects.');
    updateNetworkStatus();
    switchTab('dashboard');
    return;
  }

  try {
    const res = await apiRequest('/api/invoices', 'POST', payload);
    alert(`✓ BILL SAVED\nInvoice #${res.invoice_number} generated successfully!\nTotal: ₹${res.grand_total}`);
    openInvoiceModal(res.id);
    switchTab('invoices');
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// INVOICES HISTORY & OFFICIAL MECHSHAKTI PRINTABLE BILL
// -------------------------------------------------------------
async function loadInvoices() {
  try {
    const invoices = await apiRequest('/api/invoices?preset=this_month');
    renderInvoicesList(invoices);
  } catch (err) {
    console.error(err);
  }
}

function renderInvoicesList(invoices) {
  const container = document.getElementById('invoices-list-container');
  if (!invoices || invoices.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No invoices found</div>`;
    return;
  }

  container.innerHTML = invoices.map(i => `
    <div class="txn-card invoice" onclick="openInvoiceModal('${i.id}')">
      <div>
        <div style="font-weight:700; font-size:0.98rem;">${i.customer_name}</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">${i.invoice_number} • ${i.invoice_date} • ${i.total_batteries || 0} Batteries</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:800; font-size:1.05rem; color:var(--mech-red);">₹${i.grand_total.toLocaleString()}</div>
        <span class="badge badge-${(i.payment_status || 'UNPAID').toLowerCase()}">${(i.payment_status || 'UNPAID').replace('_', ' ')}</span>
      </div>
    </div>
  `).join('');
}

function filterInvoices() {
  const q = document.getElementById('invoice-search').value.toLowerCase().trim();
  const cards = document.querySelectorAll('#invoices-list-container .txn-card');
  cards.forEach(c => {
    const text = c.textContent.toLowerCase();
    c.style.display = text.includes(q) ? 'flex' : 'none';
  });
}

async function openInvoiceModal(invId) {
  try {
    const res = await apiRequest(`/api/invoices/${invId}`);
    const inv = res.invoice;
    const items = res.items;

    const html = `
      <div style="border-bottom: 2px solid var(--mech-red); padding-bottom: 12px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <img src="/assets/logo.png" alt="Mechshakti Logo" style="height: 48px; width: auto; margin-bottom: 6px;">
          <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">
            ${inv.seller_shop || inv.seller_name}<br>
            Shop 3 Patwa Building, Varachha Main Road, SURAT - 395006<br>
            Phone: ${inv.seller_phone || '+91 93139 23674'} | mechshakti111@gmail.com
          </div>
        </div>
        <div style="text-align: right;">
          <h3 style="margin: 0; color: var(--mech-red); letter-spacing: 0.05em;">TAX INVOICE</h3>
          <div style="font-size: 1rem; font-weight: 800; color: var(--text-main); margin-top: 4px;"># ${inv.invoice_number}</div>
          <div style="font-size: 0.82rem; color: var(--text-muted);">${inv.invoice_date}</div>
        </div>
      </div>

      <div style="background: var(--bg-header); padding: 12px; border-radius: 10px; margin-bottom: 14px; font-size: 0.85rem; border: 1px solid var(--border-color);">
        <strong>CUSTOMER DETAILS:</strong><br>
        <strong style="font-size: 0.95rem; color: var(--text-main);">${inv.customer_name}</strong> ${inv.customer_shop ? `(${inv.customer_shop})` : ''}<br>
        Mobile: ${inv.customer_mobile} ${inv.customer_city ? `| City: ${inv.customer_city}` : ''}
      </div>

      <table class="table" style="margin-bottom: 14px;">
        <thead>
          <tr>
            <th>Battery Model</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>
                <strong>${it.product_name_snapshot}</strong>
                ${it.battery_code ? `<br><small style="color:var(--accent);">Serial: ${it.battery_code} (${it.mfg_period || ''})</small>` : ''}
              </td>
              <td>${it.quantity}</td>
              <td>₹${it.unit_price}</td>
              <td><strong>₹${it.line_total.toFixed(2)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="max-width: 280px; margin-left: auto; font-size: 0.88rem; line-height: 1.6;">
        <div style="display: flex; justify-content: space-between;"><span>Taxable Amount:</span><span>₹${inv.taxable_amount.toFixed(2)}</span></div>
        <div style="display: flex; justify-content: space-between;"><span>GST (18%):</span><span>₹${inv.gst_amount.toFixed(2)}</span></div>
        <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 1.15rem; color: var(--mech-red); border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px;">
          <span>Grand Total:</span><span>₹${inv.grand_total.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: var(--status-paid-text);"><span>Paid Amount:</span><span>₹${(inv.paid_amount || 0).toFixed(2)}</span></div>
        <div style="display: flex; justify-content: space-between; color: var(--status-unpaid-text); font-weight: 700;"><span>Outstanding:</span><span>₹${inv.outstanding.toFixed(2)}</span></div>
      </div>

      ${inv.outstanding > 0 ? `
        <div style="margin-top: 16px; text-align: center;">
          <button class="btn btn-success btn-block" onclick="closeInvoiceModal(); openPaymentModalForInvoice('${inv.id}', '${inv.customer_id}', '${inv.outstanding}')">
            + Record Payment (₹${inv.outstanding})
          </button>
        </div>
      ` : ''}
    `;

    document.getElementById('invoice-modal-content').innerHTML = html;
    document.getElementById('modal-invoice-view').classList.add('active');
  } catch (err) {
    alert(err.message);
  }
}

function closeInvoiceModal() {
  document.getElementById('modal-invoice-view').classList.remove('active');
}

// -------------------------------------------------------------
// REPORTS ENGINE
// -------------------------------------------------------------
function setReportDatePreset(preset) {
  reportDatePreset = preset;
  document.querySelectorAll('.report-date-btn').forEach(btn => {
    if (btn.getAttribute('data-preset') === preset) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  loadActiveReport();
}

async function loadSellersDropdown() {
  try {
    const res = await apiRequest('/api/admin/sellers?status=ALL');
    const sellers = res.sellers || [];
    const sel = document.getElementById('rep-seller-select');
    sel.innerHTML = `<option value="">-- All Sellers / Consolidated --</option>` +
      sellers.map(s => `<option value="${s.id}">${s.name} (${s.shop_name || 'Seller'})</option>`).join('');
  } catch (e) {
    console.error(e);
  }
}

async function loadActiveReport() {
  const container = document.getElementById('report-output-container');
  container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading reports...</div>`;

  let url = `/api/reports/hierarchical?preset=${reportDatePreset}`;
  if (currentUser.role === 'ADMIN') {
    const sellerId = document.getElementById('rep-seller-select').value;
    if (sellerId) url += `&seller_id=${sellerId}`;
  }

  try {
    const data = await apiRequest(url);
    renderHierarchicalReport(data);
  } catch (err) {
    container.innerHTML = `<div style="color:var(--status-unpaid-text); padding:20px;">Error: ${err.message}</div>`;
  }
}

function renderHierarchicalReport(data) {
  const container = document.getElementById('report-output-container');
  if (!data || data.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No sales records for selected period</div>`;
    return;
  }

  container.innerHTML = data.map((seller, sIdx) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong style="color:var(--mech-red); font-size:1.05rem;">🏪 Seller: ${seller.seller_name}</strong>
        <div>
          <span class="badge badge-pending">🔋 ${seller.total_batteries} Sold</span>
          <span class="badge badge-paid">₹${seller.total_amount.toLocaleString()}</span>
        </div>
      </div>

      ${seller.customers.map(cust => `
        <div style="background:var(--bg-header); border-radius:10px; padding:12px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; font-weight:700; margin-bottom:6px;">
            <span>👥 Customer: ${cust.customer_name}</span>
            <span>${cust.total_batteries} Batteries</span>
          </div>
          <table class="table" style="font-size:0.85rem;">
            <tbody>
              ${cust.batteries.map(b => `
                <tr>
                  <td>${b.product_name} (${b.model_code})</td>
                  <td><strong>${b.quantity} units</strong></td>
                  <td>₹${b.total_amount.toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// -------------------------------------------------------------
// SELLERS & PARTNER APPROVALS MANAGEMENT (Admin)
// -------------------------------------------------------------
function setSellerFilter(status) {
  sellerStatusFilter = status;
  document.querySelectorAll('.seller-filter-btn').forEach(btn => {
    if (btn.getAttribute('data-status') === status) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  loadSellers();
}

async function loadSellers() {
  try {
    const res = await apiRequest(`/api/admin/sellers?status=${sellerStatusFilter}`);
    sellersCache = res.sellers || [];
    renderSellersList(sellersCache);

    // Update pending badge count
    const pendingCnt = res.pending_count || 0;
    const badge = document.getElementById('admin-pending-badge');
    const countEl = document.getElementById('admin-pending-count');
    if (pendingCnt > 0) {
      countEl.textContent = `[ ${pendingCnt} Pending ]`;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error(err);
  }
}

function renderSellersList(sellers) {
  const container = document.getElementById('sellers-list-container');
  if (!sellers || sellers.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No partners found in this view (${sellerStatusFilter})</div>`;
    return;
  }

  container.innerHTML = sellers.map(s => {
    const isPending = s.status === 'PENDING_APPROVAL';
    const isActive = s.status === 'ACTIVE';
    const isRejected = s.status === 'REJECTED';
    const isSuspended = s.status === 'SUSPENDED';

    let badgeClass = 'badge-pending';
    let statusLabel = 'PENDING APPROVAL';
    if (isActive) { badgeClass = 'badge-paid'; statusLabel = 'ACTIVE'; }
    else if (isRejected) { badgeClass = 'badge-unpaid'; statusLabel = 'REJECTED'; }
    else if (isSuspended) { badgeClass = 'badge-partially_paid'; statusLabel = 'SUSPENDED'; }

    return `
      <div class="card" style="margin-bottom: 12px; padding: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div style="font-weight: 800; font-size: 1.05rem;">${s.name}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">${s.shop_name || 'Partner'} ${s.city ? `• ${s.city}` : ''}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Phone: ${s.phone || 'N/A'} | ${s.email}</div>
          </div>
          <span class="badge ${badgeClass}">${statusLabel}</span>
        </div>

        ${isPending ? `
          <div style="background: rgba(2, 132, 199, 0.12); border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; font-size: 0.8rem;">
            Registered: ${s.created_at ? s.created_at.split('T')[0] : 'Recently'} ${s.dealer_code ? `| Dealer Code: ${s.dealer_code}` : ''}
          </div>
        ` : ''}

        ${isRejected && s.rejection_reason ? `
          <div style="background: var(--status-unpaid-bg); border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; font-size: 0.8rem; color: var(--status-unpaid-text);">
            Rejection Reason: ${s.rejection_reason}
          </div>
        ` : ''}

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn btn-secondary btn-sm" onclick="viewPartnerDetail('${s.id}')">VIEW</button>
          
          ${isPending ? `
            <button class="btn btn-success btn-sm" style="flex:1;" onclick="updatePartnerStatus('${s.id}', 'APPROVE')">APPROVE PARTNER</button>
            <button class="btn btn-danger btn-sm" onclick="updatePartnerStatus('${s.id}', 'REJECT')">REJECT</button>
          ` : ''}

          ${isActive ? `
            <button class="btn btn-secondary btn-sm" style="color: var(--status-unpaid-text);" onclick="updatePartnerStatus('${s.id}', 'SUSPEND')">SUSPEND</button>
          ` : ''}

          ${(isRejected || isSuspended) ? `
            <button class="btn btn-success btn-sm" style="flex:1;" onclick="updatePartnerStatus('${s.id}', 'ACTIVATE')">RE-ACTIVATE ACCOUNT</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function viewPartnerDetail(partnerId) {
  const seller = sellersCache.find(s => s.id == partnerId);
  if (!seller) return;

  const html = `
    <div style="background: var(--bg-header); padding: 14px; border-radius: 12px; margin-bottom: 14px; font-size: 0.88rem; border: 1px solid var(--border-color); line-height: 1.6;">
      <div><strong>Full Name:</strong> ${seller.name}</div>
      <div><strong>Garage / Shop Name:</strong> ${seller.shop_name || 'N/A'}</div>
      <div><strong>Mobile Number:</strong> ${seller.phone || 'N/A'}</div>
      <div><strong>Email Address:</strong> ${seller.email}</div>
      <div><strong>City:</strong> ${seller.city || 'N/A'}</div>
      <div><strong>Address:</strong> ${seller.address || 'N/A'}</div>
      <div><strong>GST Number:</strong> ${seller.gst_number || 'N/A'}</div>
      <div><strong>Dealer Code:</strong> ${seller.dealer_code || 'N/A'}</div>
      <div><strong>Registration Date:</strong> ${seller.created_at}</div>
      <div><strong>Current Account Status:</strong> <span class="badge badge-pending">${seller.status}</span></div>
    </div>

    <div style="display: flex; gap: 8px;">
      ${seller.status === 'PENDING_APPROVAL' ? `
        <button class="btn btn-success" style="flex: 1;" onclick="closePartnerDetailModal(); updatePartnerStatus('${seller.id}', 'APPROVE');">APPROVE PARTNER</button>
        <button class="btn btn-danger" onclick="closePartnerDetailModal(); updatePartnerStatus('${seller.id}', 'REJECT');">REJECT</button>
      ` : `
        <button class="btn btn-secondary btn-block" onclick="closePartnerDetailModal()">Close</button>
      `}
    </div>
  `;

  document.getElementById('partner-detail-content').innerHTML = html;
  document.getElementById('modal-partner-detail').classList.add('active');
}

function closePartnerDetailModal() {
  document.getElementById('modal-partner-detail').classList.remove('active');
}

async function updatePartnerStatus(sellerId, action) {
  let rejection_reason = '';
  if (action === 'REJECT') {
    rejection_reason = prompt('Enter rejection reason for partner (Optional):') || '';
  }

  const confirmMsg = action === 'APPROVE' 
    ? 'Are you sure you want to APPROVE this partner account?' 
    : (action === 'REJECT' ? 'Are you sure you want to REJECT this partner application?' : `Confirm ${action} partner account?`);

  if (!confirm(confirmMsg)) return;

  try {
    const res = await apiRequest(`/api/admin/sellers/${sellerId}/status`, 'PUT', {
      action,
      rejection_reason
    });

    alert(res.message);
    loadSellers();
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function openSellerModal() {
  document.getElementById('form-add-seller').reset();
  document.getElementById('modal-seller').classList.add('active');
}

function closeSellerModal() {
  document.getElementById('modal-seller').classList.remove('active');
}

async function saveSeller(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('seller-name').value.trim(),
    shop_name: document.getElementById('seller-shop').value.trim(),
    email: document.getElementById('seller-email').value.trim(),
    password: document.getElementById('seller-password').value
  };

  try {
    await apiRequest('/api/admin/sellers', 'POST', data);
    closeSellerModal();
    loadSellers();
    alert('Partner account created successfully!');
  } catch (err) {
    alert(err.message);
  }
}
