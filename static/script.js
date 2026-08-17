let ITEMS = [];
let CART = {}; // key: cartKey, value: {id, code, name, price, qty, custom_flavors: [{flavor_id, qty}]}
let CLASSIC_FLAVORS = [];

async function loadItems() {
  const container = document.getElementById('menu-container');
  if (container) container.innerHTML = '<div style="padding:10px;">Loading menu items...</div>';

  console.log("Fetching /api/items...");
  try {
    const res = await fetch('/api/items');
    const flavorsRes = await fetch('/api/flavors/classic');
    
    if (!res.ok || !flavorsRes.ok) {
      throw new Error('Server returned error');
    }

    ITEMS = await res.json();
    CLASSIC_FLAVORS = await flavorsRes.json();
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

function addToCart(item, customFlavors = null) {
  let cartKey = item.id.toString();
  
  if (item.name.includes("5 Wonders") || item.name.includes("7 Wonders")) {
    if (!customFlavors) {
      // Need to prompt for flavors
      openCustomFlavorModal(item);
      return;
    }
    // Generate unique key for this custom item
    cartKey = item.id + '_' + Date.now();
  }

  if (!CART[cartKey]) {
    CART[cartKey] = {
      id: item.id,
      code: item.code,
      name: item.name,
      price: item.price,
      qty: 0,
      custom_flavors: customFlavors || []
    };
  }
  CART[cartKey].qty += 1;
  renderCart();
}

function changeQty(cartKey, delta) {
  const row = CART[cartKey];
  if (!row) return;
  row.qty += delta;
  if (row.qty <= 0) {
    delete CART[cartKey];
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

  Object.keys(CART).forEach(cartKey => {
    const row = CART[cartKey];
    const tr = document.createElement('tr');
    const lineTotal = row.qty * row.price;
    total += lineTotal;
    
    let flavorText = '';
    if (row.custom_flavors && row.custom_flavors.length > 0) {
      flavorText = '<br><small style="color:#666;">' + row.custom_flavors.map(cf => cf.qty + 'x ' + cf.flavor_name).join(', ') + '</small>';
    }

    tr.innerHTML = `
      <td>${row.code}</td>
      <td>${row.name}${flavorText}</td>
      <td>
        <button type="button" onclick="changeQty('${cartKey}', -1)">-</button>
        ${row.qty}
        <button type="button" onclick="changeQty('${cartKey}', 1)">+</button>
      </td>
      <td>₹${lineTotal.toFixed(2)}</td>
      <td><button type="button" onclick="removeItem('${cartKey}')">x</button></td>
    `;
    tbody.appendChild(tr);
  });

  totalSpan.textContent = total.toFixed(2);
}

function removeItem(itemId) {
  delete CART[itemId];
  renderCart();
}


// --- Refactored Checkout Logic ---


async function createBill() {
  console.log("createBill called");
  const items = Object.values(CART).map(r => ({
    item_id: r.id,
    qty: r.qty,
    custom_flavors: r.custom_flavors
  }));

  if (!items.length) {
    alert('Cart is empty');
    return null;
  }
  const nameInput = document.getElementById('customer-name');
  const customer_name = nameInput ? nameInput.value.trim() : '';
  const phoneInput = document.getElementById('customer-phone');
  // Store phone in a temporary variable if needed, but we read it from input in sendWhatsApp

  const res = await fetch('/api/bills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_name, items })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('Failed to create bill: ' + (err.error || res.statusText));
    return null;
  }

  const bill = await res.json();
  return bill;
}

function printBill(bill) {
  fillPrintArea(bill);
  window.print();
}

function sendWhatsApp(bill) {
  const phoneInput = document.getElementById('customer-phone');
  // If we are doing "Last Bill" checkout, the input might be empty.
  // We can try to rely on input but if empty maybe ask user? 
  // For now, let's just ready from input. Ideally we should have saved phone on bill in backend.
  // Since backend 'Bill' model doesn't seem to have phone, we rely on input value.

  let phone = '';
  if (phoneInput && phoneInput.value.trim()) {
    phone = phoneInput.value.trim();
  } else {
    // If no phone in input, maybe ask? 
    // For simplified flow, we will alert if missing.
    const p = prompt("Enter Customer Phone Number for WhatsApp", "");
    if (p) phone = p.trim();
  }

  if (!phone) {
    alert("Phone number is required for WhatsApp");
    return;
  }

  // Construct Message
  let msg = `*ICE LAND - Receipt*\n`;
  msg += `Bill No: ${bill.seq_code}\n`;
  msg += `Date: ${formatDateTime(bill.created_at)}\n`;
  if (bill.customer_name) msg += `Name: ${bill.customer_name}\n`;
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

  // Attempt auto-open
  window.open(waUrl, '_blank');
}


async function handleSaveCheckout() {
  const btn = document.getElementById('btn-save-checkout');
  if (btn) btn.disabled = true;

  try {
    const bill = await createBill();
    if (!bill) {
      if (btn) btn.disabled = false;
      return;
    }
    alert('Bill ' + bill.seq_code + ' saved successfully!');
    finishCheckout();
  } catch (e) {
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handlePrintCheckout() {
  const btn = document.getElementById('btn-print-checkout');
  if (btn) btn.disabled = true;

  try {
    const bill = await createBill();
    if (!bill) {
      if (btn) btn.disabled = false;
      return;
    }
    printBill(bill);
    finishCheckout();
  } catch (e) {
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleWACheckout() {
  const btn = document.getElementById('btn-wa-checkout');
  if (btn) btn.disabled = true;

  try {
    const bill = await createBill();
    if (!bill) {
      if (btn) btn.disabled = false;
      return;
    }
    sendWhatsApp(bill);
    finishCheckout();
  } catch (e) {
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}


function finishCheckout() {
  clearCart();
  const nameInput = document.getElementById('customer-name');
  if (nameInput) nameInput.value = '';
  // Keep phone number for a moment or clear? 
  // Let's clear to be clean.
  const phoneInput = document.getElementById('customer-phone');
  if (phoneInput) phoneInput.value = '';
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
    let fText = '';
    if (it.custom_flavors && it.custom_flavors.length > 0) {
      fText = '<div style="font-size:0.8em; color:#555;">' + it.custom_flavors.map(cf => cf.qty + 'x ' + cf.name).join(', ') + '</div>';
    }
    return `
      <tr>
        <td class="col-item">${it.name}${fText}</td>
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

// --- Last Bill Actions ---

async function fetchLastBill() {
  const res = await fetch('/api/bills/last');
  if (!res.ok) {
    alert('No previous bills found');
    return null;
  }
  return await res.json();
}

async function lastBillPrint() {
  const bill = await fetchLastBill();
  if (bill) printBill(bill);
}

async function lastBillWA() {
  const bill = await fetchLastBill();
  if (bill) sendWhatsApp(bill);
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

  /* New Buttons */
  const btnSave = document.getElementById('btn-save-checkout');
  if (btnSave) btnSave.addEventListener('click', handleSaveCheckout);

  const btnPrint = document.getElementById('btn-print-checkout');
  if (btnPrint) btnPrint.addEventListener('click', handlePrintCheckout);

  const btnWA = document.getElementById('btn-wa-checkout');
  if (btnWA) btnWA.addEventListener('click', handleWACheckout);

  const btnLastPrint = document.getElementById('last-print-btn');
  if (btnLastPrint) btnLastPrint.addEventListener('click', lastBillPrint);

  const btnLastWA = document.getElementById('last-wa-btn');
  if (btnLastWA) btnLastWA.addEventListener('click', lastBillWA);


  const reprintBtn = document.getElementById('reprint-btn');
  if (reprintBtn) reprintBtn.addEventListener('click', reprintByCode);
});

// --- Custom Flavor Modal Logic ---
let targetScoopCount = 0;
let currentCustomItem = null;

function openCustomFlavorModal(item) {
  currentCustomItem = item;
  targetScoopCount = item.name.includes("7 Wonders") ? 7 : 5;
  
  document.getElementById('custom-flavor-target').innerText = targetScoopCount;
  document.getElementById('custom-flavor-target-display').innerText = targetScoopCount;
  document.getElementById('custom-flavor-count').innerText = 0;
  
  const list = document.getElementById('custom-flavor-list');
  list.innerHTML = '';
  
  CLASSIC_FLAVORS.forEach(f => {
    const div = document.createElement('div');
    div.style = "display:flex; justify-content:space-between; margin-bottom:5px; align-items:center;";
    div.innerHTML = `
      <span>${f.name}</span>
      <div>
        <button class="qty-btn minus" data-id="${f.id}" type="button" style="width:25px;">-</button>
        <span class="f-qty" data-id="${f.id}" data-name="${f.name}" style="display:inline-block; width:20px; text-align:center;">0</span>
        <button class="qty-btn plus" data-id="${f.id}" type="button" style="width:25px;">+</button>
      </div>
    `;
    list.appendChild(div);
  });
  
  document.getElementById('custom-flavor-modal').style.display = 'flex';
  updateFlavorModalState();
  
  // Attach event listeners to new buttons
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      const span = document.querySelector(`.f-qty[data-id="${id}"]`);
      let qty = parseInt(span.innerText);
      
      if (this.classList.contains('plus')) {
        qty++;
      } else if (qty > 0) {
        qty--;
      }
      
      span.innerText = qty;
      updateFlavorModalState();
    });
  });
}

function updateFlavorModalState() {
  let total = 0;
  document.querySelectorAll('.f-qty').forEach(span => {
    total += parseInt(span.innerText);
  });
  
  document.getElementById('custom-flavor-count').innerText = total;
  
  const confirmBtn = document.getElementById('custom-flavor-confirm');
  if (total === targetScoopCount) {
    confirmBtn.disabled = false;
  } else {
    confirmBtn.disabled = true;
  }
}

document.getElementById('custom-flavor-cancel')?.addEventListener('click', () => {
  document.getElementById('custom-flavor-modal').style.display = 'none';
});

document.getElementById('custom-flavor-confirm')?.addEventListener('click', () => {
  if (document.getElementById('custom-flavor-confirm').disabled) return;
  
  const customFlavors = [];
  document.querySelectorAll('.f-qty').forEach(span => {
    const qty = parseInt(span.innerText);
    if (qty > 0) {
      customFlavors.push({
        flavor_id: span.getAttribute('data-id'),
        flavor_name: span.getAttribute('data-name'),
        qty: qty
      });
    }
  });
  
  document.getElementById('custom-flavor-modal').style.display = 'none';
  addToCart(currentCustomItem, customFlavors);
});
