// =====================================================================
// data.js - talks to the Node.js server, which reads and writes SQL Server.
// Loads FIRST. Prices, staff and every record come from the database.
// =====================================================================

// ===== SETTINGS (filled in from the database when the page opens) =====
var SHOP = "Fronia Laundry";
var PRICES = {};          // { "Wash & fold": { rate, unit, min }, ... }  from the services table
var HANGER_FEE = 0, STEAM_FEE = 0, RUSH_FEE = 0;                       // from the fees table
var STAFF = [];           // delivery staff names, from the users table
var EXPENSE_CATEGORIES = [];
var CURRENT_USER = null;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
                   "August", "September", "October", "November", "December"];

// ===== SMALL HELPERS =====
function $(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, "0"); }
function peso(n) {
  var v = Number(n) || 0;
  return (v < 0 ? "−₱" : "₱") + Math.abs(Math.round(v)).toLocaleString("en-PH");
}
function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function todayISO() { return toISO(new Date()); }
function parseISO(s) { var p = s.split("-"); return new Date(+p[0], p[1] - 1, +p[2], 12); }
function addDays(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); }
function fmtDate(s) { var d = parseISO(s); return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear(); }
function time12(t) { var h = +t.slice(0, 2); return ((h % 12) || 12) + ":" + t.slice(3, 5) + (h < 12 ? " AM" : " PM"); }
function slotMinutes(s) {
  var parts = s.split(" "), hm = parts[0].split(":"), h = +hm[0];
  if (parts[1] === "PM" && h !== 12) h += 12;
  return h * 60 + (+hm[1]);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function sum(list, pick) { return list.reduce(function (t, x) { return t + (pick(x) || 0); }, 0); }

// Bill preview on the form. The SERVER computes the real total when you save.
function computeTotal(o) {
  var p = PRICES[o.service];
  if (!p) return { billed: 0, base: 0, addons: 0, rush: 0, total: 0 };
  var qty = Number(o.qty) || 0;
  var billed = qty > 0 ? Math.max(qty, p.min) : 0;
  var base = billed * p.rate;
  var addons = (Number(o.hanger) || 0) * HANGER_FEE + (Number(o.steam) || 0) * STEAM_FEE;
  var rush = o.rush ? RUSH_FEE : 0;
  return { billed: billed, base: base, addons: addons, rush: rush, total: base + addons + rush };
}

// =====================================================================
// RECORDS - a copy of the database rows the pages are showing
// =====================================================================
var DB = { tx: [], exp: [], appt: [], inc: [] };

// Calls the server. Throws an Error with the server's message if something is wrong.
async function api(method, url, body) {
  var res;
  try {
    res = await fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error("Can't reach the server. Is it still running?");
  }
  if (res.status === 401) {                       // session ended: back to login
    location.href = "../Login%20form/login.html";
    throw new Error("Please log in again.");
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
  return data;
}

// Load everything once when the dashboard opens
async function loadAll() {
  var data = await api("GET", "/api/bootstrap");
  var s = data.settings;
  SHOP = s.shop;
  PRICES = s.prices;
  HANGER_FEE = s.hanger; STEAM_FEE = s.steam; RUSH_FEE = s.rush;
  STAFF = s.staff;
  EXPENSE_CATEGORIES = s.categories;
  CURRENT_USER = data.user;
  DB.tx = data.tx; DB.exp = data.exp; DB.appt = data.appt; DB.inc = data.inc;
}

// Put a record the server sent back into our copy (replace it, or add it if new)
function upsert(kind, rec) {
  if (!rec) return;
  var list = DB[kind];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === rec.id) { list[i] = rec; return; }
  }
  list.push(rec);
}

// Apply whatever records came back from an API call
function applyResult(result) {
  if (result.tx) upsert("tx", result.tx);
  if (result.appt) upsert("appt", result.appt);
  if (result.expense) upsert("exp", result.expense);
  if (result.incident) upsert("inc", result.incident);
  (result.incidents || []).forEach(function (i) { upsert("inc", i); });
  return result;
}

function dbFind(kind, id) {
  return DB[kind].filter(function (r) { return r.id === id; })[0] || null;
}
