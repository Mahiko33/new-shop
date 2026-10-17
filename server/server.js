// server.js - starts the Wash Track System.
// Run "npm start", then open http://localhost:3000 in the browser.
require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { repo } = require("./repo");
const svc = require("./services");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..");              // the "main" folder
const LOGIN_PAGE = "/Login%20form/login.html";

app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "washtrack.sid",
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }   // logged in for 8 hours
}));

// ---------- pages ----------
// The login page is public. The dashboard is only served to someone who is logged in.
app.get("/", (req, res) => res.redirect(req.session.user ? "/Dashboard/dashboard.html" : LOGIN_PAGE));
app.use("/Login%20form", express.static(path.join(ROOT, "Login form")));
app.use("/Dashboard", (req, res, next) => {
  if (!req.session.user) return res.redirect(LOGIN_PAGE);
  next();
}, express.static(path.join(ROOT, "Dashboard")));

// ---------- helpers ----------
// wraps each route so errors become a clear JSON message instead of crashing the server
const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    const dbDown = /ConnectionError|ESOCKET|ELOGIN|ETIMEOUT|Failed to connect/i.test(err.name + " " + err.message);
    res.status(dbDown ? 503 : 500).json({
      error: dbDown ? "Can't reach the database. Check that SQL Server is running and the settings in server/.env."
                    : "Something went wrong on the server. Check the terminal for details."
    });
  }
};

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in again." });
  next();
}

// ---------- login / logout ----------
app.post("/api/login", route(async (req) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) throw new svc.AppError(400, "Enter your email and password.");

  const user = await (await repo()).findUserByEmail(email);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) throw new svc.AppError(401, "Incorrect email or password.");

  // new session id on every login (prevents session fixation)
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.user = { id: user.user_id, name: user.full_name, email: user.email, role: user.role };
  return { user: req.session.user };
}));

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("washtrack.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireLogin, (req, res) => res.json({ user: req.session.user }));

// ---------- everything below needs a logged-in user ----------
app.use("/api", requireLogin);

app.get("/api/bootstrap", route(async (req) => ({ user: req.session.user, ...(await svc.bootstrap()) })));

app.post("/api/transactions", route((req) => svc.createTransaction(req.body, req.session.user)));
app.post("/api/transactions/:id/advance", route((req) => svc.advanceOrder(req.params.id)));
app.post("/api/transactions/:id/claim", route((req) => svc.claimOrder(req.params.id)));
app.post("/api/transactions/:id/pay", route((req) => svc.recordPayment(req.params.id, req.body.method)));

app.post("/api/deliveries/:id/assign", route((req) => svc.assignDelivery(req.params.id, req.body.staff)));
app.post("/api/deliveries/:id/send", route((req) => svc.sendOut(req.params.id)));
app.post("/api/deliveries/:id/delivered", route((req) => svc.markDelivered(req.params.id, req.body.method)));
app.post("/api/deliveries/:id/returned", route((req) => svc.markReturned(req.params.id, req.body.reason)));

app.post("/api/appointments/:id/assign", route((req) => svc.assignPickup(req.params.id, req.body.staff)));
app.post("/api/appointments/:id/cancel", route((req) => svc.cancelAppointment(req.params.id)));

app.post("/api/expenses", route((req) => svc.createExpense(req.body, req.session.user)));

app.use("/api", (req, res) => res.status(404).json({ error: "Unknown API address." }));

// ---------- start ----------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Wash Track System is running: http://localhost:${PORT}`);
  });
}

module.exports = app;
