// db.js - connects to Microsoft SQL Server using the settings in .env
require("dotenv").config();
const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "WashTrack",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",                 // false for SQL Server Express on your PC
    trustServerCertificate: process.env.DB_TRUST_CERT !== "false",
    useUTC: false                                               // keep dates in Philippine local time
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

// Use either a port (default 1433) or a named instance like SQLEXPRESS
if (process.env.DB_INSTANCE) config.options.instanceName = process.env.DB_INSTANCE;
else config.port = Number(process.env.DB_PORT || 1433);

let poolPromise = null;

// One shared connection pool for the whole app
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      poolPromise = null;              // try again on the next request
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
