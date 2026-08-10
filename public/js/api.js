/* ==========================================================================
   MECHSHAKTI API CLIENT & JWT SESSION MANAGER
   ========================================================================== */

const API = {
  // Get stored JWT token
  getToken() {
    return localStorage.getItem('mechshakti_token');
  },

  // Store JWT token & user object
  setAuth(token, user) {
    localStorage.setItem('mechshakti_token', token);
    localStorage.setItem('mechshakti_user', JSON.stringify(user));
  },

  // Clear session
  clearAuth() {
    localStorage.removeItem('mechshakti_token');
    localStorage.removeItem('mechshakti_user');
  },

  // Get logged in user details
  getUser() {
    const u = localStorage.getItem('mechshakti_user');
    return u ? JSON.parse(u) : null;
  },

  // Make authenticated API request
  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      method: options.method || 'GET',
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    };

    try {
      const response = await fetch(endpoint, config);
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        this.clearAuth();
        window.location.hash = '#/login';
        throw new Error(data.error || 'Session expired. Please log in again.');
      }

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // Auth Methods
  login(email, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
  },

  getMe() {
    return this.request('/api/auth/me');
  },

  // Admin Seller Management
  getSellers() {
    return this.request('/api/admin/sellers');
  },

  createSeller(sellerData) {
    return this.request('/api/admin/sellers', {
      method: 'POST',
      body: sellerData
    });
  },

  updateSeller(id, sellerData) {
    return this.request(`/api/admin/sellers/${id}`, {
      method: 'PUT',
      body: sellerData
    });
  },

  // Customer Management
  getCustomers(sellerId = null) {
    const url = sellerId ? `/api/customers?seller_id=${sellerId}` : '/api/customers';
    return this.request(url);
  },

  getCustomerDetails(id) {
    return this.request(`/api/customers/${id}`);
  },

  createCustomer(custData) {
    return this.request('/api/customers', {
      method: 'POST',
      body: custData
    });
  },

  updateCustomer(id, custData) {
    return this.request(`/api/customers/${id}`, {
      method: 'PUT',
      body: custData
    });
  },

  // Product Master Catalog
  getProducts() {
    return this.request('/api/products');
  },

  createProduct(prodData) {
    return this.request('/api/products', {
      method: 'POST',
      body: prodData
    });
  },

  // Invoices & Sales
  getInvoices(filters = {}) {
    const query = new URLSearchParams();
    if (filters.preset) query.append('preset', filters.preset);
    if (filters.from) query.append('from', filters.from);
    if (filters.to) query.append('to', filters.to);
    if (filters.seller_id) query.append('seller_id', filters.seller_id);
    if (filters.customer_id) query.append('customer_id', filters.customer_id);
    if (filters.product_id) query.append('product_id', filters.product_id);

    const queryString = query.toString();
    return this.request(`/api/invoices${queryString ? '?' + queryString : ''}`);
  },

  getInvoiceDetails(id) {
    return this.request(`/api/invoices/${id}`);
  },

  createInvoice(invoiceData) {
    return this.request('/api/invoices', {
      method: 'POST',
      body: invoiceData
    });
  },

  // Reports API
  getReport(type, filters = {}) {
    const query = new URLSearchParams();
    if (filters.preset) query.append('preset', filters.preset);
    if (filters.from) query.append('from', filters.from);
    if (filters.to) query.append('to', filters.to);
    if (filters.seller_id) query.append('seller_id', filters.seller_id);

    const queryString = query.toString();
    return this.request(`/api/reports/${type}${queryString ? '?' + queryString : ''}`);
  }
};
