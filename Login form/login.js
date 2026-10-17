// login.js - checks the email and password with the server (Node.js + SQL Server).
// The page must be opened through the server: http://localhost:3000
document.addEventListener("DOMContentLoaded", function () {
  var DASHBOARD_URL = "../Dashboard/dashboard.html";

  var form = document.getElementById("loginForm");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var submitBtn = form.querySelector('button[type="submit"]');
  var errorBox = document.getElementById("error");

  function showError(message, field) {
    errorBox.textContent = message;
    emailInput.classList.remove("invalid");
    passwordInput.classList.remove("invalid");
    if (field) field.classList.add("invalid");
  }

  // Opened by double-clicking the file? The server can't be reached from there.
  if (location.protocol === "file:") {
    showError("Start the server first (npm start), then open http://localhost:3000");
  }

  // Show / hide password
  var toggleBtn = document.getElementById("toggle");
  toggleBtn.addEventListener("click", function () {
    var hidden = passwordInput.type === "password";
    passwordInput.type = hidden ? "text" : "password";
    toggleBtn.textContent = hidden ? "Hide" : "Show";
    toggleBtn.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (email === "") { showError("Please enter your email.", emailInput); emailInput.focus(); return; }
    if (password === "") { showError("Please enter your password.", passwordInput); passwordInput.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Please enter a valid email address.", emailInput);
      emailInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";
    try {
      var res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok) {
        showError("");
        window.location.href = DASHBOARD_URL;
        return;
      }
      showError(data.error || "Login failed.", res.status === 401 ? passwordInput : null);
      if (res.status === 401) { passwordInput.value = ""; passwordInput.focus(); }
    } catch (err) {
      showError("Can't reach the server. Is it running? (npm start)");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "login";
    }
  });

  [emailInput, passwordInput].forEach(function (input) {
    input.addEventListener("input", function () { showError(""); });
  });
});
