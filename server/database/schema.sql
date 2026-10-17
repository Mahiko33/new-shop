IF DB_ID('WashTrack') IS NULL
    CREATE DATABASE WashTrack;
GO

USE WashTrack;
GO


DROP TABLE IF EXISTS sms_log;
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS deliveries;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS fees;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS users;
GO


CREATE TABLE users (
    user_id       INT IDENTITY(1,1) PRIMARY KEY,
    full_name     NVARCHAR(100) NOT NULL,
    email         NVARCHAR(150) NOT NULL UNIQUE,
    password_hash NVARCHAR(100) NOT NULL,            
    role          NVARCHAR(20)  NOT NULL CHECK (role IN ('Owner', 'Counter', 'Delivery')),
    is_active     BIT NOT NULL DEFAULT 1,
    created_at    DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);

/* ---------- Price list ---------- */
CREATE TABLE services (
    service_name NVARCHAR(50)  NOT NULL PRIMARY KEY,  
    rate         DECIMAL(10,2) NOT NULL CHECK (rate >= 0),
    unit         NVARCHAR(10)  NOT NULL,              
    min_qty      DECIMAL(6,2)  NOT NULL DEFAULT 1
);

CREATE TABLE fees (
    fee_key NVARCHAR(30)  NOT NULL PRIMARY KEY,       
    label   NVARCHAR(50)  NOT NULL,
    amount  DECIMAL(10,2) NOT NULL CHECK (amount >= 0)
);

/* ---------- Customers ---------- */
CREATE TABLE customers (
    customer_id INT IDENTITY(1,1) PRIMARY KEY,
    full_name   NVARCHAR(100) NOT NULL,
    phone       VARCHAR(11)   NOT NULL,               
    address     NVARCHAR(200) NULL,
    created_at  DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT uq_customer UNIQUE (full_name, phone)
);


CREATE TABLE transactions (
    tx_id         VARCHAR(20)   NOT NULL PRIMARY KEY,  -- e.g. FL-261015-01
    customer_id   INT           NOT NULL,
    tx_date       DATE          NOT NULL,              -- drop-off date
    tx_time       TIME(0)       NOT NULL,
    service_name  NVARCHAR(50)  NOT NULL,
    qty           DECIMAL(6,2)  NOT NULL CHECK (qty > 0),
    hanger        INT           NOT NULL DEFAULT 0 CHECK (hanger >= 0),
    steam         INT           NOT NULL DEFAULT 0 CHECK (steam >= 0),
    rush          BIT           NOT NULL DEFAULT 0,
    base_amount   DECIMAL(10,2) NOT NULL,              -- computed by the server
    addons_amount DECIMAL(10,2) NOT NULL,
    rush_fee      DECIMAL(10,2) NOT NULL,
    total         DECIMAL(10,2) NOT NULL,
    payment       VARCHAR(10)   NULL CHECK (payment IN ('Cash', 'GCash')),   -- NULL = not yet paid
    status        VARCHAR(12)   NOT NULL DEFAULT 'Received'
                  CHECK (status IN ('Received', 'Washing', 'Ready', 'Completed')),
    sms_sent      BIT           NOT NULL DEFAULT 0,
    done_on       DATE          NULL,                  -- date it was claimed / delivered
    fulfil        VARCHAR(20)   NOT NULL DEFAULT 'Pickup at shop'
                  CHECK (fulfil IN ('Pickup at shop', 'Home delivery')),
    address       NVARCHAR(200) NULL,                  -- delivery address
    created_by    INT           NULL,
    created_at    DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT fk_tx_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    CONSTRAINT fk_tx_service  FOREIGN KEY (service_name) REFERENCES services(service_name),
    CONSTRAINT fk_tx_user     FOREIGN KEY (created_by) REFERENCES users(user_id)
);
CREATE INDEX ix_transactions_date ON transactions(tx_date);

/* ---------- Deliveries (only for Home delivery orders) ---------- */
CREATE TABLE deliveries (
    tx_id      VARCHAR(20) NOT NULL PRIMARY KEY,
    staff_id   INT         NULL,
    status     VARCHAR(12) NOT NULL DEFAULT 'Pending'
               CHECK (status IN ('Pending', 'In transit', 'Delivered', 'Returned')),
    updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT fk_delivery_tx    FOREIGN KEY (tx_id) REFERENCES transactions(tx_id),
    CONSTRAINT fk_delivery_staff FOREIGN KEY (staff_id) REFERENCES users(user_id)
);

/* ---------- Online appointments ---------- */
CREATE TABLE appointments (
    appt_id      VARCHAR(20)   NOT NULL PRIMARY KEY,   -- e.g. AP-261015-01
    customer_id  INT           NOT NULL,
    appt_date    DATE          NOT NULL,
    slot         VARCHAR(10)   NOT NULL,               -- '9:00 AM'
    appt_type    VARCHAR(20)   NOT NULL CHECK (appt_type IN ('Home pickup', 'Drop-off at shop')),
    address      NVARCHAR(200) NULL,
    service_name NVARCHAR(50)  NOT NULL,
    staff_id     INT           NULL,
    status       VARCHAR(10)   NOT NULL DEFAULT 'Booked' CHECK (status IN ('Booked', 'Done', 'Cancelled')),
    tx_id        VARCHAR(20)   NULL,
    created_at   DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT fk_appt_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    CONSTRAINT fk_appt_service  FOREIGN KEY (service_name) REFERENCES services(service_name),
    CONSTRAINT fk_appt_staff    FOREIGN KEY (staff_id) REFERENCES users(user_id),
    CONSTRAINT fk_appt_tx       FOREIGN KEY (tx_id) REFERENCES transactions(tx_id)
);
CREATE INDEX ix_appointments_date ON appointments(appt_date);

/* ---------- Returned deliveries ---------- */
CREATE TABLE incidents (
    incident_id   VARCHAR(20)   NOT NULL PRIMARY KEY,  -- e.g. INC-261015-01
    tx_id         VARCHAR(20)   NOT NULL,
    incident_date DATE          NOT NULL,
    staff_id      INT           NULL,
    reason        NVARCHAR(100) NOT NULL,
    resolution    NVARCHAR(200) NULL,
    resolved      BIT           NOT NULL DEFAULT 0,
    CONSTRAINT fk_incident_tx    FOREIGN KEY (tx_id) REFERENCES transactions(tx_id),
    CONSTRAINT fk_incident_staff FOREIGN KEY (staff_id) REFERENCES users(user_id)
);

/* ---------- Expenses ---------- */
CREATE TABLE expenses (
    expense_id   VARCHAR(20)   NOT NULL PRIMARY KEY,   -- e.g. EX-261015-01
    expense_date DATE          NOT NULL,
    category     NVARCHAR(40)  NOT NULL CHECK (category IN ('Employee salaries', 'Staff purchases',
                 'Machine maintenance', 'Cleaning & laundry supplies', 'Utilities', 'Other')),
    description  NVARCHAR(200) NOT NULL,
    amount       DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    created_by   INT           NULL,
    created_at   DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT fk_expense_user FOREIGN KEY (created_by) REFERENCES users(user_id)
);
CREATE INDEX ix_expenses_date ON expenses(expense_date);

/* ---------- Every SMS the system sent ---------- */
CREATE TABLE sms_log (
    sms_id  INT IDENTITY(1,1) PRIMARY KEY,
    tx_id   VARCHAR(20)   NOT NULL,
    phone   VARCHAR(11)   NOT NULL,
    message NVARCHAR(320) NOT NULL,
    sent_at DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT fk_sms_tx FOREIGN KEY (tx_id) REFERENCES transactions(tx_id)
);
GO

/* ---------- Price list (SAMPLE values - change to the shop's real prices) ---------- */
INSERT INTO services (service_name, rate, unit, min_qty) VALUES
    (N'Wash & fold', 40, N'kg', 3),
    (N'Dry cleaning', 150, N'pc', 1);

INSERT INTO fees (fee_key, label, amount) VALUES
    (N'hanger', N'Coat hanger (each)', 10),
    (N'steam',  N'Steam pressing (per piece)', 30),
    (N'rush',   N'Rush order', 80);
GO

/* ---------- Login used by the Node.js server ----------
   Change the password here AND in server/.env (DB_PASSWORD). */
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'washtrack_app')
    CREATE LOGIN washtrack_app WITH PASSWORD = 'WashTrack#2026', CHECK_POLICY = OFF;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'washtrack_app')
    CREATE USER washtrack_app FOR LOGIN washtrack_app;
ALTER ROLE db_datareader ADD MEMBER washtrack_app;
ALTER ROLE db_datawriter ADD MEMBER washtrack_app;
GO

PRINT 'WashTrack database is ready. Next: run "npm run seed" in the server folder.';
