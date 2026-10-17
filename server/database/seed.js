// seed.js - adds the user accounts and (optionally) sample history to the database.
//
//   npm run seed          -> accounts + about a year and a half of sample orders/expenses
//   npm run seed:users    -> accounts only (use this for the real shop)
//
// WARNING: "npm run seed" deletes all existing orders, customers and expenses first.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const { getPool } = require("../db");
const { computeTotal, todayISO, addDays } = require("../services");

const USERS_ONLY = process.argv.includes("--users-only");

// Login accounts - change the passwords after your first login
const USERS = [
  { name: "Fronia Owner", email: "owner@fronia.com", password: "owner124", role: "Owner" },
  { name: "Lea Domingo", email: "counter@fronia.com", password: "counter123", role: "Counter" },
  { name: "Jun Reyes", email: "jun@fronia.com", password: "staff123", role: "Delivery" },
  { name: "Marvin Santos", email: "marvin@fronia.com", password: "staff123", role: "Delivery" }
];

// value -> SQL text (only used for the generated sample data below)
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  return "N'" + String(v).replace(/'/g, "''") + "'";
}

async function insertRows(pool, table, columns, rows) {
  for (let i = 0; i < rows.length; i += 400) {             // SQL Server allows up to 1000 rows per INSERT
    const chunk = rows.slice(i, i + 400);
    const values = chunk.map((r) => "(" + r.map(lit).join(", ") + ")").join(",\n");
    await pool.request().query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values}`);
  }
}

// ---------- repeatable "random" numbers ----------
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (iso) => iso.slice(2).replace(/-/g, "");

async function seedUsers(pool) {
  const ids = {};
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const existing = await pool.request().input("email", u.email)
      .query("SELECT user_id FROM users WHERE email = @email");
    if (existing.recordset[0]) {
      ids[u.name] = existing.recordset[0].user_id;
      if (!USERS_ONLY) {
        await pool.request().input("id", ids[u.name]).input("hash", hash).input("name", u.name).input("role", u.role)
          .query("UPDATE users SET password_hash = @hash, full_name = @name, role = @role, is_active = 1 WHERE user_id = @id");
      }
    } else {
      const r = await pool.request().input("name", u.name).input("email", u.email).input("hash", hash).input("role", u.role)
        .query("INSERT INTO users (full_name, email, password_hash, role) OUTPUT INSERTED.user_id VALUES (@name, @email, @hash, @role)");
      ids[u.name] = r.recordset[0].user_id;
    }
    console.log(`  ${u.role.padEnd(8)} ${u.email.padEnd(20)} password: ${u.password}`);
  }
  return ids;
}

async function seedSampleData(pool, userIds) {
  // price list from the database, so totals match whatever prices you set
  const services = (await pool.request().query("SELECT service_name, rate, unit, min_qty FROM services")).recordset;
  const fees = (await pool.request().query("SELECT fee_key, amount FROM fees")).recordset;
  const priceList = { prices: {}, hanger: 0, steam: 0, rush: 0 };
  services.forEach((s) => { priceList.prices[s.service_name] = { rate: Number(s.rate), unit: s.unit, min: Number(s.min_qty) }; });
  fees.forEach((f) => { priceList[f.fee_key] = Number(f.amount); });
  const serviceNames = Object.keys(priceList.prices);
  const washFold = serviceNames.find((s) => /wash/i.test(s)) || serviceNames[0];
  const dryClean = serviceNames.find((s) => /dry/i.test(s)) || serviceNames[serviceNames.length - 1];

  const staff = USERS.filter((u) => u.role === "Delivery").map((u) => u.name);
  const ownerId = userIds["Fronia Owner"];

  console.log("Removing old orders, customers and expenses...");
  for (const t of ["sms_log", "incidents", "deliveries", "appointments", "transactions", "expenses", "customers"]) {
    await pool.request().query(`DELETE FROM ${t}`);
  }

  // ---------- customers ----------
  const FIRST = ["Maria", "Jose", "Ana", "Mark", "Kristine", "John", "Angelica", "Paolo", "Jasmine", "Carlo",
    "Bea", "Miguel", "Liza", "Rafael", "Joanna", "Kevin", "Camille", "Ramon", "Patricia", "Nico", "Grace", "Arnel"];
  const LAST = ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Dela Cruz",
    "Villanueva", "Ramos", "Aquino", "Castillo", "Flores", "Rivera", "Lim", "Tan", "Pascual"];
  const STREETS = ["Regalado Ave.", "Commonwealth Ave.", "Quirino Hwy.", "Dahlia St.", "Camaro St.", "Ruby St.", "Lagro Rd."];
  const AREAS = ["North Fairview", "West Fairview", "Fairview Park", "Greater Lagro"];
  const crng = seeded("customers");
  const customers = [];
  const used = new Set();
  while (customers.length < 120) {
    const name = pick(crng, FIRST) + " " + pick(crng, LAST);
    if (used.has(name)) continue;
    used.add(name);
    customers.push({
      name,
      phone: "09" + between(crng, 15, 99) + String(between(crng, 0, 9999999)).padStart(7, "0"),
      address: between(crng, 3, 210) + " " + pick(crng, STREETS) + ", " + pick(crng, AREAS)
    });
  }
  await insertRows(pool, "customers", ["full_name", "phone", "address"], customers.map((c) => [c.name, c.phone, c.address]));
  const idRows = (await pool.request().query("SELECT customer_id, full_name FROM customers")).recordset;
  const customerId = {};
  idRows.forEach((r) => { customerId[r.full_name] = r.customer_id; });

  // ---------- orders, deliveries, incidents, expenses ----------
  const today = todayISO();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const txRows = [], dlvRows = [], incRows = [], expRows = [];
  const staffIdOf = (n) => userIds[n];
  const start = (now.getFullYear() - 1) + "-01-01";

  for (let iso = start; iso <= today; iso = addDays(iso, 1)) {
    const rng = seeded("day" + iso);
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const age = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - date) / 86400000);
    const count = between(rng, 9, 15) + (date.getDay() === 0 || date.getDay() === 6 ? 3 : 0);
    const times = [];
    for (let i = 0; i < count; i++) times.push(between(rng, 480, 1079));
    times.sort((a, b) => a - b);

    times.forEach((mins, i) => {
      if (age === 0 && mins > nowMin) return;
      const c = pick(rng, customers);
      const service = rng() < 0.8 ? washFold : dryClean;
      const o = {
        service,
        qty: service === washFold ? between(rng, 3, 10) : between(rng, 1, 4),
        hanger: rng() < 0.25 ? between(rng, 1, 6) : 0,
        steam: rng() < 0.2 ? between(rng, 1, 5) : 0,
        rush: rng() < 0.15
      };
      const money = computeTotal(priceList, o);
      const delivery = rng() < 0.35;
      let status = "Completed";
      if (age === 0) { const r = rng(); status = r < 0.3 ? "Received" : r < 0.62 ? "Washing" : r < 0.9 ? "Ready" : "Completed"; }
      if (age === 1 && rng() < 0.2) status = "Ready";
      const paid = status === "Completed" || rng() < 0.45;
      const payment = paid ? (rng() < 0.65 ? "Cash" : "GCash") : null;
      const doneOn = status === "Completed" ? (age === 0 ? iso : addDays(iso, Math.min(age, between(rng, 1, 2)))) : null;
      const id = "FL-" + ymd(iso) + "-" + pad(i + 1);

      txRows.push([id, customerId[c.name], iso, pad(Math.floor(mins / 60)) + ":" + pad(mins % 60), service, o.qty,
        o.hanger, o.steam, o.rush, money.base, money.addons, money.rush, money.total, payment, status,
        status === "Ready" || status === "Completed", doneOn,
        delivery ? "Home delivery" : "Pickup at shop", delivery ? c.address : null, ownerId]);

      if (delivery) {
        let ds = "Pending";
        if (status === "Completed") ds = "Delivered";
        else if (status === "Ready" && rng() < 0.45) ds = "In transit";
        const who = pick(rng, staff);
        dlvRows.push([id, staffIdOf(who), ds]);
        if (status === "Completed" && age > 2 && rng() < 0.03) {
          incRows.push(["INC-" + ymd(iso) + "-" + pad(i + 1), id, iso, staffIdOf(who),
            pick(rng, ["Stain still on garment", "Wrong items delivered", "Item damaged in transit"]),
            "Re-cleaned and redelivered", true]);
        }
      }
    });

    // expenses for the day
    const erng = seeded("exp" + iso);
    let n = 0;
    const last = new Date(y, m, 0).getDate();
    const addExp = (cat, desc, amount) => expRows.push(["EX-" + ymd(iso) + "-" + pad(++n), iso, cat, desc, amount, ownerId]);
    if (erng() < 0.8) addExp("Staff purchases", pick(erng, ["Drinking water for staff", "Plastic bags", "Tape and marker", "Prepaid load for shop phone"]), between(erng, 6, 35) * 10);
    if (d === 15 || d === last) {
      staff.forEach((s) => addExp("Employee salaries", "Half-month salary - " + s, 6500));
      addExp("Employee salaries", "Half-month salary - Lea Domingo", 6000);
    }
    if (d === 5) addExp("Utilities", "Electricity bill (Meralco)", between(erng, 90, 125) * 100);
    if (d === 8) addExp("Utilities", "Water bill (Maynilad)", between(erng, 24, 36) * 100);
    if (d % 7 === 2) addExp("Cleaning & laundry supplies", pick(erng, ["Detergent and fabric conditioner", "Bleach and stain remover", "Laundry bags"]), between(erng, 15, 32) * 100);
    if (erng() < 0.035) addExp("Machine maintenance", pick(erng, ["Washer repair", "Dryer belt replacement", "Steam iron repair"]), between(erng, 8, 45) * 100);
  }

  console.log(`Adding ${txRows.length} orders, ${dlvRows.length} deliveries, ${expRows.length} expenses...`);
  await insertRows(pool, "transactions", ["tx_id", "customer_id", "tx_date", "tx_time", "service_name", "qty", "hanger", "steam",
    "rush", "base_amount", "addons_amount", "rush_fee", "total", "payment", "status", "sms_sent", "done_on", "fulfil",
    "address", "created_by"], txRows);
  await insertRows(pool, "deliveries", ["tx_id", "staff_id", "status"], dlvRows);
  if (incRows.length) await insertRows(pool, "incidents", ["incident_id", "tx_id", "incident_date", "staff_id", "reason", "resolution", "resolved"], incRows);
  await insertRows(pool, "expenses", ["expense_id", "expense_date", "category", "description", "amount", "created_by"], expRows);

  // ---------- online appointments: 3 days back to 4 days ahead ----------
  const SLOTS = ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM"];
  const slotMin = (s) => { const [t, ap] = s.split(" "); let [h, mm] = t.split(":").map(Number); if (ap === "PM" && h !== 12) h += 12; return h * 60 + mm; };
  const apptRows = [];
  for (let off = -3; off <= 4; off++) {
    const iso = addDays(today, off), rng = seeded("ap" + iso);
    const slots = SLOTS.slice().sort(() => rng() - 0.5).slice(0, between(rng, 3, 6)).sort((a, b) => slotMin(a) - slotMin(b));
    slots.forEach((slot, i) => {
      const c = pick(rng, customers), type = rng() < 0.55 ? "Home pickup" : "Drop-off at shop";
      const passed = off < 0 || (off === 0 && slotMin(slot) < nowMin - 60);
      const staffName = type === "Home pickup" && (off <= 0 || rng() < 0.4) ? pick(rng, staff) : null;
      apptRows.push(["AP-" + ymd(iso) + "-" + pad(i + 1), customerId[c.name], iso, slot, type,
        type === "Home pickup" ? c.address : null, rng() < 0.8 ? washFold : dryClean,
        staffName ? staffIdOf(staffName) : null, passed ? (rng() < 0.88 ? "Done" : "Cancelled") : "Booked"]);
    });
  }
  await insertRows(pool, "appointments", ["appt_id", "customer_id", "appt_date", "slot", "appt_type", "address",
    "service_name", "staff_id", "status"], apptRows);
  console.log(`Adding ${apptRows.length} appointments... done.`);
}

(async () => {
  try {
    const pool = await getPool();
    console.log("Connected to SQL Server. Creating accounts:");
    const ids = await seedUsers(pool);
    if (!USERS_ONLY) await seedSampleData(pool, ids);
    console.log("\nAll set. Run \"npm start\" and open http://localhost:" + (process.env.PORT || 3000));
    process.exit(0);
  } catch (err) {
    console.error("\nSeeding failed:", err.message);
    console.error("Check that SQL Server is running, you ran database/schema.sql, and server/.env is correct.");
    process.exit(1);
  }
})();
