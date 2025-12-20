let ITEMS = [];
let CART = {}; // key: item.id, value: {id, code, name, price, qty}

async function loadItems() {
  const res = await fetch('/api/items');
  if (!res.ok) {
    alert('Failed to load menu items');
    return;
  }
  ITEMS = await res.json();
  renderMenu();
}

function groupByCategory(items) {
  const groups = {};
  for (const it of items) {
    if (!groups[it.category]) groups[it.category] = [];
    groups[it.category].push(it);
  }
  return groups;
}

function renderMenu() {
  const container = document.getElementById('menu-container');
  if (!container) return;
  container.innerHTML = '';
  const groups = groupByCategory(ITEMS);
  Object.keys(groups).forEach(cat => {
    const section = document.createElement('div');
    section.className = 'menu-category';

    const h3 = document.createElement('h3');
    h3.textContent = cat;
    section.appendChild(h3);

    const row = document.createElement('div');
    row.className = 'menu-items';

    groups[cat].forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'menu-item-btn';
      btn.innerHTML = `
        <span class="menu-item-name">${item.name}</span>
        <span class="menu-item-price">${item.code} • ₹${item.price.toFixed(2)}</span>
      `;
      btn.addEventListener('click', () => addToCart(item));
      row.appendChild(btn);
    });

    section.appendChild(row);
    container.appendChild(section);
  });
}

function addToCart(item) {
  if (!CART[item.id]) {
    CART[item.id] = {
      id: item.id,
      code: item.code,
      name: item.name,
      price: item.price,
      qty: 0
    };
  }
  CART[item.id].qty += 1;
  renderCart();
}

function changeQty(itemId, delta) {
  const row = CART[itemId];
  if (!row) return;
  row.qty += delta;
  if (row.qty <= 0) {
    delete CART[itemId];
  }
  renderCart();
}

function clearCart() {
  CART = {};
  renderCart();
}

function renderCart() {
  const tbody = document.querySelector('#cart-table tbody');
  const totalSpan = document.getElementById('cart-total-amount');
  if (!tbody || !totalSpan) return;

  tbody.innerHTML = '';
  let total = 0;

  Object.values(CART).forEach(row => {
    const tr = document.createElement('tr');
    const lineTotal = row.qty * row.price;
    total += lineTotal;

    tr.innerHTML = `
      <td>${row.code}</td>
      <td>${row.name}</td>
      <td>
        <button type="button" onclick="changeQty(${row.id}, -1)">-</button>
        ${row.qty}
        <button type="button" onclick="changeQty(${row.id}, 1)">+</button>
      </td>
      <td>₹${lineTotal.toFixed(2)}</td>
      <td><button type="button" onclick="removeItem(${row.id})">x</button></td>
    `;
    tbody.appendChild(tr);
  });

  totalSpan.textContent = total.toFixed(2);
}

function removeItem(itemId) {
  delete CART[itemId];
  renderCart();
}

async function checkout() {
  const items = Object.values(CART).map(r => ({
    item_id: r.id,
    qty: r.qty
  }));
  if (!items.length) {
    alert('Cart is empty');
    return;
  }
  const nameInput = document.getElementById('customer-name');
  const customer_name = nameInput ? nameInput.value.trim() : '';

  const res = await fetch('/api/bills', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({customer_name, items})
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('Failed to create bill: ' + (err.error || res.statusText));
    return;
  }
  const bill = await res.json();
  fillPrintArea(bill);
  window.print();
  clearCart();
  if (nameInput) nameInput.value = '';
}

function formatDateTime(isoString) {
  const dt = new Date(isoString);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}`;
}

/**
 * Build a proper receipt layout in HTML instead of plain text
 */
function fillPrintArea(bill) {
  const div = document.getElementById('bill-print-area');
  if (!div) return;

  const itemsRows = bill.items.map(it => {
    const name = it.name;
    const qty = it.qty;
    const price = it.price.toFixed(2);
    const total = it.line_total.toFixed(2);
    return `
      <tr>
        <td class="r-item-name">${name}</td>
        <td class="r-item-qty">${qty}</td>
        <td class="r-item-price">₹${price}</td>
        <td class="r-item-total">₹${total}</td>
      </tr>
    `;
  }).join('');

  div.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-logo-row">
          <img src="/static/logo.png" class="receipt-logo" alt="Logo">
          <div class="receipt-title">
            <div class="r-shop-name">ICE LAND</div>
            <div class="r-shop-sub">Ice Cream & Sundaes</div>
          </div>
        </div>
        <div class="receipt-meta">
          <div>Bill No: <strong>${bill.seq_code || bill.bill_id}</strong></div>
          <div>Date: ${formatDateTime(bill.created_at)}</div>
          ${bill.customer_name ? `<div>Name: ${bill.customer_name}</div>` : ''}
          ${bill.user ? `<div>Staff: ${bill.user}</div>` : ''}
        </div>
      </div>
      <div class="receipt-body">
        <table class="receipt-items">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Amt</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
      </div>
      <div class="receipt-footer">
        <div class="receipt-total-row">
          <span>Total (incl. GST)</span>
          <span class="r-total-amt">₹${bill.total_amount.toFixed(2)}</span>
        </div>
        ${bill.status && bill.status !== 'ACTIVE' ? `
        <div class="receipt-status">
          STATUS: ${bill.status}
        </div>` : ''}
        <div class="receipt-thanks">
          Thank you! Visit again.
        </div>
      </div>
    </div>
  `;
}

async function reopenLastBill() {
  const res = await fetch('/api/bills/last');
  if (!res.ok) {
    alert('No previous bills found');
    return;
  }
  const bill = await res.json();
  fillPrintArea(bill);
  window.print();
}

async function reprintByCode() {
  const input = document.getElementById('reprint-code');
  if (!input || !input.value.trim()) {
    alert('Enter a bill number like IL00005');
    return;
  }
  const code = input.value.trim();
  const res = await fetch('/api/bills/by_seq/' + encodeURIComponent(code));
  if (!res.ok) {
    alert('Bill not found');
    return;
  }
  const bill = await res.json();
  fillPrintArea(bill);
  window.print();
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('menu-container')) {
    loadItems();
  }

  const clearBtn = document.getElementById('clear-cart');
  if (clearBtn) clearBtn.addEventListener('click', clearCart);

  const checkoutBtn = document.getElementById('checkout');
  if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);

  const lastBtn = document.getElementById('reopen-last');
  if (lastBtn) lastBtn.addEventListener('click', reopenLastBill);

  const reprintBtn = document.getElementById('reprint-btn');
  if (reprintBtn) reprintBtn.addEventListener('click', reprintByCode);
});
