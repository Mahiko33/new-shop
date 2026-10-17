// =====================================================================
// dashboard.js - the Dashboard page (KPIs, charts, recent transactions).
// Every number is computed from the records in data.js.
// =====================================================================

var NS = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent) {
  var e = document.createElementNS(NS, tag);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function defs(svg, id, c1, c2, vertical) {
  var d = el("defs", {}, svg);
  var g = el("linearGradient", { id: id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 }, d);
  el("stop", { offset: "0%", "stop-color": c1 }, g);
  el("stop", { offset: "100%", "stop-color": c2 }, g);
}

// shown in the Status column: delivery status for deliveries, order status otherwise
function statusLabel(t) {
  if (t.delivery && (t.delivery.status !== "Pending" || t.status === "Ready")) return t.delivery.status;
  return t.status;
}
var STATUS_CLASS = {
  "Received": "s-x", "Washing": "s-p", "Ready": "s-t", "Completed": "s-d",
  "Pending": "s-p", "In transit": "s-t", "Delivered": "s-d", "Returned": "s-r"
};
function statusPill(t) {
  var s = statusLabel(t);
  return '<span class="st ' + STATUS_CLASS[s] + '">' + (s === "Returned" ? "Returned for re-cleaning" : s) + "</span>";
}
function addonText(t) {
  var a = [];
  if (t.hanger) a.push("Coat hangers ×" + t.hanger);
  if (t.steam) a.push("Steam pressing ×" + t.steam);
  if (t.rush) a.push("Rush");
  return a.length ? a.join(", ") : "None";
}

function drawDashboard() {
  var today = todayISO(), now = new Date(), year = now.getFullYear(), m = now.getMonth();
  var month = today.slice(0, 7);

  // ===== KPIs =====
  var txToday = DB.tx.filter(function (t) { return t.date === today; });
  var txMonth = DB.tx.filter(function (t) { return t.date.indexOf(month) === 0; });
  var income = sum(txMonth, function (t) { return t.total; });
  var expenses = sum(DB.exp.filter(function (e) { return e.date.indexOf(month) === 0; }), function (e) { return e.amount; });

  // compare with the same days of last month (Oct 1-15 vs Sep 1-15)
  var p = new Date(year, m - 1, 1), prevMonth = p.getFullYear() + "-" + pad(p.getMonth() + 1), dd = today.slice(8);
  var prevIncome = sum(DB.tx.filter(function (t) { return t.date.indexOf(prevMonth) === 0 && t.date.slice(8) <= dd; }), function (t) { return t.total; });

  $("k-today").textContent = peso(sum(txToday, function (t) { return t.total; }));
  $("k-today-n").textContent = txToday.length + " orders so far";
  $("k-income").textContent = peso(income);
  $("k-exp").textContent = peso(expenses);
  $("k-net").textContent = peso(income - expenses);
  if (prevIncome) {
    var pct = (income - prevIncome) / prevIncome * 100;
    $("k-delta").textContent = (pct >= 0 ? "▲ " : "▼ ") + Math.abs(pct).toFixed(1) + "% vs same days last month";
  }

  // ===== LINE CHART: income vs expenses per month this year =====
  var INCOME = [], EXPENSE = [];
  for (var i = 0; i < 12; i++) {
    var key = year + "-" + pad(i + 1);
    INCOME.push(i > m ? 0 : sum(DB.tx.filter(function (t) { return t.date.indexOf(key) === 0; }), function (t) { return t.total; }));
    EXPENSE.push(i > m ? 0 : sum(DB.exp.filter(function (e) { return e.date.indexOf(key) === 0; }), function (e) { return e.amount; }));
  }
  $("lineTitle").textContent = "Income vs Expenses (" + year + ")";
  (function () {
    var svg = $("line"), W = 640, H = 240, L = 46, R = 10, T = 10, B = 26;
    svg.innerHTML = "";
    var max = Math.ceil(Math.max.apply(null, INCOME.concat(EXPENSE, [1])) / 20000) * 20000;
    function x(i) { return L + i * (W - L - R) / 11; }
    function y(v) { return T + (H - T - B) * (1 - v / max); }
    defs(svg, "area", "rgba(34,211,238,.35)", "rgba(34,211,238,0)", true);
    for (var g = 0; g <= 4; g++) {
      var gy = T + (H - T - B) * g / 4;
      el("line", { x1: L, x2: W - R, y1: gy, y2: gy, stroke: "#262b4d", "stroke-width": 1 }, svg);
      el("text", { x: L - 8, y: gy + 4, "text-anchor": "end", fill: "#8e94bb", "font-size": 10 }, svg).textContent = (max * (1 - g / 4) / 1000) + "k";
    }
    MONTHS.forEach(function (mn, i) {
      el("text", { x: x(i), y: H - 6, "text-anchor": "middle", fill: "#8e94bb", "font-size": 10 }, svg).textContent = mn;
    });
    function path(arr) {
      var pts = [];
      arr.forEach(function (v, i) { if (i <= m) pts.push([x(i), y(v)]); });
      var d = "M" + pts[0][0] + "," + pts[0][1];
      for (var i = 1; i < pts.length; i++) {
        var cx = (pts[i - 1][0] + pts[i][0]) / 2;
        d += " C" + cx + "," + pts[i - 1][1] + " " + cx + "," + pts[i][1] + " " + pts[i][0] + "," + pts[i][1];
      }
      return { d: d, last: pts[pts.length - 1], first: pts[0] };
    }
    var a = path(INCOME), b = path(EXPENSE);
    el("path", { d: a.d + " L" + a.last[0] + "," + (H - B) + " L" + a.first[0] + "," + (H - B) + " Z", fill: "url(#area)" }, svg);
    el("path", { d: a.d, fill: "none", stroke: "#22d3ee", "stroke-width": 2.5, "stroke-linecap": "round" }, svg);
    el("path", { d: b.d, fill: "none", stroke: "#d946ef", "stroke-width": 2, "stroke-dasharray": "5 4", "stroke-linecap": "round" }, svg);
    el("circle", { cx: a.last[0], cy: a.last[1], r: 5, fill: "#22d3ee", stroke: "#0c0e1d", "stroke-width": 2 }, svg);
    INCOME.forEach(function (v, i) {
      if (i > m) return;
      var dot = el("circle", { cx: x(i), cy: y(v), r: 10, fill: "transparent" }, svg);
      el("title", {}, dot).textContent = MONTHS[i] + ": income " + peso(v) + ", expenses " + peso(EXPENSE[i]);
    });
  })();

  // ===== BAR CHART: orders per weekday, last 4 weeks =====
  var names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], counts = [0, 0, 0, 0, 0, 0, 0];
  var from = addDays(today, -27);
  DB.tx.forEach(function (t) {
    if (t.date >= from && t.date <= today) counts[(parseISO(t.date).getDay() + 6) % 7]++;
  });
  (function () {
    var svg = $("bars"), W = 300, H = 240, B = 26, T = 18;
    svg.innerHTML = "";
    var max = Math.max.apply(null, counts.concat([1]));
    var bw = 26, gap = (W - 7 * bw) / 8;
    defs(svg, "bar", "#22d3ee", "#7c3aed", true);
    names.forEach(function (n, i) {
      var h = (H - B - T) * counts[i] / max, bx = gap + i * (bw + gap), by = H - B - h;
      var r = el("rect", { x: bx, y: by, width: bw, height: h, rx: 5, fill: "url(#bar)" }, svg);
      el("title", {}, r).textContent = n + ": " + counts[i] + " orders";
      el("text", { x: bx + bw / 2, y: by - 5, "text-anchor": "middle", fill: "#e8eaf8", "font-size": 10 }, svg).textContent = counts[i];
      el("text", { x: bx + bw / 2, y: H - 8, "text-anchor": "middle", fill: "#8e94bb", "font-size": 10 }, svg).textContent = n;
    });
  })();

  // ===== DONUTS =====
  var base = sum(txMonth, function (t) { return t.base; });
  var addons = sum(txMonth, function (t) { return t.addons; });
  var rush = sum(txMonth, function (t) { return t.rushFee; });
  var pctOf = function (v) { return income ? Math.round(v / income * 100) : 0; };
  donut("d1", "l1", [["Base service", base, "#7c3aed", pctOf(base) + "%"], ["Add-ons", addons, "#22d3ee", pctOf(addons) + "%"],
                      ["Rush fees", rush, "#d946ef", pctOf(rush) + "%"]], peso(income), "this month");

  var dlv = txMonth.filter(function (t) { return t.delivery; });
  var byStatus = function (s) { return dlv.filter(function (t) { return t.delivery.status === s; }).length; };
  donut("d2", "l2", [["Pending", byStatus("Pending"), "#facc15"], ["In transit", byStatus("In transit"), "#22d3ee"],
                      ["Delivered", byStatus("Delivered"), "#14b8a6"], ["Returned for re-cleaning", byStatus("Returned"), "#d946ef"]],
        String(dlv.length), "deliveries");

  // ===== RECENT TRANSACTIONS =====
  var recent = DB.tx.slice().sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); }).slice(0, 6);
  $("tx").innerHTML = recent.map(function (t) {
    return "<tr><td>" + esc(t.customer) + "</td><td>" + t.service + "</td><td>" + addonText(t) + "</td><td>" + peso(t.total) +
           "</td><td>" + statusPill(t) + "</td></tr>";
  }).join("");
}

// data: [label, value, color, optional text to show instead of the value]
function donut(svgId, listId, data, centerText, centerLabel) {
  var svg = $(svgId), ul = $(listId), r = 42, C = 2 * Math.PI * r, total = 0, acc = 0;
  svg.innerHTML = ""; ul.innerHTML = "";
  data.forEach(function (d) { total += d[1]; });
  el("circle", { cx: 60, cy: 60, r: r, fill: "none", stroke: "#262b4d", "stroke-width": 14 }, svg);
  data.forEach(function (d) {
    var len = total ? C * d[1] / total : 0;
    if (len > 0) {
      el("circle", { cx: 60, cy: 60, r: r, fill: "none", stroke: d[2], "stroke-width": 14,
        "stroke-dasharray": len + " " + (C - len), "stroke-dashoffset": -acc, transform: "rotate(-90 60 60)" }, svg);
    }
    acc += len;
    var li = document.createElement("li");
    li.innerHTML = '<i style="background:' + d[2] + '"></i>' + d[0] + "<em>" + (d[3] || d[1]) + "</em>";
    ul.appendChild(li);
  });
  el("text", { x: 60, y: 60, "text-anchor": "middle", fill: "#e8eaf8", "font-size": centerText.length > 7 ? 11 : 16, "font-weight": 700 }, svg).textContent = centerText;
  el("text", { x: 60, y: 74, "text-anchor": "middle", fill: "#8e94bb", "font-size": 8 }, svg).textContent = centerLabel;
}
