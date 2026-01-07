let ITEMS = [];
let CART = {}; // key: item.id, value: {id, code, name, price, qty}

async function loadItems() {
  const container = document.getElementById('menu-container');
  if (container) container.innerHTML = '<div style="padding:10px;">Loading menu items...</div>';

  console.log("Fetching /api/items...");
  try {
    const res = await fetch('/api/items');
    console.log("Response status:", res.status);

    if (!res.ok) {
      throw new Error('Server returned ' + res.status);
    }

    ITEMS = await res.json();
    console.log("Items loaded:", ITEMS);

    if (!ITEMS || ITEMS.length === 0) {
      if (container) container.innerHTML = '<div style="padding:10px; color:red;">No items found in database.</div>';
      return;
    }

    renderMenu();
  } catch (e) {
    console.error("Error loading items:", e);
    if (container) container.innerHTML = `<div style="padding:10px; color:red;">Error: ${e.message}</div>`;
    alert("Failed to load menu: " + e.message);
  }
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

  /* 1. Create Bill in Backend */
  const res = await fetch('/api/bills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_name, items })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('Failed to create bill: ' + (err.error || res.statusText));
    return;
  }

  const bill = await res.json();

  /* 2. Print Thermal Receipt */
  fillPrintArea(bill);
  window.print();

  /* 3. Handle WhatsApp (if phone provided) */
  const phone = document.getElementById('customer-phone').value.trim();
  if (phone) {
    // Construct Message
    let msg = `*ICE LAND - Receipt*\n`;
    msg += `Bill No: ${bill.seq_code}\n`;
    msg += `Date: ${formatDateTime(bill.created_at)}\n`;
    if (customer_name) msg += `Name: ${customer_name}\n`;
    msg += `--------------------------------\n`;

    bill.items.forEach(it => {
      msg += `${it.name} x${it.qty} = ₹${it.line_total.toFixed(2)}\n`;
    });

    msg += `--------------------------------\n`;
    msg += `*TOTAL: ₹${bill.total_amount.toFixed(2)}*\n`;
    msg += `Thank you for visiting!`;

    // Assuming Indian numbers, prepend 91 if length is 10
    let targetPhone = phone.replace(/\D/g, ''); // strip non-digits
    if (targetPhone.length === 10) targetPhone = '91' + targetPhone;

    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;

    // Attempt auto-open (might be blocked)
    const waWindow = window.open(waUrl, '_blank');

    // If blocked (or just as backup), show a button in the cart area
    if (!waWindow || waWindow.closed || typeof waWindow.closed == 'undefined') {
      const cartPanel = document.querySelector('.cart-panel');
      let waBtn = document.getElementById('manual-wa-btn');
      if (!waBtn) {
        waBtn = document.createElement('a');
        waBtn.id = 'manual-wa-btn';
        waBtn.className = 'secondary-btn';
        waBtn.style.cssText = 'display:block; text-align:center; padding:10px; margin-top:10px; background:#25D366 !important; color:white !important; text-decoration:none; font-weight:bold;';
        waBtn.target = '_blank';
        waBtn.textContent = 'Open WhatsApp (Popup Blocked)';
        // Insert after checkout button
        const actions = document.querySelector('.cart-actions');
        if (actions) actions.appendChild(waBtn);
      }
      waBtn.href = waUrl;
      waBtn.style.display = 'block';
    }
  }

  /* 4. Cleanup */
  clearCart();
  if (nameInput) nameInput.value = '';
  // Don't clear phone immediately if we showed a backup button, but usually we do.
  // We'll leave the phone number for a moment or clear it?
  // Let's clear it to be clean, the button has the href saved.
  document.getElementById('customer-phone').value = '';
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
/* Updated Receipt HTML for Thermal Grid Layout */
function fillPrintArea(bill) {
  const div = document.getElementById('bill-print-area');
  if (!div) return;

  const itemsRows = bill.items.map(it => {
    const total = it.line_total.toFixed(2);
    // Format: Name xQty  Total
    // e.g. Vanilla x2  80.00
    return `
      <tr>
        <td class="col-item">${it.name}</td>
        <td class="col-qty">x${it.qty}</td>
        <td class="col-price">${total}</td>
      </tr>
    `;
  }).join('');

  div.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div class="r-shop-name">ICE LAND</div>
        <div class="r-shop-sub">Ice Cream & Sundaes</div>
        <div class="receipt-meta">
          <div>Bill: ${bill.seq_code || bill.bill_id}</div>
          <div>${formatDateTime(bill.created_at)}</div>
          ${bill.customer_name ? `<div>Cust: ${bill.customer_name}</div>` : ''}
        </div>
      </div>
      
      <table class="receipt-items">
        <thead>
          <tr>
            <th class="col-item">Item</th>
            <th class="col-qty">Qty</th>
            <th class="col-price">Amt</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="receipt-footer">
        <div class="receipt-total-row">
          <span>TOTAL</span>
          <span>₹${bill.total_amount.toFixed(2)}</span>
        </div>
        ${bill.status && bill.status !== 'ACTIVE' ? `<div style="text-align:center; margin-top:5px">[${bill.status}]</div>` : ''}
        <div class="receipt-thanks">Thank You!</div>
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
