/* Wholesale Demand and Inventory Decision-Support System - script.js
   The company enters its own products, sales and stock. Nothing is pre-filled.
   Everything is saved in this browser (localStorage), so it is still there next time the page opens. */

// ---------- 1. SETTINGS ----------
const DATA_KEY = "wdidss-data";
const USER_KEY = "wdidss-user";
const ROLE_NAMES = { manager: "Wholesaler / Manager", sales: "Sales staff", stock: "Stock staff" };

// ---------- 2. SMALL HELPERS ----------
function $(id) {
  return document.getElementById(id);
}

// today's date as YYYY-MM-DD in local time
function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// how many days ago a YYYY-MM-DD date was
function daysAgo(dateText) {
  return Math.round((Date.parse(today()) - Date.parse(dateText)) / 86400000);
}

function formatNumber(n) {
  return Math.round(n).toLocaleString();
}

function formatMoney(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// stops typed text (like product names) from being read as HTML
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showMessage(id, text, isError) {
  const box = $(id);
  box.textContent = text;
  box.className = isError ? "message error" : "message";
}

function emptyRow(columns, text) {
  return `<tr><td colspan="${columns}" class="empty">${text}</td></tr>`;
}

function code(prefix, number) {
  return prefix + "-" + String(number).padStart(4, "0");
}

// ---------- 3. SAVING AND LOADING DATA ----------
// matches the tables in the database design: products, sales (with sale items), stock records, reorder suggestions
function emptyData() {
  return {
    products: [],
    sales: [],
    stockRecords: [],
    suggestions: [],
    nextId: { product: 1, sale: 1, stock: 1, suggestion: 1 }
  };
}

function loadData() {
  try {
    const saved = localStorage.getItem(DATA_KEY);
    return saved ? Object.assign(emptyData(), JSON.parse(saved)) : emptyData();
  } catch (e) {
    return emptyData();
  }
}

function saveData() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch (e) {
    // storage is blocked: the data stays until the page is closed
  }
}

let data = loadData();

// ---------- 4. SIGNED-IN USER ----------
function getSignedInUser() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("role")) {
    // just came from the login page
    const newUser = { name: (params.get("name") || "User").trim(), role: params.get("role") };
    try { localStorage.setItem(USER_KEY, JSON.stringify(newUser)); } catch (e) {}
    try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
    return ROLE_NAMES[newUser.role] ? newUser : null;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY));
    return saved && ROLE_NAMES[saved.role] ? saved : null;
  } catch (e) {
    return null;
  }
}

const user = getSignedInUser();
if (!user) {
  window.location.replace("login.html"); // must log in first
} else {
  startApp();
}

// ---------- 5. PRODUCTS AND STOCK RULES ----------
function findProduct(id) {
  return data.products.find(p => p.id === id);
}

function isLow(product) {
  return product.quantity <= product.reorderLevel;
}

function addStockRecord(product, change, reason) {
  data.stockRecords.push({
    id: data.nextId.stock++,
    productId: product.id,
    productName: product.name,
    change: change,
    quantityAfter: product.quantity,
    reason: reason,
    date: today(),
    by: user.name
  });
}

function openSuggestion(product) {
  return data.suggestions.find(s => s.productId === product.id && (s.status === "Pending" || s.status === "Accepted"));
}

// runs after every stock change: creates or closes reorder suggestions
function checkStockLevel(product) {
  const open = openSuggestion(product);
  if (isLow(product)) {
    if (open) return "already-open";
    const forecast = demandFor(product.id).forecast;
    const quantity = Math.max(1, Math.ceil(forecast + product.reorderLevel - product.quantity));
    data.suggestions.push({
      id: data.nextId.suggestion++,
      productId: product.id,
      productName: product.name,
      quantity: quantity,
      status: "Pending",
      created: today()
    });
    return "created";
  }
  if (open) {
    open.status = "Completed"; // stock is back above the reorder level
    return "restored";
  }
  return "ok";
}

// ---------- 6. DEMAND ANALYSIS ----------
// adds up units sold in three 30-day periods, then works out a moving average and a trend
function demandFor(productId) {
  const periods = [0, 0, 0]; // [61-90 days ago, 31-60 days ago, last 30 days]
  data.sales.forEach(sale => {
    const age = daysAgo(sale.date);
    sale.items.forEach(item => {
      if (item.productId !== productId) return;
      if (age >= 0 && age < 30) periods[2] += item.quantity;
      else if (age >= 30 && age < 60) periods[1] += item.quantity;
      else if (age >= 60 && age < 90) periods[0] += item.quantity;
    });
  });

  const forecast = (periods[0] + periods[1] + periods[2]) / 3; // 3-period moving average
  const earlierAverage = (periods[0] + periods[1]) / 2;
  let trend = "Not enough history";
  let change = null;
  if (earlierAverage > 0) {
    change = ((periods[2] - earlierAverage) / earlierAverage) * 100;
    if (change > 10) trend = "Rising";
    else if (change < -10) trend = "Falling";
    else trend = "Stable";
  }
  return { periods, forecast, trend, change };
}

function trendText(d) {
  if (d.change === null) return d.trend;
  return `${d.trend} (${d.change > 0 ? "+" : ""}${d.change.toFixed(1)}%)`;
}

// ---------- 7. START THE PAGE ----------
function startApp() {
  // show only the links and sections this role is allowed to use
  document.querySelectorAll("[data-roles]").forEach(el => {
    if (!el.dataset.roles.split(" ").includes(user.role)) el.hidden = true;
  });

  $("user-name").textContent = user.name;
  $("user-role").textContent = ROLE_NAMES[user.role];
  $("sale-date").value = today();
  $("sale-date").max = today();

  $("logout").addEventListener("click", function () {
    try { localStorage.removeItem(USER_KEY); } catch (e) {}
  });

  $("product-form").addEventListener("submit", addProduct);
  $("stock-form").addEventListener("submit", recordStockReceived);
  $("sale-form").addEventListener("submit", recordSale);
  $("suggestion-rows").addEventListener("click", reviewSuggestion);
  $("report-form").addEventListener("submit", generateReport);
  $("search").addEventListener("input", renderStockTable);
  $("clear-data").addEventListener("click", clearAllData);

  renderAll();
}

// ---------- 8. FORMS ----------
function addProduct(event) {
  event.preventDefault();
  const name = $("product-name").value.trim();
  const price = Number($("product-price").value);
  const opening = Number($("product-opening").value);
  const reorderLevel = Number($("product-reorder").value);

  if (name === "") return showMessage("product-message", "Enter a product name.", true);
  if (data.products.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return showMessage("product-message", `${name} has already been added.`, true);
  }
  if (!(price >= 0)) return showMessage("product-message", "Unit price must be 0 or more.", true);
  if (!Number.isInteger(opening) || opening < 0) return showMessage("product-message", "Opening stock must be a whole number, 0 or more.", true);
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return showMessage("product-message", "Reorder level must be a whole number, 0 or more.", true);

  const product = { id: data.nextId.product++, name: name, unitPrice: price, quantity: opening, reorderLevel: reorderLevel };
  data.products.push(product);
  addStockRecord(product, opening, "Opening stock");
  const result = checkStockLevel(product);
  saveData();

  $("product-form").reset();
  let text = `${name} added with ${formatNumber(opening)} in stock.`;
  if (result === "created") text += " It is already at or below its reorder level, so a reorder suggestion was created.";
  showMessage("product-message", text, false);
  renderAll();
}

function recordStockReceived(event) {
  event.preventDefault();
  const product = findProduct(Number($("stock-product").value));
  const quantity = Number($("stock-qty").value);

  if (!product) return showMessage("stock-message", "Select a product.", true);
  if (!Number.isInteger(quantity) || quantity < 1) return showMessage("stock-message", "Quantity received must be a whole number, 1 or more.", true);

  product.quantity += quantity;
  addStockRecord(product, quantity, "Stock received");
  const result = checkStockLevel(product);
  saveData();

  $("stock-form").reset();
  let text = `${formatNumber(quantity)} × ${product.name} recorded. Stock is now ${formatNumber(product.quantity)}.`;
  if (result === "restored") text += " It is back above the reorder level, so its reorder suggestion is now Completed.";
  if (result === "already-open" || result === "created") text += " It is still at or below the reorder level.";
  showMessage("stock-message", text, false);
  renderAll();
}

function recordSale(event) {
  event.preventDefault();
  const product = findProduct(Number($("sale-product").value));
  const quantity = Number($("sale-qty").value);
  const date = $("sale-date").value;

  if (!product) return showMessage("sale-message", "Select a product.", true);
  if (!Number.isInteger(quantity) || quantity < 1) return showMessage("sale-message", "Quantity must be a whole number, 1 or more.", true);
  if (!date) return showMessage("sale-message", "Enter the sale date.", true);
  if (date > today()) return showMessage("sale-message", "The sale date cannot be in the future.", true);
  if (quantity > product.quantity) {
    return showMessage("sale-message", `Only ${formatNumber(product.quantity)} × ${product.name} in stock. Record the stock received first.`, true);
  }

  // a sale contains sale items (one product per sale on this form)
  const id = data.nextId.sale++;
  const sale = {
    id: id,
    code: code("S", id),
    date: date,
    items: [{ productId: product.id, productName: product.name, quantity: quantity, unitPrice: product.unitPrice }],
    total: quantity * product.unitPrice,
    recordedBy: user.name
  };
  data.sales.push(sale);

  product.quantity -= quantity;
  addStockRecord(product, -quantity, "Sale " + sale.code);
  const result = checkStockLevel(product);
  saveData();

  $("sale-form").reset();
  $("sale-date").value = today();
  let text = `Sale ${sale.code} saved: ${formatNumber(quantity)} × ${product.name} = KSh ${formatMoney(sale.total)}. Stock left: ${formatNumber(product.quantity)}.`;
  if (result === "created") text += " Stock has reached the reorder level, so a reorder suggestion was sent to the manager.";
  if (result === "already-open") text += " Stock is still low and a reorder suggestion is already waiting.";
  showMessage("sale-message", text, false);
  renderAll();
}

// manager accepts (with the quantity in the box) or rejects a suggestion
function reviewSuggestion(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const suggestion = data.suggestions.find(s => s.id === Number(button.dataset.id));
  if (!suggestion || suggestion.status !== "Pending") return;

  if (button.dataset.action === "accept") {
    const quantity = Number($("qty-" + suggestion.id).value);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return showMessage("reorder-message", "The quantity must be a whole number, 1 or more.", true);
    }
    if (quantity !== suggestion.quantity) {
      suggestion.originalQuantity = suggestion.quantity;
      suggestion.quantity = quantity;
    }
    suggestion.status = "Accepted";
    showMessage("reorder-message", `Accepted: order ${formatNumber(quantity)} × ${suggestion.productName}. Record the stock when it arrives.`, false);
  } else {
    suggestion.status = "Rejected";
    showMessage("reorder-message", `Rejected the suggestion for ${suggestion.productName}.`, false);
  }
  suggestion.decidedBy = user.name;
  suggestion.decidedOn = today();
  saveData();
  renderAll();
}

function clearAllData() {
  if (!confirm("Delete ALL products, sales, stock records and reorder suggestions saved in this browser? This cannot be undone.")) return;
  data = emptyData();
  saveData();
  $("report-output").innerHTML = "";
  showMessage("report-message", "All data has been deleted.", false);
  renderAll();
}

// ---------- 9. SHOWING THE DATA ----------
function renderAll() {
  renderProductOptions();
  renderDashboard();
  renderStockTable();
  renderStockHistory();
  renderDemand();
  renderSuggestions();
  renderAside();
}

function renderProductOptions() {
  ["sale-product", "stock-product"].forEach(id => {
    const select = $(id);
    const current = select.value;
    select.innerHTML = '<option value="">-- Select a product --</option>' +
      data.products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${formatNumber(p.quantity)} in stock)</option>`).join("");
    if (data.products.some(p => String(p.id) === current)) select.value = current;
  });
}

function renderDashboard() {
  $("card-products").textContent = data.products.length;
  $("card-alerts").textContent = data.products.filter(isLow).length;
  $("card-suggestions").textContent = data.suggestions.filter(s => s.status === "Pending").length;

  if (data.products.length === 0) {
    $("dashboard-summary").textContent = "No products yet. Start by adding your products under Products & Stock, then record sales as they happen.";
  } else {
    let units = 0;
    let value = 0;
    data.sales.forEach(sale => {
      const age = daysAgo(sale.date);
      if (age >= 0 && age < 30) {
        sale.items.forEach(item => { units += item.quantity; });
        value += sale.total;
      }
    });
    $("dashboard-summary").textContent = `Sales in the last 30 days: ${formatNumber(units)} units worth KSh ${formatMoney(value)}.`;
  }

  const recent = data.sales.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 5);
  $("recent-sales").innerHTML = recent.length === 0
    ? emptyRow(6, "No sales recorded yet.")
    : recent.map(sale => {
        const item = sale.items[0];
        return `<tr><td>${sale.code}</td><td>${sale.date}</td><td>${escapeHtml(item.productName)}</td>` +
               `<td>${formatNumber(item.quantity)}</td><td>${formatMoney(sale.total)}</td><td>${escapeHtml(sale.recordedBy)}</td></tr>`;
      }).join("");
}

function renderStockTable() {
  const search = $("search").value.trim().toLowerCase();
  const list = data.products.filter(p => p.name.toLowerCase().includes(search));
  let rows;
  if (data.products.length === 0) rows = emptyRow(5, "No products yet. Add your first product above.");
  else if (list.length === 0) rows = emptyRow(5, "No products match your search.");
  else rows = list.map(p =>
    `<tr><td>${escapeHtml(p.name)}</td><td>${formatMoney(p.unitPrice)}</td><td>${formatNumber(p.quantity)}</td><td>${formatNumber(p.reorderLevel)}</td>` +
    `<td>${isLow(p) ? '<span class="low">Low stock</span>' : '<span class="ok">OK</span>'}</td></tr>`).join("");
  $("stock-rows").innerHTML = rows;
}

function renderStockHistory() {
  const recent = data.stockRecords.slice(-10).reverse(); // latest 10 changes
  $("stock-history").innerHTML = recent.length === 0
    ? emptyRow(6, "No stock changes yet.")
    : recent.map(r =>
        `<tr><td>${r.date}</td><td>${escapeHtml(r.productName)}</td><td>${r.change > 0 ? "+" : ""}${formatNumber(r.change)}</td>` +
        `<td>${formatNumber(r.quantityAfter)}</td><td>${escapeHtml(r.reason)}</td><td>${escapeHtml(r.by)}</td></tr>`).join("");
}

function renderDemand() {
  $("demand-rows").innerHTML = data.products.length === 0
    ? emptyRow(6, "Demand analysis appears once products and sales are recorded.")
    : data.products.map(p => {
        const d = demandFor(p.id);
        return `<tr><td>${escapeHtml(p.name)}</td><td>${formatNumber(d.periods[0])}</td><td>${formatNumber(d.periods[1])}</td>` +
               `<td>${formatNumber(d.periods[2])}</td><td>${formatNumber(d.forecast)}</td><td>${trendText(d)}</td></tr>`;
      }).join("");
}

function renderSuggestions() {
  const list = data.suggestions.slice().reverse(); // newest first
  $("suggestion-rows").innerHTML = list.length === 0
    ? emptyRow(6, "No reorder suggestions yet. They appear when a product reaches its reorder level.")
    : list.map(s => {
        let action;
        if (s.status === "Pending") {
          action = `<input type="number" class="qty-input" id="qty-${s.id}" min="1" step="1" value="${s.quantity}" aria-label="Quantity to order">` +
                   `<button type="button" data-action="accept" data-id="${s.id}">Accept</button> ` +
                   `<button type="button" class="secondary" data-action="reject" data-id="${s.id}">Reject</button>`;
        } else if (s.status === "Accepted") {
          action = `Accepted by ${escapeHtml(s.decidedBy)} on ${s.decidedOn}` + (s.originalQuantity ? ` (changed from ${s.originalQuantity})` : "");
        } else if (s.status === "Rejected") {
          action = `Rejected by ${escapeHtml(s.decidedBy)} on ${s.decidedOn}`;
        } else {
          action = "Stock received";
        }
        return `<tr><td>${code("R", s.id)}</td><td>${escapeHtml(s.productName)}</td><td>${formatNumber(s.quantity)}</td>` +
               `<td>${s.created}</td><td>${s.status}</td><td>${action}</td></tr>`;
      }).join("");
}

function renderAside() {
  const low = data.products.filter(isLow);
  $("alert-list").innerHTML = low.length === 0
    ? "<li>No stock risks right now.</li>"
    : low.map(p => `<li><strong>${escapeHtml(p.name)}</strong>: ${formatNumber(p.quantity)} left (reorder level ${formatNumber(p.reorderLevel)})</li>`).join("");

  const watch = data.products
    .map(p => ({ product: p, demand: demandFor(p.id) }))
    .filter(x => x.demand.trend === "Rising" || x.demand.trend === "Falling");
  $("demand-watch").innerHTML = watch.length === 0
    ? "<li>No big changes in demand.</li>"
    : watch.map(x => `<li><strong>${escapeHtml(x.product.name)}</strong>: demand ${trendText(x.demand).toLowerCase()}</li>`).join("");
}

// ---------- 10. REPORTS ----------
function buildTable(headers, rows, emptyText) {
  const body = rows.length === 0
    ? emptyRow(headers.length, emptyText)
    : rows.map(r => "<tr>" + r.map(cell => `<td>${cell}</td>`).join("") + "</tr>").join("");
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function generateReport(event) {
  event.preventDefault();
  const type = $("report-type").value;
  const from = $("report-from").value;
  const to = $("report-to").value;
  if (from && to && from > to) return showMessage("report-message", "The From date must be before the To date.", true);
  showMessage("report-message", "", false);

  const inRange = date => (!from || date >= from) && (!to || date <= to);
  const period = from || to ? ` (${from || "start"} to ${to || "today"})` : " (all dates)";
  let html = "";

  if (type === "sales") {
    const totals = {};
    let count = 0;
    let units = 0;
    let value = 0;
    data.sales.filter(s => inRange(s.date)).forEach(sale => {
      count++;
      sale.items.forEach(item => {
        const t = totals[item.productName] || (totals[item.productName] = { units: 0, value: 0 });
        t.units += item.quantity;
        t.value += item.quantity * item.unitPrice;
        units += item.quantity;
        value += item.quantity * item.unitPrice;
      });
    });
    const rows = Object.keys(totals)
      .sort((a, b) => totals[b].units - totals[a].units)
      .map(name => [escapeHtml(name), formatNumber(totals[name].units), formatMoney(totals[name].value)]);
    if (rows.length > 0) rows.push(["<strong>Total</strong>", `<strong>${formatNumber(units)}</strong>`, `<strong>${formatMoney(value)}</strong>`]);
    html = `<h3>Sales summary${period}</h3><p>${count} sale(s) recorded.</p>` +
           buildTable(["Product", "Units sold", "Value (KSh)"], rows, "No sales in this period.");
  } else if (type === "stock" || type === "low") {
    const list = type === "low" ? data.products.filter(isLow) : data.products;
    const rows = list.map(p => [escapeHtml(p.name), formatNumber(p.quantity), formatNumber(p.reorderLevel), isLow(p) ? "Low stock" : "OK"]);
    html = `<h3>${type === "low" ? "Low-stock items" : "Stock levels"} (as of ${today()})</h3>` +
           buildTable(["Product", "Available qty", "Reorder level", "Status"], rows, type === "low" ? "No products are low on stock." : "No products yet.");
  } else {
    const rows = data.suggestions.filter(s => inRange(s.created))
      .map(s => [code("R", s.id), escapeHtml(s.productName), formatNumber(s.quantity), s.created, s.status]);
    html = `<h3>Reorder suggestions${period}</h3>` +
           buildTable(["ID", "Product", "Quantity", "Created", "Status"], rows, "No reorder suggestions in this period.");
  }
  $("report-output").innerHTML = html;
}
