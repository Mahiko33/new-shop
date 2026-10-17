// services.js - the shop's rules. The browser can ask for something, but the
// server decides: it computes every total, checks each step is allowed, and
// saves related changes together in one database transaction.
const { repo, withTransaction } = require("./repo");
const { sendSms } = require("./sms");

const CATEGORIES = ["Employee salaries", "Staff purchases", "Machine maintenance",
  "Cleaning & laundry supplies", "Utilities", "Other"];
const RETURN_REASONS = ["Stain still on garment", "Wrong items delivered", "Item damaged in transit",
  "Customer not satisfied with cleaning", "Other"];
const SHOP = "Fronia Laundry";

// An error the browser should see (status code + plain message)
class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- dates in the PC's local time (Philippines) ----------
const pad = (n) => String(n).padStart(2, "0");
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
}
function nowTime() { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
const ymd = (iso) => iso.slice(2).replace(/-/g, "");      // 2026-10-15 -> 261015

// ---------- the bill: base service + add-ons + rush ----------
function computeTotal(priceList, o) {
  const p = priceList.prices[o.service];
  const billed = Math.max(o.qty, p.min);
  const base = round2(billed * p.rate);
  const addons = round2(o.hanger * priceList.hanger + o.steam * priceList.steam);
  const rush = o.rush ? priceList.rush : 0;
  return { base, addons, rush, total: round2(base + addons + rush) };
}
const round2 = (n) => Math.round(n * 100) / 100;

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// =====================================================================
// Everything the dashboard needs when it opens
// =====================================================================
async function bootstrap() {
  const r = await repo();
  const today = todayISO();
  const from = (new Date().getFullYear() - 1) + "-01-01";       // January of last year
  const [priceList, staff, tx, exp, appt, inc] = await Promise.all([
    r.priceList(), r.staffNames(), r.transactionsSince(from), r.expensesSince(from),
    r.appointmentsBetween(addDays(today, -30), addDays(today, 60)), r.incidentsSince(from)
  ]);
  return {
    settings: { shop: SHOP, ...priceList, staff, categories: CATEGORIES },
    tx, exp, appt, inc
  };
}

// =====================================================================
// Transactions and order status
// =====================================================================
async function createTransaction(input, user) {
  const priceList = await (await repo()).priceList();
  const o = {
    customer: text(input.customer, 100),
    phone: String(input.phone || "").replace(/[\s-]/g, ""),
    service: String(input.service || ""),
    qty: Number(input.qty),
    hanger: Math.floor(Number(input.hanger) || 0),
    steam: Math.floor(Number(input.steam) || 0),
    rush: input.rush === true,
    fulfil: input.fulfil === "Home delivery" ? "Home delivery" : "Pickup at shop",
    payment: input.payment === "Cash" || input.payment === "GCash" ? input.payment : null,
    address: text(input.address, 200),
    staff: text(input.staff, 100),
    apptId: text(input.apptId, 20)
  };
  if (!o.customer) throw new AppError(400, "Enter the customer's name.");
  if (!/^09\d{9}$/.test(o.phone)) throw new AppError(400, "Enter an 11-digit mobile number starting with 09.");
  if (!priceList.prices[o.service]) throw new AppError(400, "Choose a service from the price list.");
  if (!(o.qty > 0 && o.qty <= 1000)) throw new AppError(400, "Enter a quantity between 0 and 1000.");
  if (o.hanger < 0 || o.hanger > 500 || o.steam < 0 || o.steam > 500) throw new AppError(400, "Check the add-on quantities.");
  if (o.fulfil === "Home delivery" && !o.address) throw new AppError(400, "Enter the delivery address.");

  const money = computeTotal(priceList, o);
  const today = todayISO();

  const saved = await withTransaction(async (r) => {
    let staffId = null;
    if (o.fulfil === "Home delivery" && o.staff) {
      staffId = await r.staffIdByName(o.staff);
      if (staffId === undefined) throw new AppError(400, "That delivery staff member doesn't exist.");
    }
    const customerId = await r.upsertCustomer(o.customer, o.phone, o.fulfil === "Home delivery" ? o.address : null);
    const id = await r.nextId("tx", "FL-" + ymd(today) + "-");
    await r.insertTransaction({
      id, customerId, date: today, time: nowTime(), service: o.service, qty: o.qty,
      hanger: o.hanger, steam: o.steam, rush: o.rush,
      base: money.base, addons: money.addons, rushFee: money.rush, total: money.total,
      payment: o.payment, fulfil: o.fulfil, address: o.fulfil === "Home delivery" ? o.address : null,
      userId: user.id
    });
    if (o.fulfil === "Home delivery") await r.insertDelivery(id, staffId);

    let appt = null;
    if (o.apptId) {
      const a = await r.getAppt(o.apptId);
      if (a && a.status === "Booked") {
        await r.updateAppointment(o.apptId, { status: "Done", txId: id });
        appt = await r.getAppt(o.apptId);
      }
    }
    return { tx: await r.getTx(id), appt };
  });
  return saved;
}

async function mustGetTx(r, id) {
  const t = await r.getTx(id);
  if (!t) throw new AppError(404, "Order " + id + " was not found.");
  return t;
}

// Received -> Washing -> Ready (Ready also texts the customer)
async function advanceOrder(id) {
  const result = await withTransaction(async (r) => {
    const t = await mustGetTx(r, id);
    if (t.status === "Received") {
      await r.updateTransaction(id, { status: "Washing" });
      return { tx: await r.getTx(id) };
    }
    if (t.status !== "Washing") throw new AppError(409, id + " is already " + t.status.toLowerCase() + ".");

    await r.updateTransaction(id, { status: "Ready", smsSent: true });
    if (t.delivery && t.delivery.status === "Returned") await r.updateDelivery(id, { status: "Pending" });
    const first = t.customer.split(" ")[0];
    const message = "Hi " + first + "! Your laundry (" + id + ") is ready" +
      (t.delivery ? " and will be delivered soon." : " for pickup at " + SHOP + ".") + " Total: P" + t.total.toFixed(2);
    await r.insertSms(id, t.phone, message);
    return { tx: await r.getTx(id), sms: { phone: t.phone, message } };
  });
  if (result.sms) await sendSms(result.sms.phone, result.sms.message);   // after it's saved
  return result;
}

// customer picked it up at the shop
async function claimOrder(id) {
  return withTransaction(async (r) => {
    const t = await mustGetTx(r, id);
    if (t.delivery) throw new AppError(409, "This is a delivery order. Use the Deliveries page.");
    if (t.status !== "Ready") throw new AppError(409, "Only orders that are Ready can be claimed.");
    if (!t.payment) throw new AppError(409, "Record the payment first (Cash or GCash).");
    await r.updateTransaction(id, { status: "Completed", doneOn: todayISO() });
    return { tx: await r.getTx(id) };
  });
}

async function recordPayment(id, method) {
  if (method !== "Cash" && method !== "GCash") throw new AppError(400, "Payment must be Cash or GCash.");
  return withTransaction(async (r) => {
    const t = await mustGetTx(r, id);
    if (t.payment) throw new AppError(409, id + " is already paid (" + t.payment + ").");
    await r.updateTransaction(id, { payment: method });
    return { tx: await r.getTx(id) };
  });
}

// =====================================================================
// Deliveries
// =====================================================================
async function mustGetDelivery(r, id) {
  const t = await mustGetTx(r, id);
  if (!t.delivery) throw new AppError(409, id + " is not a delivery order.");
  return t;
}

async function assignDelivery(id, staffName) {
  return withTransaction(async (r) => {
    const t = await mustGetDelivery(r, id);
    if (t.delivery.status !== "Pending" && t.delivery.status !== "Returned") {
      throw new AppError(409, "Staff can only be changed before the order is sent out.");
    }
    const staffId = await r.staffIdByName(text(staffName, 100));
    if (staffId === undefined) throw new AppError(400, "That delivery staff member doesn't exist.");
    await r.updateDelivery(id, { staffId });
    return { tx: await r.getTx(id) };
  });
}

async function sendOut(id) {
  return withTransaction(async (r) => {
    const t = await mustGetDelivery(r, id);
    if (t.status !== "Ready" || t.delivery.status !== "Pending") throw new AppError(409, "Only ready orders can be sent out.");
    if (!t.delivery.staff) throw new AppError(409, "Assign a delivery staff member first.");
    await r.updateDelivery(id, { status: "In transit" });
    return { tx: await r.getTx(id) };
  });
}

async function markDelivered(id, method) {
  return withTransaction(async (r) => {
    const t = await mustGetDelivery(r, id);
    if (t.delivery.status !== "In transit") throw new AppError(409, "Only orders in transit can be marked delivered.");
    const changes = { status: "Completed", doneOn: todayISO() };
    if (!t.payment) {
      if (method !== "Cash" && method !== "GCash") throw new AppError(400, "Choose how the customer paid (Cash or GCash).");
      changes.payment = method;
    }
    await r.updateTransaction(id, changes);
    await r.updateDelivery(id, { status: "Delivered" });
    await r.resolveIncidents(id, "Re-cleaned and redelivered");
    return { tx: await r.getTx(id), incidents: await r.incidentsForTx(id) };
  });
}

async function markReturned(id, reason) {
  if (!RETURN_REASONS.includes(reason)) throw new AppError(400, "Choose a reason for the return.");
  return withTransaction(async (r) => {
    const t = await mustGetDelivery(r, id);
    if (t.delivery.status !== "In transit") throw new AppError(409, "Only orders in transit can be returned.");
    const today = todayISO();
    const incidentId = await r.nextId("inc", "INC-" + ymd(today) + "-");
    await r.insertIncident({ id: incidentId, txId: id, date: today,
      staffId: (await r.staffIdByName(t.delivery.staff)) || null, reason });
    await r.updateTransaction(id, { status: "Washing", smsSent: false });
    await r.updateDelivery(id, { status: "Returned" });
    const incident = (await r.incidentsForTx(id)).find((i) => i.id === incidentId);
    return { tx: await r.getTx(id), incident };
  });
}

// =====================================================================
// Appointments
// =====================================================================
async function mustGetBookedAppt(r, id) {
  const a = await r.getAppt(id);
  if (!a) throw new AppError(404, "Appointment " + id + " was not found.");
  if (a.status !== "Booked") throw new AppError(409, "This appointment is already " + a.status.toLowerCase() + ".");
  return a;
}

async function assignPickup(id, staffName) {
  return withTransaction(async (r) => {
    const a = await mustGetBookedAppt(r, id);
    if (a.type !== "Home pickup") throw new AppError(409, "Only home pickups need a staff member.");
    const staffId = await r.staffIdByName(text(staffName, 100));
    if (staffId === undefined) throw new AppError(400, "That delivery staff member doesn't exist.");
    await r.updateAppointment(id, { staffId });
    return { appt: await r.getAppt(id) };
  });
}

async function cancelAppointment(id) {
  return withTransaction(async (r) => {
    await mustGetBookedAppt(r, id);
    await r.updateAppointment(id, { status: "Cancelled" });
    return { appt: await r.getAppt(id) };
  });
}

// =====================================================================
// Expenses
// =====================================================================
async function createExpense(input, user) {
  const e = {
    date: String(input.date || ""),
    category: String(input.category || ""),
    description: text(input.description, 200),
    amount: round2(Number(input.amount))
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date > todayISO()) throw new AppError(400, "Choose a date that isn't in the future.");
  if (!CATEGORIES.includes(e.category)) throw new AppError(400, "Choose a category from the list.");
  if (!e.description) throw new AppError(400, "Enter a description.");
  if (!(e.amount > 0 && e.amount < 10000000)) throw new AppError(400, "Enter an amount greater than zero.");

  return withTransaction(async (r) => {
    const id = await r.nextId("exp", "EX-" + ymd(e.date) + "-");
    await r.insertExpense({ id, ...e, userId: user.id });
    return { expense: await r.getExpense(id) };
  });
}

module.exports = {
  AppError, CATEGORIES, RETURN_REASONS, todayISO, addDays, computeTotal,
  bootstrap, createTransaction, advanceOrder, claimOrder, recordPayment,
  assignDelivery, sendOut, markDelivered, markReturned,
  assignPickup, cancelAppointment, createExpense
};
