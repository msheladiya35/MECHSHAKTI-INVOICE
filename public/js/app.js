/* ==========================================================================
   MECHSHAKTI SALES INVOICE PORTAL - MAIN APPLICATION CONTROLLER
   ========================================================================== */

const App = {
  currentView: 'dashboard',
  dateFilter: { preset: 'this_month', from: '', to: '' },
  reportTab: 'hierarchical',

  init() {
    console.log('[App] Initializing Mechshakti Sales Invoice Portal...');
    this.bindGlobalEvents();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
        .catch(err => console.error('[PWA] Service Worker registration failed:', err));
    }

    // Check login state
    const user = API.getUser();
    if (!user || !API.getToken()) {
      this.renderLogin();
    } else {
      this.renderAppShell();
      this.navigate(window.location.hash.replace('#/', '') || 'dashboard');
    }
  },

  bindGlobalEvents() {
    window.addEventListener('hashchange', () => {
      const route = window.location.hash.replace('#/', '') || 'dashboard';
      if (API.getToken()) {
        this.navigate(route);
      } else {
        this.renderLogin();
      }
    });
  },

  // Refresh active view
  refreshCurrentView() {
    this.navigate(this.currentView);
  },

  // Navigation router
  navigate(viewName) {
    this.currentView = viewName;
    window.location.hash = `#/${viewName}`;
    this.updateActiveNavPill(viewName);

    switch (viewName) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'customers':
        this.renderCustomers();
        break;
      case 'new-invoice':
        this.renderNewInvoice();
        break;
      case 'invoices':
        this.renderInvoices();
        break;
      case 'reports':
        this.renderReports();
        break;
      case 'sellers':
        this.renderSellers();
        break;
      default:
        this.renderDashboard();
    }
  },

  updateActiveNavPill(viewName) {
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.dataset.route === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  },

  // Render Top Navbar & Bottom Navigation Layout
  renderAppShell() {
    const user = API.getUser();
    const isAdmin = user.role === 'ADMIN';

    const shellHtml = `
      <div id="networkBanner" class="status-banner" style="display:${navigator.onLine ? 'none' : 'flex'};">
        ⚠️ Offline Mode: Invoices will be saved locally and synchronized when online.
      </div>

      <header class="top-navbar">
        <div class="brand-container">
          <img src="/icons/icon.svg" alt="Logo" class="brand-logo">
          <div>
            <h1 class="brand-title">MECHSHAKTI</h1>
            <div class="brand-subtitle">Sales & Invoice Portal</div>
          </div>
        </div>
        <div class="user-badge">
          <div>
            <div style="font-weight:700; font-size:0.85rem;">${user.name}</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">${user.shop_name || user.email}</div>
          </div>
          <span class="role-pill ${user.role.toLowerCase()}">${user.role}</span>
          <button class="btn-logout" title="Logout" onclick="App.logout()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </header>

      <main id="mainContainer"></main>

      <nav class="bottom-nav">
        <button class="nav-item" data-route="dashboard" onclick="App.navigate('dashboard')">
          <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <span>Home</span>
        </button>
        <button class="nav-item" data-route="customers" onclick="App.navigate('customers')">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Customers</span>
        </button>
        <button class="nav-item new-invoice-btn" data-route="new-invoice" onclick="App.navigate('new-invoice')" title="New Battery Sale">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Sale</span>
        </button>
        <button class="nav-item" data-route="invoices" onclick="App.navigate('invoices')">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          <span>Invoices</span>
        </button>
        <button class="nav-item" data-route="reports" onclick="App.navigate('reports')">
          <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          <span>Reports</span>
        </button>
      </nav>

      <div id="modalContainer"></div>
    `;

    document.getElementById('app').innerHTML = shellHtml;
  },

  logout() {
    API.clearAuth();
    this.renderLogin();
  },

  // ------------------------------------------------------------------------
  // 1. AUTH LOGIN VIEW
  // ------------------------------------------------------------------------
  renderLogin() {
    const loginHtml = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
        <div class="card" style="width: 100%; max-width: 420px; padding: 32px; box-shadow: var(--shadow-lg);">
          <div style="text-align: center; margin-bottom: 28px;">
            <img src="/icons/icon.svg" alt="Mechshakti Logo" style="width: 72px; height: 72px; margin-bottom: 12px;">
            <h2 class="brand-title" style="font-size: 1.8rem; margin-bottom: 4px;">MECHSHAKTI</h2>
            <div style="color: var(--text-secondary); font-size: 0.9rem;">Sales & Invoice Portal PWA</div>
          </div>

          <div id="loginError" class="badge badge-warning" style="display:none; width:100%; padding:10px; margin-bottom:16px; text-align:center; font-size:0.85rem;"></div>

          <form id="loginForm" onsubmit="App.handleLogin(event)">
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" id="loginEmail" class="form-control" placeholder="seller1@mechshakti.com" required>
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="loginPassword" class="form-control" placeholder="••••••••" required>
            </div>
            <button type="submit" id="loginBtn" class="btn btn-primary btn-block" style="margin-top: 12px;">
              ⚡ Sign In to Portal
            </button>
          </form>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color); text-align: center; font-size: 0.75rem; color: var(--text-muted);">
            Demo Admin: admin@mechshakti.com / admin123<br>
            Demo Partner: seller1@mechshakti.com / seller123
          </div>
        </div>
      </div>
    `;

    document.getElementById('app').innerHTML = loginHtml;
  },

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errDiv = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errDiv.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = 'Signing In...';

    try {
      const res = await API.login(email, password);
      API.setAuth(res.token, res.user);
      this.renderAppShell();
      this.navigate('dashboard');
    } catch (err) {
      errDiv.innerText = err.message || 'Login failed. Please check credentials.';
      errDiv.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Sign In to Portal';
    }
  },

  // ------------------------------------------------------------------------
  // 2. DASHBOARD VIEW
  // ------------------------------------------------------------------------
  async renderDashboard() {
    const container = document.getElementById('mainContainer');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><div class="stat-value">Loading Dashboard...</div></div>`;

    try {
      const [dashData, recentInvoices] = await Promise.all([
        API.getReport('dashboard', { preset: 'this_month' }),
        API.getInvoices({ preset: 'this_month' })
      ]);

      const user = API.getUser();
      const isAdmin = user.role === 'ADMIN';

      const html = `
        <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2>Dashboard</h2>
            <div style="font-size:0.85rem; color:var(--text-secondary);">Overview for ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.navigate('new-invoice')">
            + New Sale
          </button>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-label">Batteries Sold</span>
            <span class="stat-value">${dashData.total_batteries}</span>
            <span class="stat-sub">This Month</span>
          </div>

          <div class="stat-card amber">
            <span class="stat-label">Total Revenue</span>
            <span class="stat-value">₹${dashData.total_sales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            <span class="stat-sub">${dashData.total_invoices} Total Invoices</span>
          </div>

          <div class="stat-card emerald">
            <span class="stat-label">Active Customers</span>
            <span class="stat-value">${dashData.total_customers}</span>
            <span class="stat-sub">Avg ${dashData.avg_batteries_per_invoice} qty/inv</span>
          </div>

          ${isAdmin && dashData.top_seller ? `
          <div class="stat-card purple">
            <span class="stat-label">Top Seller</span>
            <span class="stat-value" style="font-size:1.1rem;">${dashData.top_seller.name}</span>
            <span class="stat-sub">₹${dashData.top_seller.total_sales.toLocaleString()} sales</span>
          </div>
          ` : ''}
        </div>

        <!-- Top Selling Highlights -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:20px;">
          <div class="card" style="margin-bottom:0;">
            <div class="card-title">🏆 Top Selling Battery Model</div>
            ${dashData.top_battery ? `
              <div style="font-weight:700; font-size:1.1rem; color:var(--accent-amber);">${dashData.top_battery.product_name_snapshot}</div>
              <div style="font-size:0.85rem; color:var(--text-secondary);">Code: ${dashData.top_battery.model_code_snapshot} | Sold: <strong>${dashData.top_battery.total_qty} units</strong></div>
            ` : `<div style="color:var(--text-muted); font-size:0.9rem;">No sales recorded yet this month.</div>`}
          </div>

          <div class="card" style="margin-bottom:0;">
            <div class="card-title">⭐ Top Customer</div>
            ${dashData.top_customer ? `
              <div style="font-weight:700; font-size:1.1rem; color:var(--accent-emerald);">${dashData.top_customer.name}</div>
              <div style="font-size:0.85rem; color:var(--text-secondary);">${dashData.top_customer.shop_name || ''} | Spent: <strong>₹${dashData.top_customer.total_spent.toLocaleString()}</strong> (${dashData.top_customer.total_inv} inv)</div>
            ` : `<div style="color:var(--text-muted); font-size:0.9rem;">No active customer purchases yet.</div>`}
          </div>
        </div>

        <!-- Recent Sales Table -->
        <div class="card">
          <div class="card-title">
            <span>Recent Battery Sales</span>
            <button class="btn btn-secondary btn-sm" onclick="App.navigate('invoices')">View All</button>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  ${isAdmin ? '<th>Seller</th>' : ''}
                  <th>Batteries</th>
                  <th>Total</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${recentInvoices.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">No invoices found. Click + New Sale to create your first battery invoice.</td></tr>` : ''}
                ${recentInvoices.slice(0, 5).map(inv => `
                  <tr>
                    <td><strong>${inv.invoice_number}</strong></td>
                    <td>${inv.invoice_date}</td>
                    <td>${inv.customer_name}</td>
                    ${isAdmin ? `<td><span class="badge badge-info">${inv.partner_name}</span></td>` : ''}
                    <td><span class="badge badge-success">${inv.total_batteries || 0} qty</span></td>
                    <td><strong>₹${inv.grand_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="App.viewInvoice(${inv.id})">View</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="badge badge-warning">Error loading dashboard: ${err.message}</div></div>`;
    }
  },

  // ------------------------------------------------------------------------
  // 3. CUSTOMER MANAGEMENT VIEW
  // ------------------------------------------------------------------------
  async renderCustomers() {
    const container = document.getElementById('mainContainer');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><div class="stat-value">Loading Customers...</div></div>`;

    try {
      const customers = await API.getCustomers();
      const user = API.getUser();
      const isAdmin = user.role === 'ADMIN';

      const html = `
        <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h2>Customer Management</h2>
            <div style="font-size:0.85rem; color:var(--text-secondary);">${customers.length} Registered Customers</div>
          </div>
          <button class="btn btn-primary" onclick="App.openAddCustomerModal()">
            + Add Customer
          </button>
        </div>

        <div class="card" style="padding:12px; margin-bottom:16px;">
          <input type="text" id="customerSearch" class="form-control" placeholder="🔍 Search customer name, shop or mobile number..." oninput="App.filterCustomersTable()">
        </div>

        <div class="card">
          <div class="table-responsive">
            <table class="data-table" id="customersTable">
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Shop / Garage Name</th>
                  <th>Mobile</th>
                  <th>City</th>
                  ${isAdmin ? '<th>Assigned Partner</th>' : ''}
                  <th>Total Spent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${customers.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">No customers found. Click + Add Customer above.</td></tr>` : ''}
                ${customers.map(c => `
                  <tr class="cust-row" data-search="${(c.name + ' ' + (c.shop_name||'') + ' ' + c.mobile).toLowerCase()}">
                    <td><strong>${c.name}</strong></td>
                    <td>${c.shop_name || '-'}</td>
                    <td>${c.mobile}</td>
                    <td>${c.city || '-'}</td>
                    ${isAdmin ? `<td><span class="badge badge-info">${c.partner_name || 'Admin'}</span></td>` : ''}
                    <td><strong style="color:var(--accent-emerald);">₹${c.total_spent.toLocaleString('en-IN')}</strong> (${c.total_invoices} inv)</td>
                    <td>
                      <div style="display:flex; gap:6px;">
                        <button class="btn btn-secondary btn-sm" onclick="App.viewCustomerHistory(${c.id})">History</button>
                        <button class="btn btn-secondary btn-sm" onclick="App.openEditCustomerModal(${c.id})">Edit</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="badge badge-warning">Error: ${err.message}</div></div>`;
    }
  },

  filterCustomersTable() {
    const q = document.getElementById('customerSearch').value.toLowerCase();
    document.querySelectorAll('.cust-row').forEach(row => {
      const text = row.dataset.search;
      row.style.display = text.includes(q) ? '' : 'none';
    });
  },

  openAddCustomerModal() {
    const modalHtml = `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Add New Customer</h3>
            <button class="modal-close" onclick="App.closeModal()">&times;</button>
          </div>
          <form onsubmit="App.saveNewCustomer(event)">
            <div class="form-group">
              <label class="form-label">Customer Name *</label>
              <input type="text" id="custName" class="form-control" placeholder="ABC Auto Garage" required>
            </div>
            <div class="form-group">
              <label class="form-label">Garage / Shop Name</label>
              <input type="text" id="custShop" class="form-control" placeholder="ABC Workshop Center">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Mobile Number *</label>
                <input type="tel" id="custMobile" class="form-control" placeholder="9898012345" required>
              </div>
              <div class="form-group">
                <label class="form-label">City</label>
                <input type="text" id="custCity" class="form-control" placeholder="Ahmedabad">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Address</label>
              <input type="text" id="custAddress" class="form-control" placeholder="Shop 12, GIDC Market">
            </div>
            <div class="form-group">
              <label class="form-label">GST Number (Optional)</label>
              <input type="text" id="custGst" class="form-control" placeholder="24AAAAA0000A1Z5">
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Customer</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.getElementById('modalContainer').innerHTML = modalHtml;
  },

  async saveNewCustomer(e) {
    e.preventDefault();
    const data = {
      name: document.getElementById('custName').value.trim(),
      shop_name: document.getElementById('custShop').value.trim(),
      mobile: document.getElementById('custMobile').value.trim(),
      city: document.getElementById('custCity').value.trim(),
      address: document.getElementById('custAddress').value.trim(),
      gst_number: document.getElementById('custGst').value.trim()
    };

    try {
      await API.createCustomer(data);
      this.closeModal();
      this.renderCustomers();
    } catch (err) {
      alert(`Failed to save customer: ${err.message}`);
    }
  },

  async openEditCustomerModal(id) {
    try {
      const data = await API.getCustomerDetails(id);
      const cust = data.customer;

      const modalHtml = `
        <div class="modal-overlay">
          <div class="modal-content">
            <div class="modal-header">
              <h3>Edit Customer - ${cust.name}</h3>
              <button class="modal-close" onclick="App.closeModal()">&times;</button>
            </div>
            <form onsubmit="App.updateCustomer(event, ${cust.id})">
              <div class="form-group">
                <label class="form-label">Customer Name *</label>
                <input type="text" id="editCustName" class="form-control" value="${cust.name}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Garage / Shop Name</label>
                <input type="text" id="editCustShop" class="form-control" value="${cust.shop_name || ''}">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Mobile Number *</label>
                  <input type="tel" id="editCustMobile" class="form-control" value="${cust.mobile}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">City</label>
                  <input type="text" id="editCustCity" class="form-control" value="${cust.city || ''}">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Address</label>
                <input type="text" id="editCustAddress" class="form-control" value="${cust.address || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">GST Number</label>
                <input type="text" id="editCustGst" class="form-control" value="${cust.gst_number || ''}">
              </div>
              <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Update Customer</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.getElementById('modalContainer').innerHTML = modalHtml;
    } catch (err) {
      alert(`Error loading customer: ${err.message}`);
    }
  },

  async updateCustomer(e, id) {
    e.preventDefault();
    const data = {
      name: document.getElementById('editCustName').value.trim(),
      shop_name: document.getElementById('editCustShop').value.trim(),
      mobile: document.getElementById('editCustMobile').value.trim(),
      city: document.getElementById('editCustCity').value.trim(),
      address: document.getElementById('editCustAddress').value.trim(),
      gst_number: document.getElementById('editCustGst').value.trim()
    };

    try {
      await API.updateCustomer(id, data);
      this.closeModal();
      this.renderCustomers();
    } catch (err) {
      alert(`Failed to update customer: ${err.message}`);
    }
  },

  async viewCustomerHistory(id) {
    try {
      const data = await API.getCustomerDetails(id);
      const cust = data.customer;
      const invoices = data.invoices;

      const modalHtml = `
        <div class="modal-overlay">
          <div class="modal-content" style="max-width:700px;">
            <div class="modal-header">
              <div>
                <h3>${cust.name}</h3>
                <div style="font-size:0.85rem; color:var(--text-secondary);">${cust.shop_name || 'Individual Customer'} | ${cust.mobile}</div>
              </div>
              <button class="modal-close" onclick="App.closeModal()">&times;</button>
            </div>
            <div style="margin-bottom:16px;">
              <div class="badge badge-info">Total Purchases: ${invoices.length} Invoices</div>
            </div>
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Grand Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoices.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No sales history for this customer.</td></tr>` : ''}
                  ${invoices.map(inv => `
                    <tr>
                      <td><strong>${inv.invoice_number}</strong></td>
                      <td>${inv.invoice_date}</td>
                      <td><strong>₹${inv.grand_total.toFixed(2)}</strong></td>
                      <td>
                        <button class="btn btn-secondary btn-sm" onclick="App.closeModal(); App.viewInvoice(${inv.id})">View Invoice</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      document.getElementById('modalContainer').innerHTML = modalHtml;
    } catch (err) {
      alert(`Error loading history: ${err.message}`);
    }
  },

  closeModal() {
    document.getElementById('modalContainer').innerHTML = '';
  },

  // ------------------------------------------------------------------------
  // 4. NEW INVOICE / BATTERY SALE CREATOR FLOW
  // ------------------------------------------------------------------------
  async renderNewInvoice() {
    const container = document.getElementById('mainContainer');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><div class="stat-value">Loading New Invoice Creator...</div></div>`;

    try {
      const [customers, products] = await Promise.all([
        API.getCustomers(),
        API.getProducts()
      ]);

      const html = `
        <div style="margin-bottom:20px;">
          <h2>New Battery Sale Invoice</h2>
          <div style="font-size:0.85rem; color:var(--text-secondary);">Create invoice and record battery sales</div>
        </div>

        <form id="newInvoiceForm" onsubmit="App.handleSaveInvoice(event)">
          <!-- Step 1: Select Customer -->
          <div class="card">
            <div class="card-title">1. Select Customer</div>
            <div class="form-row">
              <div class="form-group">
                <select id="invCustomerSelect" class="form-control" required>
                  <option value="">-- Choose Customer --</option>
                  ${customers.map(c => `<option value="${c.id}">${c.name} ${c.shop_name ? '(' + c.shop_name + ')' : ''} - ${c.mobile}</option>`).join('')}
                </select>
              </div>
              <button type="button" class="btn btn-secondary" onclick="App.openAddCustomerModal()">+ Quick Add</button>
            </div>
          </div>

          <!-- Step 2: Line Items -->
          <div class="card">
            <div class="card-title">
              <span>2. Select Battery Products</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.addInvoiceLineItem()">+ Add Battery Item</button>
            </div>

            <div id="lineItemsContainer"></div>

            <div style="margin-top:16px; text-align:right;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.addInvoiceLineItem()">+ Add Another Battery</button>
            </div>
          </div>

          <!-- Step 3: Calculation & Totals Summary -->
          <div class="card">
            <div class="card-title">3. Invoice Summary & Tax Calculation</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
              <div>
                <div class="form-group">
                  <label class="form-label">Invoice Date</label>
                  <input type="date" id="invDate" class="form-control" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Notes / Vehicle No (Optional)</label>
                  <input type="text" id="invNotes" class="form-control" placeholder="e.g. Battery replacement for GJ01AB1234">
                </div>
              </div>

              <div style="background:rgba(15,23,42,0.6); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                  <span style="color:var(--text-secondary);">Taxable Base Amount:</span>
                  <span id="taxableText">₹0.00</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                  <span style="color:var(--text-secondary);">Total Discount:</span>
                  <span id="discountText">₹0.00</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                  <span style="color:var(--text-secondary);">GST Amount (18%):</span>
                  <span id="gstText">₹0.00</span>
                </div>
                <hr style="border-color:var(--border-color); margin:12px 0;">
                <div style="display:flex; justify-content:space-between; font-weight:800; font-size:1.3rem; color:var(--accent-amber);">
                  <span>Grand Total:</span>
                  <span id="grandTotalText">₹0.00</span>
                </div>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:12px;">
              <button type="button" class="btn btn-secondary" onclick="App.navigate('invoices')">Cancel</button>
              <button type="submit" id="saveInvoiceBtn" class="btn btn-success btn-block" style="max-width:240px;">
                ⚡ Save & Generate Invoice
              </button>
            </div>
          </div>
        </form>
      `;

      container.innerHTML = html;
      this.productsCatalog = products; // Cache catalog
      this.addInvoiceLineItem(); // Add default initial line
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="badge badge-warning">Error: ${err.message}</div></div>`;
    }
  },

  addInvoiceLineItem() {
    const container = document.getElementById('lineItemsContainer');
    const itemIndex = container.children.length;

    const lineHtml = `
      <div class="line-item-row" style="background:rgba(15,23,42,0.4); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:700; font-size:0.85rem; color:var(--accent-blue);">Item #${itemIndex + 1}</span>
          ${itemIndex > 0 ? `<button type="button" class="btn-logout" onclick="this.closest('.line-item-row').remove(); App.recalculateInvoice();" title="Remove">&times;</button>` : ''}
        </div>
        <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:10px;">
          <div>
            <label class="form-label">Battery Product *</label>
            <select class="form-control item-product" onchange="App.onLineProductChange(this)" required>
              <option value="">-- Select Battery --</option>
              ${this.productsCatalog.map(p => `<option value="${p.id}" data-price="${p.selling_price}">${p.name} (${p.model_code}) - ₹${p.selling_price}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Quantity *</label>
            <input type="number" class="form-control item-qty" min="1" value="1" oninput="App.recalculateInvoice()" required>
          </div>
          <div>
            <label class="form-label">Unit Price (₹)</label>
            <input type="number" class="form-control item-price" step="0.01" value="0.00" oninput="App.recalculateInvoice()" required>
          </div>
          <div>
            <label class="form-label">Discount (₹)</label>
            <input type="number" class="form-control item-discount" step="0.01" value="0.00" oninput="App.recalculateInvoice()">
          </div>
        </div>
        <div style="text-align:right; margin-top:8px; font-weight:700; font-size:0.9rem; color:var(--accent-emerald);">
          Line Total: ₹<span class="line-total-text">0.00</span>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', lineHtml);
  },

  onLineProductChange(selectEl) {
    const row = selectEl.closest('.line-item-row');
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const price = selectedOption.dataset.price ? parseFloat(selectedOption.dataset.price) : 0.00;
    row.querySelector('.item-price').value = price.toFixed(2);
    this.recalculateInvoice();
  },

  recalculateInvoice() {
    let taxable = 0.0;
    let discount = 0.0;
    let gst = 0.0;
    let grandTotal = 0.0;

    document.querySelectorAll('.line-item-row').forEach(row => {
      const qty = parseInt(row.querySelector('.item-qty').value || 1);
      const unitPrice = parseFloat(row.querySelector('.item-price').value || 0);
      const disc = parseFloat(row.querySelector('.item-discount').value || 0);

      const lineBase = (unitPrice * qty) - disc;
      const lineGst = lineBase * 0.18; // 18% GST rate
      const lineTotal = lineBase + lineGst;

      row.querySelector('.line-total-text').innerText = lineTotal.toFixed(2);

      taxable += lineBase;
      discount += disc;
      gst += lineGst;
      grandTotal += lineTotal;
    });

    document.getElementById('taxableText').innerText = `₹${taxable.toFixed(2)}`;
    document.getElementById('discountText').innerText = `₹${discount.toFixed(2)}`;
    document.getElementById('gstText').innerText = `₹${gst.toFixed(2)}`;
    document.getElementById('grandTotalText').innerText = `₹${grandTotal.toFixed(2)}`;
  },

  async handleSaveInvoice(e) {
    e.preventDefault();
    const customer_id = parseInt(document.getElementById('invCustomerSelect').value);
    const invoice_date = document.getElementById('invDate').value;
    const notes = document.getElementById('invNotes').value.trim();
    const btn = document.getElementById('saveInvoiceBtn');

    if (!customer_id) {
      alert('Please select a customer.');
      return;
    }

    const items = [];
    document.querySelectorAll('.line-item-row').forEach(row => {
      const prodId = parseInt(row.querySelector('.item-product').value);
      const qty = parseInt(row.querySelector('.item-qty').value);
      const price = parseFloat(row.querySelector('.item-price').value);
      const disc = parseFloat(row.querySelector('.item-discount').value);

      if (prodId && qty > 0) {
        items.push({
          product_id: prodId,
          quantity: qty,
          unit_price: price,
          discount: disc
        });
      }
    });

    if (items.length === 0) {
      alert('Please add at least one battery product item.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = 'Saving Invoice...';

    const invoicePayload = {
      customer_id,
      invoice_date,
      notes,
      items,
      client_nonce: 'NONCE_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
    };

    try {
      // Check if Online or Offline
      if (navigator.onLine) {
        const res = await API.createInvoice(invoicePayload);
        alert(`✔ Invoice #${res.invoice_number} saved successfully!`);
        this.navigate('invoices');
        this.viewInvoice(res.id);
      } else {
        // Save to IndexedDB Offline Store
        await OfflineDB.savePendingInvoice(invoicePayload);
        alert(`⚠️ Saved in Offline Mode! Invoice will sync automatically when internet returns.`);
        this.navigate('invoices');
      }
    } catch (err) {
      alert(`Error saving invoice: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Save & Generate Invoice';
    }
  },

  // ------------------------------------------------------------------------
  // 5. INVOICES & SALES HISTORY VIEW
  // ------------------------------------------------------------------------
  async renderInvoices() {
    const container = document.getElementById('mainContainer');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><div class="stat-value">Loading Sales Invoices...</div></div>`;

    try {
      const user = API.getUser();
      const isAdmin = user.role === 'ADMIN';
      const invoices = await API.getInvoices(this.dateFilter);

      const html = `
        <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h2>Sales Invoices</h2>
            <div style="font-size:0.85rem; color:var(--text-secondary);">${invoices.length} Invoices Found</div>
          </div>
          <button class="btn btn-primary" onclick="App.navigate('new-invoice')">+ New Sale</button>
        </div>

        <!-- Filter Controls -->
        <div class="card" style="padding:16px;">
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; align-items:end;">
            <div>
              <label class="form-label">Date Range Filter</label>
              <select id="invoicePresetFilter" class="form-control" onchange="App.onDatePresetChange(this.value)">
                <option value="this_month" ${this.dateFilter.preset === 'this_month' ? 'selected' : ''}>This Month</option>
                <option value="today" ${this.dateFilter.preset === 'today' ? 'selected' : ''}>Today</option>
                <option value="yesterday" ${this.dateFilter.preset === 'yesterday' ? 'selected' : ''}>Yesterday</option>
                <option value="this_week" ${this.dateFilter.preset === 'this_week' ? 'selected' : ''}>This Week</option>
                <option value="prev_week" ${this.dateFilter.preset === 'prev_week' ? 'selected' : ''}>Previous Week</option>
                <option value="prev_month" ${this.dateFilter.preset === 'prev_month' ? 'selected' : ''}>Previous Month</option>
                <option value="this_year" ${this.dateFilter.preset === 'this_year' ? 'selected' : ''}>This Year</option>
                <option value="prev_year" ${this.dateFilter.preset === 'prev_year' ? 'selected' : ''}>Previous Year</option>
              </select>
            </div>
            <div>
              <input type="text" id="invoiceSearchInput" class="form-control" placeholder="🔍 Search Invoice # or Customer..." oninput="App.filterInvoicesTable()">
            </div>
          </div>
        </div>

        <div class="card">
          <div class="table-responsive">
            <table class="data-table" id="invoicesTable">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer Name</th>
                  ${isAdmin ? '<th>Seller</th>' : ''}
                  <th>Total Batteries</th>
                  <th>Grand Total</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${invoices.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-muted);">No sales invoices match the selected filter.</td></tr>` : ''}
                ${invoices.map(inv => `
                  <tr class="inv-row" data-search="${(inv.invoice_number + ' ' + inv.customer_name).toLowerCase()}">
                    <td><strong>${inv.invoice_number}</strong></td>
                    <td>${inv.invoice_date}</td>
                    <td>${inv.customer_name}</td>
                    ${isAdmin ? `<td><span class="badge badge-info">${inv.partner_name}</span></td>` : ''}
                    <td><span class="badge badge-success">${inv.total_batteries || 0} units</span></td>
                    <td><strong style="color:var(--accent-amber);">₹${inv.grand_total.toFixed(2)}</strong></td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="App.viewInvoice(${inv.id})">Open Invoice</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="badge badge-warning">Error: ${err.message}</div></div>`;
    }
  },

  onDatePresetChange(val) {
    this.dateFilter.preset = val;
    this.renderInvoices();
  },

  filterInvoicesTable() {
    const q = document.getElementById('invoiceSearchInput').value.toLowerCase();
    document.querySelectorAll('.inv-row').forEach(row => {
      row.style.display = row.dataset.search.includes(q) ? '' : 'none';
    });
  },

  async viewInvoice(id) {
    try {
      const data = await API.getInvoiceDetails(id);
      const inv = data.invoice;
      const items = data.items;

      const modalHtml = `
        <div class="modal-overlay">
          <div class="modal-content" style="max-width:800px; padding:0;">
            <div class="modal-header" style="padding:20px; border-bottom:1px solid var(--border-color);">
              <div>
                <h3>Tax Invoice - ${inv.invoice_number}</h3>
                <div style="font-size:0.85rem; color:var(--text-secondary);">Date: ${inv.invoice_date}</div>
              </div>
              <button class="modal-close" onclick="App.closeModal()">&times;</button>
            </div>

            <div style="padding:24px;">
              <!-- Details Header Grid -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; background:rgba(15,23,42,0.5); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                <div>
                  <div style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase; font-weight:700;">Customer Info</div>
                  <div style="font-weight:700; font-size:1rem; margin-top:4px;">${inv.customer_name}</div>
                  <div style="font-size:0.85rem; color:var(--text-secondary);">${inv.customer_shop || ''}</div>
                  <div style="font-size:0.85rem; color:var(--text-secondary);">Mobile: ${inv.customer_mobile}</div>
                  ${inv.customer_city ? `<div style="font-size:0.85rem; color:var(--text-secondary);">City: ${inv.customer_city}</div>` : ''}
                </div>
                <div>
                  <div style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase; font-weight:700;">Seller / Partner</div>
                  <div style="font-weight:700; font-size:1rem; margin-top:4px;">${inv.seller_name}</div>
                  <div style="font-size:0.85rem; color:var(--text-secondary);">${inv.seller_shop}</div>
                  <div style="font-size:0.85rem; color:var(--text-secondary);">Phone: ${inv.seller_phone}</div>
                </div>
              </div>

              <!-- Line Items Table -->
              <div class="table-responsive" style="margin-bottom:20px;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Battery Description</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Discount</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map((it, idx) => `
                      <tr>
                        <td>${idx + 1}</td>
                        <td>
                          <strong>${it.product_name_snapshot}</strong><br>
                          <small style="color:var(--text-muted);">Model: ${it.model_code_snapshot}</small>
                        </td>
                        <td><span class="badge badge-success">${it.quantity}</span></td>
                        <td>₹${it.unit_price.toFixed(2)}</td>
                        <td>₹${it.discount.toFixed(2)}</td>
                        <td><strong>₹${it.line_total.toFixed(2)}</strong></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Totals Breakdown -->
              <div style="display:flex; justify-content:flex-end; margin-bottom:24px;">
                <div style="width:300px; background:rgba(15,23,42,0.8); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                  <div style="display:flex; justify-content:space-between; font-size:0.9rem; margin-bottom:6px;">
                    <span style="color:var(--text-secondary);">Taxable Amount:</span>
                    <span>₹${inv.taxable_amount.toFixed(2)}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; font-size:0.9rem; margin-bottom:6px;">
                    <span style="color:var(--text-secondary);">GST Amount:</span>
                    <span>₹${inv.gst_amount.toFixed(2)}</span>
                  </div>
                  <hr style="border-color:var(--border-color); margin:8px 0;">
                  <div style="display:flex; justify-content:space-between; font-weight:800; font-size:1.2rem; color:var(--accent-amber);">
                    <span>Grand Total:</span>
                    <span>₹${inv.grand_total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center;">
                <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
                <button class="btn btn-primary" onclick="ExportUtil.printInvoice(${JSON.stringify(inv).replace(/"/g, '&quot;')}, ${JSON.stringify(items).replace(/"/g, '&quot;')})">
                  🖨️ Print / Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      `;

      document.getElementById('modalContainer').innerHTML = modalHtml;
    } catch (err) {
      alert(`Error opening invoice: ${err.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 6. COMPREHENSIVE REPORTING SYSTEM VIEW
  // ------------------------------------------------------------------------
  async renderReports() {
    const container = document.getElementById('mainContainer');
    container.innerHTML = `<div style="text-align:center; padding:40px;"><div class="stat-value">Generating Sales Reports...</div></div>`;

    try {
      const user = API.getUser();
      const isAdmin = user.role === 'ADMIN';

      const reportData = await API.getReport(this.reportTab, this.dateFilter);

      const html = `
        <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h2>Sales & Battery Reports</h2>
            <div style="font-size:0.85rem; color:var(--text-secondary);">Structured database sales analytics</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App.exportCurrentReport()">📥 Export CSV</button>
        </div>

        <!-- Filter Selector Bar -->
        <div class="card" style="padding:16px; margin-bottom:16px;">
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; align-items:end;">
            <div>
              <label class="form-label">Date Filter Preset</label>
              <select class="form-control" onchange="App.onReportPresetChange(this.value)">
                <option value="this_month" ${this.dateFilter.preset === 'this_month' ? 'selected' : ''}>This Month</option>
                <option value="today" ${this.dateFilter.preset === 'today' ? 'selected' : ''}>Today</option>
                <option value="yesterday" ${this.dateFilter.preset === 'yesterday' ? 'selected' : ''}>Yesterday</option>
                <option value="this_week" ${this.dateFilter.preset === 'this_week' ? 'selected' : ''}>This Week</option>
                <option value="prev_week" ${this.dateFilter.preset === 'prev_week' ? 'selected' : ''}>Previous Week</option>
                <option value="prev_month" ${this.dateFilter.preset === 'prev_month' ? 'selected' : ''}>Previous Month</option>
                <option value="this_year" ${this.dateFilter.preset === 'this_year' ? 'selected' : ''}>This Year</option>
                <option value="prev_year" ${this.dateFilter.preset === 'prev_year' ? 'selected' : ''}>Previous Year</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Report Tabs Navigation -->
        <div style="display:flex; gap:8px; margin-bottom:16px; overflow-x:auto; padding-bottom:6px;">
          <button class="btn ${this.reportTab === 'hierarchical' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.switchReportTab('hierarchical')">
            🌳 Drill-Down Tree (Seller → Customer → Battery)
          </button>
          ${isAdmin ? `<button class="btn ${this.reportTab === 'seller-wise' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.switchReportTab('seller-wise')">👤 Seller-Wise</button>` : ''}
          <button class="btn ${this.reportTab === 'customer-wise' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.switchReportTab('customer-wise')">🏪 Customer-Wise</button>
          <button class="btn ${this.reportTab === 'battery-wise' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.switchReportTab('battery-wise')">🔋 Battery-Wise</button>
          <button class="btn ${this.reportTab === 'date-wise' ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.switchReportTab('date-wise')">📅 Date-Wise Timeline</button>
        </div>

        <!-- Report Body -->
        <div id="reportBody">
          ${this.renderReportTabBody(this.reportTab, reportData, isAdmin)}
        </div>
      `;

      container.innerHTML = html;
      this.currentReportData = reportData; // Store for CSV export
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="badge badge-warning">Error generating report: ${err.message}</div></div>`;
    }
  },

  onReportPresetChange(val) {
    this.dateFilter.preset = val;
    this.renderReports();
  },

  switchReportTab(tabName) {
    this.reportTab = tabName;
    this.renderReports();
  },

  renderReportTabBody(tabName, data, isAdmin) {
    if (tabName === 'hierarchical') {
      if (!data || data.length === 0) {
        return `<div class="card"><div style="text-align:center; padding:20px; color:var(--text-muted);">No sales data available for this date period.</div></div>`;
      }

      return data.map(seller => `
        <div class="tree-node">
          <div class="tree-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
            <div>
              <strong style="font-size:1.1rem; color:var(--accent-blue);">👤 ${seller.seller_name}</strong>
              <span style="font-size:0.85rem; color:var(--text-secondary); margin-left:8px;">(${seller.seller_shop})</span>
            </div>
            <div>
              <span class="badge badge-success" style="margin-right:8px;">Total: ${seller.total_batteries} Batteries</span>
              <span class="badge badge-warning">₹${seller.total_amount.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div class="tree-body" style="display:block;">
            ${seller.customers.map(cust => `
              <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-weight:700;">
                  <span style="color:var(--text-primary);">🏪 ${cust.customer_name} ${cust.customer_shop ? '(' + cust.customer_shop + ')' : ''}</span>
                  <span style="color:var(--accent-emerald);">${cust.total_batteries} Units | ₹${cust.total_amount.toLocaleString('en-IN')}</span>
                </div>

                <div class="table-responsive">
                  <table class="data-table" style="font-size:0.85rem;">
                    <thead>
                      <tr>
                        <th>Battery Product</th>
                        <th>Model Code</th>
                        <th>Quantity Sold</th>
                        <th>Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${cust.batteries.map(b => `
                        <tr>
                          <td><strong>${b.product_name}</strong></td>
                          <td><code>${b.model_code}</code></td>
                          <td><span class="badge badge-info">${b.quantity} qty</span></td>
                          <td>₹${b.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');
    } else if (tabName === 'seller-wise') {
      return `
        <div class="card">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Seller / Partner Name</th>
                  <th>Shop Name</th>
                  <th>Mobile</th>
                  <th>Customers</th>
                  <th>Invoices</th>
                  <th>Batteries Sold</th>
                  <th>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                ${data.map(s => `
                  <tr>
                    <td><strong>${s.name}</strong></td>
                    <td>${s.shop_name || '-'}</td>
                    <td>${s.phone || '-'}</td>
                    <td>${s.total_customers}</td>
                    <td>${s.total_invoices}</td>
                    <td><span class="badge badge-success">${s.batteries_sold} units</span></td>
                    <td><strong style="color:var(--accent-amber);">₹${s.total_sales.toLocaleString('en-IN')}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (tabName === 'customer-wise') {
      return `
        <div class="card">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Shop / Garage</th>
                  <th>Mobile</th>
                  ${isAdmin ? '<th>Partner</th>' : ''}
                  <th>Total Batteries Purchased</th>
                  <th>Total Spent</th>
                  <th>First Purchase</th>
                  <th>Last Purchase</th>
                </tr>
              </thead>
              <tbody>
                ${data.map(c => `
                  <tr>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.shop_name || '-'}</td>
                    <td>${c.mobile}</td>
                    ${isAdmin ? `<td><span class="badge badge-info">${c.partner_name}</span></td>` : ''}
                    <td><span class="badge badge-success">${c.total_batteries} units</span></td>
                    <td><strong style="color:var(--accent-emerald);">₹${c.total_spent.toLocaleString('en-IN')}</strong></td>
                    <td>${c.first_purchase || '-'}</td>
                    <td>${c.last_purchase || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (tabName === 'battery-wise') {
      return `
        <div class="card">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Battery Product Name</th>
                  <th>Model Code</th>
                  <th>Selling Price</th>
                  <th>Units Sold</th>
                  <th>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                ${data.map(b => `
                  <tr>
                    <td><strong>${b.name}</strong></td>
                    <td><code>${b.model_code}</code></td>
                    <td>₹${b.selling_price.toLocaleString('en-IN')}</td>
                    <td><span class="badge badge-success">${b.total_units_sold} units</span></td>
                    <td><strong style="color:var(--accent-amber);">₹${b.total_revenue.toLocaleString('en-IN')}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (tabName === 'date-wise') {
      return `
        <div class="card">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoices Issued</th>
                  <th>Batteries Sold</th>
                  <th>Daily Sales Total</th>
                </tr>
              </thead>
              <tbody>
                ${data.map(d => `
                  <tr>
                    <td><strong>${d.invoice_date}</strong></td>
                    <td>${d.invoice_count}</td>
                    <td><span class="badge badge-success">${d.batteries_sold} units</span></td>
                    <td><strong style="color:var(--accent-emerald);">₹${d.total_sales.toLocaleString('en-IN')}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
  },

  exportCurrentReport() {
    if (!this.currentReportData) return;
    ExportUtil.exportToCSV(`Mechshakti_Report_${this.reportTab}_${this.dateFilter.preset}.csv`, this.currentReportData);
  }
};

// Initialize App when DOM is loaded
document.addEventListener('DOMContentLoaded', () => App.init());
