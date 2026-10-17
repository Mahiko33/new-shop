// repo.js - EVERY SQL query the system runs is in this file.
// Values always go in as parameters (@name), never pasted into the SQL text,
// which protects the database from SQL injection.
const { sql, getPool } = require("./db");

// Builds the query functions on top of either the pool or a database transaction
function makeRepo(runner) {
  async function query(text, params = {}) {
    const request = new sql.Request(runner);
    for (const [name, value] of Object.entries(params)) request.input(name, value);
    const result = await request.query(text);
    return result.recordset || [];
  }

  // The columns the pages need, already in the shape the dashboard uses
  const TX_SELECT = `
    SELECT t.tx_id AS id, CONVERT(char(10), t.tx_date, 23) AS date, CONVERT(char(5), t.tx_time, 108) AS time,
           c.full_name AS customer, c.phone, t.service_name AS service, t.qty, t.hanger, t.steam, t.rush,
           t.base_amount AS base, t.addons_amount AS addons, t.rush_fee AS rushFee, t.total,
           ISNULL(t.payment, '') AS payment, t.status, t.sms_sent AS smsSent,
           ISNULL(CONVERT(char(10), t.done_on, 23), '') AS doneOn, t.fulfil, ISNULL(t.address, '') AS address,
           d.status AS deliveryStatus, ISNULL(u.full_name, '') AS deliveryStaff
    FROM transactions t
    JOIN customers c ON c.customer_id = t.customer_id
    LEFT JOIN deliveries d ON d.tx_id = t.tx_id
    LEFT JOIN users u ON u.user_id = d.staff_id`;

  function toTx(r) {
    const tx = {
      id: r.id, date: r.date, time: r.time.trim(), customer: r.customer, phone: r.phone,
      service: r.service, qty: Number(r.qty), hanger: r.hanger, steam: r.steam, rush: !!r.rush,
      base: Number(r.base), addons: Number(r.addons), rushFee: Number(r.rushFee), total: Number(r.total),
      payment: r.payment, status: r.status, smsSent: !!r.smsSent, doneOn: r.doneOn.trim(),
      address: r.address, delivery: null
    };
    if (r.deliveryStatus) tx.delivery = { staff: r.deliveryStaff, status: r.deliveryStatus };
    return tx;
  }

  const APPT_SELECT = `
    SELECT a.appt_id AS id, CONVERT(char(10), a.appt_date, 23) AS date, a.slot, c.full_name AS customer, c.phone,
           a.appt_type AS type, ISNULL(a.address, '') AS address, a.service_name AS service,
           ISNULL(u.full_name, '') AS staff, a.status, ISNULL(a.tx_id, '') AS txId
    FROM appointments a
    JOIN customers c ON c.customer_id = a.customer_id
    LEFT JOIN users u ON u.user_id = a.staff_id`;

  const INC_SELECT = `
    SELECT i.incident_id AS id, CONVERT(char(10), i.incident_date, 23) AS date, i.tx_id AS txId,
           c.full_name AS customer, ISNULL(u.full_name, '') AS staff, i.reason,
           ISNULL(i.resolution, '') AS resolution, i.resolved
    FROM incidents i
    JOIN transactions t ON t.tx_id = i.tx_id
    JOIN customers c ON c.customer_id = t.customer_id
    LEFT JOIN users u ON u.user_id = i.staff_id`;

  const EXP_SELECT = `
    SELECT expense_id AS id, CONVERT(char(10), expense_date, 23) AS date, category, description, amount
    FROM expenses`;

  const toExp = (r) => ({ ...r, amount: Number(r.amount) });
  const toInc = (r) => ({ ...r, resolved: !!r.resolved });

  // which table/column each kind of ID number belongs to
  const ID_COLUMNS = {
    tx: ["transactions", "tx_id"], appt: ["appointments", "appt_id"],
    inc: ["incidents", "incident_id"], exp: ["expenses", "expense_id"]
  };

  return {
    query,

    // ---------- users ----------
    async findUserByEmail(email) {
      const rows = await query(
        "SELECT user_id, full_name, email, password_hash, role FROM users WHERE email = @email AND is_active = 1",
        { email });
      return rows[0] || null;
    },
    async staffNames() {
      const rows = await query("SELECT full_name FROM users WHERE role = 'Delivery' AND is_active = 1 ORDER BY full_name");
      return rows.map((r) => r.full_name);
    },
    async staffIdByName(name) {
      if (!name) return null;
      const rows = await query("SELECT user_id FROM users WHERE full_name = @name AND role = 'Delivery'", { name });
      return rows[0] ? rows[0].user_id : undefined;   // undefined = not a delivery staff member
    },

    // ---------- price list ----------
    async priceList() {
      const services = await query("SELECT service_name, rate, unit, min_qty FROM services");
      const fees = await query("SELECT fee_key, amount FROM fees");
      const prices = {};
      services.forEach((s) => { prices[s.service_name] = { rate: Number(s.rate), unit: s.unit, min: Number(s.min_qty) }; });
      const fee = {};
      fees.forEach((f) => { fee[f.fee_key] = Number(f.amount); });
      return { prices, hanger: fee.hanger || 0, steam: fee.steam || 0, rush: fee.rush || 0 };
    },

    // ---------- reading records ----------
    async transactionsSince(fromDate) {
      return (await query(TX_SELECT + " WHERE t.tx_date >= @from", { from: fromDate })).map(toTx);
    },
    async getTx(id) {
      const rows = await query(TX_SELECT + " WHERE t.tx_id = @id", { id });
      return rows[0] ? toTx(rows[0]) : null;
    },
    async expensesSince(fromDate) {
      return (await query(EXP_SELECT + " WHERE expense_date >= @from", { from: fromDate })).map(toExp);
    },
    async getExpense(id) {
      const rows = await query(EXP_SELECT + " WHERE expense_id = @id", { id });
      return rows[0] ? toExp(rows[0]) : null;
    },
    async appointmentsBetween(fromDate, toDate) {
      return query(APPT_SELECT + " WHERE a.appt_date BETWEEN @from AND @to", { from: fromDate, to: toDate });
    },
    async getAppt(id) {
      const rows = await query(APPT_SELECT + " WHERE a.appt_id = @id", { id });
      return rows[0] || null;
    },
    async incidentsSince(fromDate) {
      return (await query(INC_SELECT + " WHERE i.incident_date >= @from", { from: fromDate })).map(toInc);
    },
    async incidentsForTx(txId) {
      return (await query(INC_SELECT + " WHERE i.tx_id = @txId", { txId })).map(toInc);
    },

    // ---------- writing records ----------
    // next number for a day, e.g. FL-261015-14. UPDLOCK/HOLDLOCK stops two users getting the same number.
    async nextId(kind, prefix) {
      const [table, column] = ID_COLUMNS[kind];
      const rows = await query(
        `SELECT ISNULL(MAX(CAST(SUBSTRING(${column}, LEN(@prefix) + 1, 10) AS INT)), 0) + 1 AS n
         FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE ${column} LIKE @prefix + '%'`,
        { prefix });
      return prefix + String(rows[0].n).padStart(2, "0");
    },

    // finds the customer by name + phone, or adds them; returns customer_id
    async upsertCustomer(name, phone, address) {
      const found = await query(
        "SELECT customer_id FROM customers WHERE full_name = @name AND phone = @phone", { name, phone });
      if (found[0]) {
        if (address) await query("UPDATE customers SET address = @address WHERE customer_id = @id",
          { address, id: found[0].customer_id });
        return found[0].customer_id;
      }
      const rows = await query(
        `INSERT INTO customers (full_name, phone, address) OUTPUT INSERTED.customer_id
         VALUES (@name, @phone, @address)`, { name, phone, address: address || null });
      return rows[0].customer_id;
    },

    async insertTransaction(t) {
      await query(
        `INSERT INTO transactions (tx_id, customer_id, tx_date, tx_time, service_name, qty, hanger, steam, rush,
            base_amount, addons_amount, rush_fee, total, payment, status, sms_sent, fulfil, address, created_by)
         VALUES (@id, @customerId, @date, @time, @service, @qty, @hanger, @steam, @rush,
            @base, @addons, @rushFee, @total, @payment, 'Received', 0, @fulfil, @address, @userId)`,
        t);
    },

    async updateTransaction(id, fields) {
      // only these columns can be changed
      const allowed = { status: "status", payment: "payment", smsSent: "sms_sent", doneOn: "done_on" };
      const sets = [], params = { id };
      for (const [key, column] of Object.entries(allowed)) {
        if (key in fields) { sets.push(`${column} = @${key}`); params[key] = fields[key]; }
      }
      if (sets.length) await query(`UPDATE transactions SET ${sets.join(", ")} WHERE tx_id = @id`, params);
    },

    async insertDelivery(txId, staffId) {
      await query("INSERT INTO deliveries (tx_id, staff_id, status) VALUES (@txId, @staffId, 'Pending')",
        { txId, staffId: staffId || null });
    },
    async updateDelivery(txId, fields) {
      const sets = ["updated_at = SYSDATETIME()"], params = { txId };
      if ("staffId" in fields) { sets.push("staff_id = @staffId"); params.staffId = fields.staffId; }
      if ("status" in fields) { sets.push("status = @status"); params.status = fields.status; }
      await query(`UPDATE deliveries SET ${sets.join(", ")} WHERE tx_id = @txId`, params);
    },

    async updateAppointment(id, fields) {
      const allowed = { status: "status", staffId: "staff_id", txId: "tx_id" };
      const sets = [], params = { id };
      for (const [key, column] of Object.entries(allowed)) {
        if (key in fields) { sets.push(`${column} = @${key}`); params[key] = fields[key]; }
      }
      if (sets.length) await query(`UPDATE appointments SET ${sets.join(", ")} WHERE appt_id = @id`, params);
    },

    async insertIncident(i) {
      await query(
        `INSERT INTO incidents (incident_id, tx_id, incident_date, staff_id, reason, resolved)
         VALUES (@id, @txId, @date, @staffId, @reason, 0)`, i);
    },
    async resolveIncidents(txId, resolution) {
      await query("UPDATE incidents SET resolved = 1, resolution = @resolution WHERE tx_id = @txId AND resolved = 0",
        { txId, resolution });
    },

    async insertExpense(e) {
      await query(
        `INSERT INTO expenses (expense_id, expense_date, category, description, amount, created_by)
         VALUES (@id, @date, @category, @description, @amount, @userId)`, e);
    },

    async insertSms(txId, phone, message) {
      await query("INSERT INTO sms_log (tx_id, phone, message) VALUES (@txId, @phone, @message)",
        { txId, phone, message });
    }
  };
}

// Runs several queries as ONE database transaction: all succeed, or none are saved
async function withTransaction(work) {
  const pool = await getPool();
  const trx = new sql.Transaction(pool);
  await trx.begin();
  try {
    const result = await work(makeRepo(trx));
    await trx.commit();
    return result;
  } catch (err) {
    try { await trx.rollback(); } catch (e) { /* already rolled back */ }
    throw err;
  }
}

// Plain (non-transaction) queries
async function repo() {
  return makeRepo(await getPool());
}

module.exports = { repo, withTransaction, makeRepo };
