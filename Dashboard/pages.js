// =====================================================================
// pages.js - the sidebar menu and every page except the Dashboard.
// Loads LAST (after data.js and dashboard.js).
// =====================================================================

var TITLES = {
  dashboard: "Owner Dashboard", appointments: "Appointments", transactions: "Transactions",
  deliveries: "Deliveries", expenses: "Expenses", reports: "Income Reports"
};
var RENDER = {};          // RENDER.pageName() redraws that page
var current = "dashboard";
var fromAppt = "";        // appointment being turned into a transaction
var txShown = 15;
var apptTab = "today";
var repMode = "month";

// ===================== MENU / PAGE SWITCHING =====================
function showPage() {
  var name = location.hash.replace("#", "") || "dashboard";
  if (!TITLES[name]) name = "dashboard";
  current = name;
  document.querySelectorAll(".page").forEach(function (p) { p.hidden = p.id !== "page-" + name; });
  document.querySelectorAll(".side a[data-page]").forEach(function (a) {
    a.classList.toggle("active", a.dataset.page === name);
  });
  $("pageTitle").textContent = TITLES[name];
  document.title = TITLES[name] + " - Wash Track System";
  refresh();
  window.scrollTo(0, 0);
}

function refresh() {
  if (current === "dashboard") drawDashboard();
  else RENDER[current]();
  updateBadges();
}

function updateBadges() {
  var today = todayISO();
  setBadge("b-appt", DB.appt.filter(function (a) { return a.date === today && a.status === "Booked"; }).length);
  setBadge("b-tx", DB.tx.filter(function (t) { return t.status !== "Completed"; }).length);
  setBadge("b-dlv", DB.tx.filter(function (t) {
    return t.delivery && t.status !== "Completed" &&
      (t.delivery.status === "In transit" || t.delivery.status === "Returned" || t.status === "Ready");
  }).length);
}
function setBadge(id, n) { $(id).textContent = n || ""; $(id).hidden = !n; }

var toastTimer;
function toast(html) {
  var t = $("toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 4000);
}

function downloadCSV(filename, rows) {
  var csv = rows.map(function (r) {
    return r.map(function (v) {
      var s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }).join("\r\n");
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

function newest(list) {
  return list.slice().sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
}
function staffSelect(current, kind, id) {
  return '<select class="mini" data-assign="' + kind + '" data-id="' + id + '" aria-label="Staff">' +
    '<option value="">Assign staff</option>' +
    STAFF.map(function (s) { return "<option" + (s === current ? " selected" : "") + ">" + s + "</option>"; }).join("") +
    "</select>";
}

// ===================== APPOINTMENTS =====================
RENDER.appointments = function () {
  var today = todayISO();
  document.querySelectorAll("#apptTabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === apptTab); });
  var list = DB.appt.filter(function (a) {
    return apptTab === "today" ? a.date === today : apptTab === "upcoming" ? a.date > today : a.date < today;
  }).sort(function (a, b) {
    var c = a.date.localeCompare(b.date) || slotMinutes(a.slot) - slotMinutes(b.slot);
    return apptTab === "past" ? -c : c;
  });
  $("apptCount").textContent = list.length + " appointment" + (list.length === 1 ? "" : "s");
  $("apptBody").innerHTML = list.length ? list.map(function (a) {
    var actions = "", status = '<span class="st s-p">Booked</span>', staff = a.type === "Home pickup" ? esc(a.staff || "—") : "—";
    if (a.status === "Done") {
      status = '<span class="st s-d">Done</span>';
      actions = a.txId ? '<span class="muted">' + a.txId + "</span>" : "";
    } else if (a.status === "Cancelled") {
      status = '<span class="st s-x">Cancelled</span>';
    } else {
      if (a.type === "Home pickup") {
        staff = staffSelect(a.staff, "appt", a.id);
        actions = '<button class="btn sm" data-act="arrive" data-id="' + a.id + '"' + (a.staff ? "" : " disabled title=\"Assign staff first\"") + ">Picked up</button>";
      } else {
        actions = '<button class="btn sm" data-act="arrive" data-id="' + a.id + '">Customer arrived</button>';
      }
      actions += '<button class="btn sm ghost" data-act="cancel-appt" data-id="' + a.id + '">Cancel</button>';
    }
    return "<tr" + (a.status === "Cancelled" ? ' class="dim"' : "") + "><td><b>" + a.slot + '</b><br><span class="muted">' + fmtDate(a.date) + "</span></td>" +
      "<td>" + esc(a.customer) + '<br><span class="muted">' + a.phone + "</span></td>" +
      "<td>" + a.type + (a.address ? '<br><span class="muted">' + esc(a.address) + "</span>" : "") + "</td>" +
      "<td>" + a.service + "</td><td>" + staff + "</td><td>" + status + '</td><td class="acts">' + actions + "</td></tr>";
  }).join("") : '<tr><td colspan="7" class="muted">No appointments here.</td></tr>';
};

// ===================== TRANSACTIONS =====================
function setupTxForm() {
  var f = $("txForm");
  f.service.innerHTML = Object.keys(PRICES).map(function (s) {
    return "<option>" + s + "</option>";
  }).join("");
  f.staff.innerHTML = '<option value="">Assign later</option>' + STAFF.map(function (s) { return "<option>" + s + "</option>"; }).join("");
  $("hangerFee").textContent = "(₱" + HANGER_FEE + " each)";
  $("steamFee").textContent = "(₱" + STEAM_FEE + " per piece)";
  $("rushFee").textContent = "(+₱" + RUSH_FEE + ", goes first)";
  var names = {};
  DB.tx.forEach(function (t) { names[t.customer] = t.phone; });
  $("customerList").innerHTML = Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");

  f.addEventListener("input", function (e) {
    if (e.target.name === "customer" && names[e.target.value] && !f.phone.value) f.phone.value = names[e.target.value];
    $("txErr").textContent = "";
    updateBill();
  });
  f.addEventListener("change", updateBill);
  f.addEventListener("submit", saveTransaction);
  updateBill();
}

function readTxForm() {
  var f = $("txForm");
  return {
    customer: f.customer.value.trim(), phone: f.phone.value.replace(/[\s-]/g, ""),
    service: f.service.value, qty: Number(f.qty.value) || 0,
    hanger: Math.max(0, Math.floor(Number(f.hanger.value) || 0)), steam: Math.max(0, Math.floor(Number(f.steam.value) || 0)),
    rush: f.rush.checked, fulfil: f.fulfil.value, payment: f.payment.value,
    address: f.address.value.trim(), staff: f.staff.value
  };
}

function updateBill() {
  var o = readTxForm(), p = PRICES[o.service], c = computeTotal(o);
  $("qtyUnit").textContent = "(" + p.unit + (p.min > 1 ? ", minimum " + p.min : "") + ")";
  $("addrRow").hidden = $("staffRow").hidden = o.fulfil !== "Home delivery";
  var lines = [[o.service + " — " + c.billed + " " + p.unit + " × ₱" + p.rate, c.base]];
  if (o.hanger) lines.push(["Coat hangers × " + o.hanger, o.hanger * HANGER_FEE]);
  if (o.steam) lines.push(["Steam pressing × " + o.steam, o.steam * STEAM_FEE]);
  if (o.rush) lines.push(["Rush order", c.rush]);
  $("billLines").innerHTML = lines.map(function (l) {
    return '<div class="line"><span>' + l[0] + "</span><b>" + peso(l[1]) + "</b></div>";
  }).join("") + '<div class="line total"><span>Total</span><b>' + peso(c.total) + "</b></div>" +
    '<p class="muted">' + (o.payment ? "Paid · " + o.payment : "Not yet paid") + "</p>";
}

async function saveTransaction(e) {
  e.preventDefault();
  var o = readTxForm(), err = [];
  if (!o.customer) err.push("Enter the customer's name.");
  if (!/^09\d{9}$/.test(o.phone)) err.push("Enter an 11-digit mobile number starting with 09.");
  if (!(o.qty > 0)) err.push("Enter the quantity.");
  if (o.fulfil === "Home delivery" && !o.address) err.push("Enter the delivery address.");
  if (err.length) { $("txErr").textContent = err.join(" "); return; }

  var btn = document.querySelector("button[form=txForm]");
  btn.disabled = true;
  try {
    o.apptId = fromAppt;
    var result = applyResult(await api("POST", "/api/transactions", o));   // the server computes the total
    fromAppt = "";
    $("fromAppt").textContent = "";
    $("txForm").reset();
    updateBill();
    toast("<b>" + result.tx.id + "</b> saved · " + peso(result.tx.total));
    refresh();
  } catch (ex) {
    $("txErr").textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}

function txList() {
  var term = $("txSearch").value.trim().toLowerCase(), filter = $("txFilter").value, today = todayISO();
  return newest(DB.tx.filter(function (t) {
    if (filter === "active" && t.status === "Completed") return false;
    if (filter === "unpaid" && t.payment) return false;
    if (filter === "today" && t.date !== today) return false;
    if (term && (t.customer + " " + t.id + " " + t.phone).toLowerCase().indexOf(term) < 0) return false;
    return true;
  }));
}

RENDER.transactions = function () {
  var list = txList(), shown = list.slice(0, txShown);
  $("txBody").innerHTML = shown.length ? shown.map(function (t) {
    var next = "—";
    if (t.status === "Received") next = '<button class="btn sm" data-act="advance" data-id="' + t.id + '">Start washing</button>';
    else if (t.status === "Washing") next = '<button class="btn sm" data-act="advance" data-id="' + t.id + '">Mark ready + SMS</button>';
    else if (t.status === "Ready" && !t.delivery) next = '<button class="btn sm" data-act="claim" data-id="' + t.id + '">Claimed</button>';
    else if (t.status === "Ready") next = '<a class="link" href="#deliveries">Deliveries ›</a>';
    var pay = t.payment ? '<span class="st s-d">' + t.payment + "</span>"
      : '<button class="btn sm ghost" data-act="pay" data-method="Cash" data-id="' + t.id + '">Cash</button>' +
        '<button class="btn sm ghost" data-act="pay" data-method="GCash" data-id="' + t.id + '">GCash</button>';
    return "<tr><td><b>" + t.id + "</b></td><td>" + fmtDate(t.date) + '<br><span class="muted">' + time12(t.time) + "</span></td>" +
      "<td>" + esc(t.customer) + '<br><span class="muted">' + t.phone + "</span></td>" +
      "<td>" + t.service + " · " + t.qty + " " + PRICES[t.service].unit + "</td><td>" + addonText(t) + "</td>" +
      "<td><b>" + peso(t.total) + '</b></td><td class="acts">' + pay + "</td><td>" + statusPill(t) + '</td><td class="acts">' + next + "</td></tr>";
  }).join("") : '<tr><td colspan="9" class="muted">No transactions match.</td></tr>';
  $("txCount").textContent = "Showing " + shown.length + " of " + list.length + " · total " + peso(sum(list, function (t) { return t.total; }));
  $("txMore").hidden = shown.length >= list.length;
};

// ===================== DELIVERIES =====================
RENDER.deliveries = function () {
  var today = todayISO(), month = today.slice(0, 7);
  var active = DB.tx.filter(function (t) { return t.delivery && t.status !== "Completed"; });
  var doneToday = DB.tx.filter(function (t) { return t.delivery && t.status === "Completed" && t.doneOn === today; });
  var count = function (fn) { return active.filter(fn).length; };

  $("dlvKpis").innerHTML = [
    ["Ready to send out", count(function (t) { return t.status === "Ready" && t.delivery.status === "Pending"; })],
    ["In transit", count(function (t) { return t.delivery.status === "In transit"; })],
    ["Delivered today", doneToday.length],
    ["Returned for re-cleaning", count(function (t) { return t.delivery.status === "Returned"; })]
  ].map(function (k) { return '<div class="kpi mini"><span>' + k[0] + "</span><b>" + k[1] + "</b></div>"; }).join("");

  var order = function (t) { return t.delivery.status === "In transit" ? 0 : t.status === "Ready" ? 1 : t.delivery.status === "Returned" ? 2 : 3; };
  $("dlvBody").innerHTML = active.length ? active.sort(function (a, b) { return order(a) - order(b); }).map(function (t) {
    var d = t.delivery, status = statusPill(t), actions = "";
    if (d.status === "Pending" && t.status !== "Ready") {
      status = '<span class="st s-x">Being washed</span>';
    } else if (d.status === "Pending") {
      actions = '<button class="btn sm" data-act="send" data-id="' + t.id + '"' + (d.staff ? "" : ' disabled title="Assign staff first"') + ">Send out</button>";
    } else if (d.status === "In transit") {
      actions = t.payment
        ? '<button class="btn sm" data-act="delivered" data-id="' + t.id + '">Delivered</button>'
        : '<button class="btn sm" data-act="delivered" data-method="Cash" data-id="' + t.id + '">Delivered · Cash</button>' +
          '<button class="btn sm" data-act="delivered" data-method="GCash" data-id="' + t.id + '">Delivered · GCash</button>';
      actions += '<button class="btn sm danger" data-act="returned" data-id="' + t.id + '">Returned</button>';
    } else if (d.status === "Returned") {
      actions = '<span class="muted">Re-cleaning. Mark ready on Transactions.</span>';
    }
    var canAssign = d.status === "Pending" || d.status === "Returned";
    return "<tr><td><b>" + t.id + "</b>" + (t.rush ? ' <span class="st s-r">Rush</span>' : "") + '<br><span class="muted">' + peso(t.total) + (t.payment ? " · " + t.payment : " · unpaid") + "</span></td>" +
      "<td>" + esc(t.customer) + '<br><span class="muted">' + t.phone + "</span></td><td>" + esc(t.address) + "</td>" +
      "<td>" + (canAssign ? staffSelect(d.staff, "tx", t.id) : esc(d.staff)) + "</td><td>" + status + '</td><td class="acts">' + actions + "</td></tr>";
  }).join("") : '<tr><td colspan="6" class="muted">No active deliveries.</td></tr>';

  $("staffCards").innerHTML = '<div class="ch"><h3>Delivery staff</h3><span class="muted">this month</span></div>' + STAFF.map(function (s) {
    var mine = function (t) { return t.delivery && t.delivery.staff === s; };
    var onRoad = active.filter(function (t) { return mine(t) && t.delivery.status === "In transit"; }).length;
    var monthDone = DB.tx.filter(function (t) { return mine(t) && t.status === "Completed" && t.date.indexOf(month) === 0; }).length;
    var returns = DB.inc.filter(function (i) { return i.staff === s && i.date.indexOf(month) === 0; }).length;
    return '<div class="staff"><span class="ava">' + s.split(" ").map(function (w) { return w[0]; }).join("") + "</span>" +
      "<div><b>" + s + '</b><br><span class="muted">' + onRoad + " on the road now · " + monthDone + " delivered · " + returns + " returned</span></div></div>";
  }).join("");

  var incs = DB.inc.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  $("incCount").textContent = incs.filter(function (i) { return !i.resolved; }).length + " open";
  $("incBody").innerHTML = incs.length ? incs.slice(0, 8).map(function (i) {
    return "<tr><td>" + fmtDate(i.date) + "</td><td>" + i.txId + "</td><td>" + esc(i.staff) + "</td><td>" + esc(i.reason) + "</td><td>" +
      (i.resolved ? '<span class="st s-d">Resolved</span>' : '<span class="st s-r">Open</span>') + "</td></tr>";
  }).join("") : '<tr><td colspan="5" class="muted">No incidents logged.</td></tr>';
};

// ===================== EXPENSES =====================
function setupExpenses() {
  var now = new Date(), f = $("expForm");
  $("expMonth").innerHTML = MONTHS_LONG.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + "</option>"; }).join("");
  $("expMonth").value = now.getMonth() + 1;
  $("expYear").innerHTML = [now.getFullYear(), now.getFullYear() - 1].map(function (y) { return "<option>" + y + "</option>"; }).join("");
  f.category.innerHTML = EXPENSE_CATEGORIES.map(function (c) { return "<option>" + c + "</option>"; }).join("");
  f.date.value = f.date.max = todayISO();
  $("expMonth").addEventListener("change", refresh);
  $("expYear").addEventListener("change", refresh);
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var amount = Number(f.amount.value), desc = f.description.value.trim();
    if (!desc || !(amount > 0) || !f.date.value) { $("expErr").textContent = "Enter a description and an amount greater than zero."; return; }
    $("expErr").textContent = "";
    api("POST", "/api/expenses", { date: f.date.value, category: f.category.value, description: desc, amount: amount })
      .then(function (result) {
        applyResult(result);
        $("expMonth").value = +f.date.value.slice(5, 7);
        $("expYear").value = f.date.value.slice(0, 4);
        f.description.value = ""; f.amount.value = "";
        toast("Expense of <b>" + peso(amount) + "</b> added.");
        refresh();
      })
      .catch(function (ex) { $("expErr").textContent = ex.message; });
  });
  $("expExport").addEventListener("click", function () {
    var list = expList(), rows = [["Date", "Category", "Description", "Amount"]];
    list.slice().reverse().forEach(function (e) { rows.push([e.date, e.category, e.description, e.amount]); });
    rows.push([], ["Total", "", "", sum(list, function (e) { return e.amount; })]);
    downloadCSV("expenses-" + $("expYear").value + "-" + pad($("expMonth").value) + ".csv", rows);
  });
}
function expList() {
  var key = $("expYear").value + "-" + pad($("expMonth").value);
  return DB.exp.filter(function (e) { return e.date.indexOf(key) === 0; })
    .sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
}
RENDER.expenses = function () {
  var list = expList(), total = sum(list, function (e) { return e.amount; });
  $("expTitle").textContent = MONTHS_LONG[$("expMonth").value - 1] + " " + $("expYear").value;
  $("expTotal").innerHTML = peso(total) + ' <span class="muted">total · ' + list.length + " entries</span>";
  $("expBody").innerHTML = list.length ? list.map(function (e) {
    return "<tr><td>" + fmtDate(e.date) + "</td><td>" + e.category + "</td><td>" + esc(e.description) + "</td><td><b>" + peso(e.amount) + "</b></td></tr>";
  }).join("") : '<tr><td colspan="4" class="muted">No expenses this month.</td></tr>';
  $("expCats").innerHTML = barRows(EXPENSE_CATEGORIES.map(function (c) {
    return [c, sum(list.filter(function (e) { return e.category === c; }), function (e) { return e.amount; })];
  }).filter(function (r) { return r[1] > 0; }), total);
};

function barRows(rows, total) {
  if (!rows.length) return '<li class="muted">Nothing recorded.</li>';
  return rows.map(function (r) {
    var pct = total ? Math.round(r[1] / total * 100) : 0;
    return "<li><div><span>" + r[0] + "</span><b>" + peso(r[1]) + ' <em>' + pct + '%</em></b></div><i><s style="width:' + pct + '%"></s></i></li>';
  }).join("");
}

// ===================== INCOME REPORTS =====================
function setupReports() {
  var now = new Date();
  $("repDay").value = $("repDay").max = todayISO();
  $("repMonth").innerHTML = MONTHS_LONG.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + "</option>"; }).join("");
  $("repMonth").value = now.getMonth() + 1;
  $("repYear").innerHTML = [now.getFullYear(), now.getFullYear() - 1].map(function (y) { return "<option>" + y + "</option>"; }).join("");
  ["repDay", "repMonth", "repYear"].forEach(function (id) { $(id).addEventListener("change", refresh); });
  $("repTabs").addEventListener("click", function (e) {
    if (e.target.dataset.mode) { repMode = e.target.dataset.mode; refresh(); }
  });
  $("repPrint").addEventListener("click", function () { window.print(); });
  $("repExport").addEventListener("click", function () {
    var rows = [[SHOP + " - " + $("repTitle").textContent], []];
    document.querySelectorAll("#repKpis .kpi").forEach(function (k) {
      rows.push([k.querySelector("span").textContent, k.querySelector("b").textContent.replace(/[₱,]/g, "").replace("−", "-")]);
    });
    rows.push([]);
    document.querySelectorAll("#repTable tr").forEach(function (tr) {
      rows.push([].map.call(tr.children, function (c) {
        var t = c.textContent.trim();
        return /^−?₱[\d,]+$/.test(t) ? t.replace(/[₱,]/g, "").replace("−", "-") : t;
      }));
    });
    downloadCSV("income-report-" + ($("repTitle").dataset.key || "report") + ".csv", rows);
  });
}

RENDER.reports = function () {
  var y = $("repYear").value, m = pad($("repMonth").value), day = $("repDay").value || todayISO();
  document.querySelectorAll("#repTabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.mode === repMode); });
  $("repDay").hidden = repMode !== "day";
  $("repMonth").hidden = repMode !== "month";
  $("repYear").hidden = repMode === "day";

  var key = repMode === "day" ? day : repMode === "month" ? y + "-" + m : y;
  var title = repMode === "day" ? "Daily report · " + fmtDate(day)
    : repMode === "month" ? "Monthly report · " + MONTHS_LONG[m - 1] + " " + y : "Yearly report · " + y;
  $("repTitle").textContent = title;
  $("repTitle").dataset.key = key;

  var tx = DB.tx.filter(function (t) { return t.date.indexOf(key) === 0; });
  var exp = DB.exp.filter(function (e) { return e.date.indexOf(key) === 0; });
  var sales = sum(tx, function (t) { return t.total; }), costs = sum(exp, function (e) { return e.amount; });

  $("repKpis").innerHTML =
    '<div class="kpi g2"><span>Net income</span><b>' + peso(sales - costs) + "</b></div>" +
    '<div class="kpi mini"><span>Gross sales</span><b>' + peso(sales) + "</b></div>" +
    '<div class="kpi mini"><span>Expenses</span><b>' + peso(costs) + "</b></div>" +
    '<div class="kpi mini"><span>Orders</span><b>' + tx.length + "</b></div>";

  var table = $("repTable");
  if (repMode === "day") {
    $("repTableTitle").textContent = tx.length + " transactions";
    table.innerHTML = "<thead><tr><th>Order no.</th><th>Time</th><th>Customer</th><th>Service</th><th>Total</th></tr></thead><tbody>" +
      (newest(tx).map(function (t) {
        return "<tr><td>" + t.id + "</td><td>" + time12(t.time) + "</td><td>" + esc(t.customer) + "</td><td>" + t.service + (t.rush ? " · Rush" : "") + "</td><td>" + peso(t.total) + "</td></tr>";
      }).join("") || '<tr><td colspan="5" class="muted">No transactions on this day.</td></tr>') +
      "</tbody><tfoot><tr><th colspan=\"4\">Total</th><th>" + peso(sales) + "</th></tr></tfoot>";
  } else {
    var keys = [], labels = [];
    if (repMode === "month") {
      var n = new Date(+y, +m, 0).getDate();
      for (var d = 1; d <= n; d++) { keys.push(y + "-" + m + "-" + pad(d)); labels.push(MONTHS[m - 1] + " " + d); }
    } else {
      for (var i = 1; i <= 12; i++) { keys.push(y + "-" + pad(i)); labels.push(MONTHS_LONG[i - 1]); }
    }
    $("repTableTitle").textContent = repMode === "month" ? "Day by day" : "Month by month";
    var body = keys.map(function (k, i) {
      var t = tx.filter(function (x) { return x.date.indexOf(k) === 0; }), e = exp.filter(function (x) { return x.date.indexOf(k) === 0; });
      if (!t.length && !e.length) return "";
      var s = sum(t, function (x) { return x.total; }), c = sum(e, function (x) { return x.amount; });
      return "<tr><td>" + labels[i] + "</td><td>" + t.length + "</td><td>" + peso(s) + "</td><td>" + peso(c) + "</td><td" + (s - c < 0 ? ' class="neg"' : "") + ">" + peso(s - c) + "</td></tr>";
    }).join("");
    table.innerHTML = "<thead><tr><th>" + (repMode === "month" ? "Date" : "Month") + "</th><th>Orders</th><th>Sales</th><th>Expenses</th><th>Net</th></tr></thead><tbody>" +
      (body || '<tr><td colspan="5" class="muted">Nothing recorded.</td></tr>') + "</tbody>" +
      "<tfoot><tr><th>Total</th><th>" + tx.length + "</th><th>" + peso(sales) + "</th><th>" + peso(costs) + "</th><th>" + peso(sales - costs) + "</th></tr></tfoot>";
  }

  $("repBreak").innerHTML = barRows([
    ["Base service", sum(tx, function (t) { return t.base; })],
    ["Add-ons (hangers, steam pressing)", sum(tx, function (t) { return t.addons; })],
    ["Rush fees", sum(tx, function (t) { return t.rushFee; })]
  ], sales);
  $("repPay").innerHTML = barRows([
    ["Cash", sum(tx.filter(function (t) { return t.payment === "Cash"; }), function (t) { return t.total; })],
    ["GCash", sum(tx.filter(function (t) { return t.payment === "GCash"; }), function (t) { return t.total; })],
    ["Not yet paid", sum(tx.filter(function (t) { return !t.payment; }), function (t) { return t.total; })]
  ], sales);
};

// ===================== BUTTON CLICKS (all pages) =====================
// Every button asks the server to do the step. The server checks it's allowed,
// saves it in SQL Server, and sends back the updated record.
async function run(promise, message) {
  try {
    var result = applyResult(await promise);
    if (typeof message === "function") message = message(result);
    if (message) toast(message);
  } catch (ex) {
    toast("⚠ " + esc(ex.message));
  }
  refresh();
}

document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  var id = b.dataset.id, t = dbFind("tx", id), a = dbFind("appt", id);
  var enc = encodeURIComponent(id || "");

  switch (b.dataset.act) {
    case "advance":                       // Received -> Washing -> Ready (+SMS)
      b.disabled = true;
      run(api("POST", "/api/transactions/" + enc + "/advance"), function (r) {
        return r.sms ? "<b>SMS sent to " + r.sms.phone + "</b><br>" + esc(r.sms.message)
                     : "<b>" + id + "</b> is now washing.";
      });
      break;
    case "claim":
      run(api("POST", "/api/transactions/" + enc + "/claim"), "<b>" + id + "</b> claimed by " + esc(t.customer) + ".");
      break;
    case "pay":
      run(api("POST", "/api/transactions/" + enc + "/pay", { method: b.dataset.method }),
        "Payment of <b>" + peso(t.total) + "</b> via " + b.dataset.method + " recorded.");
      break;
    case "send":
      run(api("POST", "/api/deliveries/" + enc + "/send"), "<b>" + id + "</b> is out for delivery with " + esc(t.delivery.staff) + ".");
      break;
    case "delivered":
      run(api("POST", "/api/deliveries/" + enc + "/delivered", { method: b.dataset.method }),
        "<b>" + id + "</b> delivered by " + esc(t.delivery.staff) + ".");
      break;
    case "returned":
      $("returnInfo").textContent = id + " · " + t.customer + " · " + t.delivery.staff;
      $("returnForm").dataset.id = id;
      $("returnDialog").showModal();
      break;
    case "arrive":                         // appointment -> new transaction form
      fromAppt = id;
      location.hash = "#transactions";
      var f = $("txForm");
      f.reset();
      f.customer.value = a.customer;
      f.phone.value = a.phone;
      f.service.value = a.service;
      if (a.type === "Home pickup") { f.fulfil.value = "Home delivery"; f.address.value = a.address; f.staff.value = a.staff; }
      $("fromAppt").textContent = "from appointment " + id;
      updateBill();
      f.qty.focus();
      break;
    case "cancel-appt":
      if (!confirm("Cancel " + a.customer + "'s " + a.slot + " appointment?")) return;
      run(api("POST", "/api/appointments/" + enc + "/cancel"), "Appointment " + id + " cancelled.");
      break;
  }
});

// staff dropdowns (deliveries and home pickups)
document.addEventListener("change", function (e) {
  var s = e.target;
  if (!s.dataset.assign) return;
  var url = (s.dataset.assign === "tx" ? "/api/deliveries/" : "/api/appointments/") + encodeURIComponent(s.dataset.id) + "/assign";
  run(api("POST", url, { staff: s.value }), s.value ? "Assigned to " + esc(s.value) + "." : "Staff removed.");
});

// returned-delivery pop-up
$("returnForm").addEventListener("submit", function () {
  var id = this.dataset.id;
  run(api("POST", "/api/deliveries/" + encodeURIComponent(id) + "/returned", { reason: this.reason.value }),
    "<b>" + id + "</b> logged as returned. It's back in Washing.");
});
$("returnCancel").addEventListener("click", function () { $("returnDialog").close(); });

// ===================== START =====================
$("today").textContent = new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
$("apptTabs").addEventListener("click", function (e) {
  if (e.target.dataset.tab) { apptTab = e.target.dataset.tab; refresh(); }
});
$("txSearch").addEventListener("input", function () { txShown = 15; refresh(); });
$("txFilter").addEventListener("change", function () { txShown = 15; refresh(); });
$("txMore").addEventListener("click", function () { txShown += 15; refresh(); });
$("txExport").addEventListener("click", function () {
  var rows = [["Order no.", "Date", "Time", "Customer", "Phone", "Service", "Qty", "Coat hangers", "Steam pressing", "Rush",
    "Base", "Add-ons", "Rush fee", "Total", "Payment", "Status", "Delivery staff", "Delivery status"]];
  txList().forEach(function (t) {
    rows.push([t.id, t.date, t.time, t.customer, t.phone, t.service, t.qty, t.hanger, t.steam, t.rush ? "Yes" : "No",
      t.base, t.addons, t.rushFee, t.total, t.payment || "Unpaid", t.status,
      t.delivery ? t.delivery.staff : "", t.delivery ? t.delivery.status : ""]);
  });
  downloadCSV("transactions-" + todayISO() + ".csv", rows);
});
$("logout").addEventListener("click", function (e) {
  e.preventDefault();
  fetch("/api/logout", { method: "POST" }).finally(function () { location.href = "../Login%20form/login.html"; });
});

function showStatus(message) {
  $("status").textContent = message;
  $("status").hidden = !message;
}

// Get everything from the server first, then draw the pages
showStatus("Loading records from the database...");
loadAll().then(function () {
  showStatus("");
  $("whoName").textContent = SHOP + " · " + CURRENT_USER.name + " (" + CURRENT_USER.role + ")";
  setupTxForm();
  setupExpenses();
  setupReports();
  window.addEventListener("hashchange", showPage);
  showPage();
}).catch(function (ex) {
  showStatus("⚠ " + ex.message);
});
