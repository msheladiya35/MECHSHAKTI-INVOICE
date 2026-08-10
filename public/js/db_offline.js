/* ==========================================================================
   MECHSHAKTI OFFLINE STORAGE & BACKGROUND SYNC (INDEXEDDB)
   ========================================================================== */

const OfflineDB = {
  dbName: 'mechshakti_offline_db',
  version: 1,

  // Open / Initialize IndexedDB
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pending_invoices')) {
          const store = db.createObjectStore('pending_invoices', { keyPath: 'client_nonce' });
          store.createIndex('created_at', 'created_at', { unique: false });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  // Save pending invoice to IndexedDB
  async savePendingInvoice(invoiceData) {
    const db = await this.open();
    // Generate unique nonce if not present
    if (!invoiceData.client_nonce) {
      invoiceData.client_nonce = 'OFFLINE_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    invoiceData.created_at = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_invoices', 'readwrite');
      const store = tx.objectStore('pending_invoices');
      const req = store.put(invoiceData);

      req.onsuccess = () => resolve(invoiceData);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  // Get all pending offline invoices
  async getPendingInvoices() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_invoices', 'readonly');
      const store = tx.objectStore('pending_invoices');
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  // Remove synced invoice by nonce
  async removePendingInvoice(client_nonce) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_invoices', 'readwrite');
      const store = tx.objectStore('pending_invoices');
      const req = store.delete(client_nonce);

      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  // Sync pending invoices to backend API
  async syncPendingInvoices() {
    if (!navigator.onLine) return { synced: 0, failed: 0 };
    if (!API.getToken()) return { synced: 0, failed: 0 };

    const pending = await this.getPendingInvoices();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const inv of pending) {
      try {
        const res = await API.createInvoice(inv);
        if (res && res.id) {
          await this.removePendingInvoice(inv.client_nonce);
          synced++;
        }
      } catch (err) {
        console.error('Failed to sync offline invoice:', inv.client_nonce, err);
        failed++;
      }
    }

    // Refresh current UI if active
    if (window.App && typeof window.App.refreshCurrentView === 'function') {
      window.App.refreshCurrentView();
    }

    return { synced, failed };
  }
};

// Listen for network status changes
window.addEventListener('online', () => {
  console.log('[Network] App is online. Initiating offline invoice sync...');
  const banner = document.getElementById('networkBanner');
  if (banner) {
    banner.classList.add('online-sync');
    banner.innerHTML = '⚡ Internet connection restored! Synchronizing pending sales...';
    banner.style.display = 'flex';
  }

  OfflineDB.syncPendingInvoices().then(({ synced }) => {
    if (synced > 0) {
      if (banner) {
        banner.innerHTML = `✔ Successfully synchronized ${synced} offline battery invoice(s)!`;
        setTimeout(() => { banner.style.display = 'none'; }, 4000);
      }
    } else {
      if (banner) { banner.style.display = 'none'; }
    }
  });
});

window.addEventListener('offline', () => {
  console.log('[Network] App is offline.');
  const banner = document.getElementById('networkBanner');
  if (banner) {
    banner.classList.remove('online-sync');
    banner.innerHTML = '⚠️ Offline Mode: Invoices will be saved locally and synchronized when online.';
    banner.style.display = 'flex';
  }
});
