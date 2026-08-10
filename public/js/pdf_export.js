/* ==========================================================================
   MECHSHAKTI INVOICE PRINT & REPORT EXPORT (CSV / PDF) MODULE
   ========================================================================== */

const ExportUtil = {
  // Trigger Print for Invoice modal / element
  printInvoice(invoiceData, itemsData) {
    const printWindow = window.open('', '_blank');
    const itemsHtml = itemsData.map((item, idx) => `
      <tr>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:center;">${idx + 1}</td>
        <td style="padding:10px; border:1px solid #cbd5e1;">
          <strong>${item.product_name_snapshot}</strong><br>
          <small style="color:#64748b;">Code: ${item.model_code_snapshot}</small>
        </td>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:center;">${item.quantity}</td>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:right;">₹${item.unit_price.toFixed(2)}</td>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:right;">₹${item.discount.toFixed(2)}</td>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:right;">${item.gst_rate}%</td>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:right;">₹${item.line_total.toFixed(2)}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice - ${invoiceData.invoice_number}</title>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px; }
          .header-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          .brand-title { font-size: 24px; font-weight: bold; color: #1e3a8a; }
          .invoice-title { font-size: 28px; font-weight: bold; color: #3b82f6; text-align: right; }
          .details-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          .details-table td { width: 50%; vertical-align: top; padding: 8px; border: 1px solid #e2e8f0; background: #f8fafc; }
          .items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          .items-table th { background: #1e293b; color: #ffffff; padding: 10px; border: 1px solid #1e293b; font-size: 12px; text-transform: uppercase; }
          .totals-table { width: 320px; float: right; border-collapse: collapse; margin-bottom: 24px; }
          .totals-table td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
          .grand-total { font-weight: bold; font-size: 18px; color: #1e3a8a; background: #eff6ff; }
          .footer { clear: both; text-align: center; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td>
              <div class="brand-title">MECHSHAKTI POWER SYSTEMS</div>
              <div style="font-size:13px; color:#475569;">${invoiceData.seller_shop || 'Authorized Battery Sales & Service Partner'}</div>
              <div style="font-size:12px; color:#64748b;">Phone: ${invoiceData.seller_phone || 'N/A'}</div>
            </td>
            <td style="text-align:right;">
              <div class="invoice-title">TAX INVOICE</div>
              <div style="font-weight:bold; font-size:14px;"># ${invoiceData.invoice_number}</div>
              <div style="font-size:12px; color:#64748b;">Date: ${invoiceData.invoice_date}</div>
            </td>
          </tr>
        </table>

        <table class="details-table">
          <tr>
            <td>
              <strong style="color:#1e3a8a;">CUSTOMER DETAILS</strong><br>
              <strong>${invoiceData.customer_name}</strong><br>
              ${invoiceData.customer_shop ? invoiceData.customer_shop + '<br>' : ''}
              Mobile: ${invoiceData.customer_mobile}<br>
              ${invoiceData.customer_address ? invoiceData.customer_address + ', ' : ''} ${invoiceData.customer_city || ''}<br>
              ${invoiceData.customer_gst ? 'GSTIN: ' + invoiceData.customer_gst : ''}
            </td>
            <td>
              <strong style="color:#1e3a8a;">ISSUED BY</strong><br>
              <strong>${invoiceData.seller_name}</strong><br>
              ${invoiceData.seller_shop}<br>
              Authorized Mechshakti Seller
            </td>
          </tr>
        </table>

        <table class="items-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Battery / Product Description</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Discount</th>
              <th>GST %</th>
              <th>Total Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <table class="totals-table">
          <tr>
            <td>Taxable Amount:</td>
            <td style="text-align:right;">₹${invoiceData.taxable_amount.toFixed(2)}</td>
          </tr>
          <tr>
            <td>Total Discount:</td>
            <td style="text-align:right;">₹${invoiceData.discount_amount.toFixed(2)}</td>
          </tr>
          <tr>
            <td>GST Amount:</td>
            <td style="text-align:right;">₹${invoiceData.gst_amount.toFixed(2)}</td>
          </tr>
          <tr class="grand-total">
            <td>Grand Total:</td>
            <td style="text-align:right;">₹${invoiceData.grand_total.toFixed(2)}</td>
          </tr>
        </table>

        <div class="footer">
          Thank you for your business! Mechshakti Batteries - Maximum Power & Unmatched Warranty.<br>
          This is a computer-generated tax invoice created via Mechshakti Partner Portal.
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  },

  // Export array of objects to CSV download file
  exportToCSV(filename, rows) {
    if (!rows || !rows.length) {
      alert('No data available to export.');
      return;
    }

    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => headers.map(header => {
        let val = row[header] === null || row[header] === undefined ? '' : row[header];
        if (typeof val === 'string') {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
