// CPS Energy (Manage My Account) client scrape script.
//
// @url https://secure.cpsenergy.com/mma/login.jsp
//
// Runs inside the off-screen WebView mounted by scrape-runner.tsx. The runner
// injects this on every page load of the job URL and calls run_scrape(creds)
// each time, posting the single resolved result back to the host. Because the
// CPS login is a real server navigation (login page -> /mma/ dashboard), the
// script is written to survive re-injection across loads:
//
//   load 1 (login page): fill credentials, submit, return a promise that never
//                        resolves so NO message is posted; the navigation that
//                        follows triggers the next injection.
//   load 2 (dashboard):  wait for the JS-rendered balance/due-date fields to
//                        populate, read account number + balance + due date,
//                        then resolve once with { bills, usage }.
//
// Selectors and the login endpoint are taken from the captured login page
// (#appUname, #appPwrd, #applgbtn, #secureLoginpath) and dashboard (#accInfo,
// #balanceDue, #billDueDate, #account). The doLogin POST field names and AJAX
// contract live in an external JS file not captured, so login is performed by
// driving the page's own form rather than a hand-built request.
//
// The host expects: run_scrape(creds) -> { bills, usage }
//   bill_view  = { account_ref, due_date (ISO date), statement_id }
//   usage_view = { account_ref, period_start, period_end, amount, unit }
// No usage (kWh) data is present on these pages, so usage is returned empty.

// A promise that never settles. Returned on intermediate page loads so the
// injection wrapper posts nothing and waits for the next navigation.
function never() {
  return new Promise(function () {});
}

// Poll for a condition up to timeout_ms. Resolves with the predicate's truthy
// value, or rejects on timeout.
function wait_for(predicate, timeout_ms, interval_ms) {
  var deadline = Date.now() + (timeout_ms || 30000);
  var step = interval_ms || 250;
  return new Promise(function (resolve, reject) {
    (function poll() {
      var value;
      try {
        value = predicate();
      } catch (e) {
        value = null;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("wait_for timed out"));
        return;
      }
      setTimeout(poll, step);
    })();
  });
}

// First non-empty trimmed textContent among the given element ids.
function text_by_id() {
  for (var i = 0; i < arguments.length; i++) {
    var el = document.getElementById(arguments[i]);
    if (el) {
      var t = (el.textContent || "").trim();
      if (t) return t;
    }
  }
  return "";
}

// Pull a CPS account number (pattern 300-5640-343) out of an arbitrary text
// blob, or return the trimmed value of the #account hidden input if set.
function read_account_ref() {
  var acct = document.getElementById("account");
  if (acct && acct.value && acct.value.trim()) return acct.value.trim();
  var info = text_by_id("accInfo");
  var m = info.match(/\d{3}-\d{4}-\d{3}/);
  return m ? m[0] : "";
}

// Parse a CPS due-date string ("Jul 06, 2026") to an ISO date (YYYY-MM-DD).
// Returns "" when the field has not rendered or cannot be parsed.
function to_iso_date(text) {
  if (!text) return "";
  var d = new Date(text.replace(/\s+/g, " ").trim());
  if (isNaN(d.getTime())) return "";
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

// True when the current document is the unauthenticated login page.
function on_login_page() {
  return !!document.getElementById("appPwrd");
}

// True when the current document is the authenticated MMA dashboard.
function on_dashboard() {
  return !!document.getElementById("accInfo") ||
    !!document.getElementById("balanceDue");
}

// Fill the login form and trigger the site's own submit handler. The page
// binds the Log In button to applogin(); fall back to the form's login() or a
// native submit if neither global is present.
function submit_login(creds) {
  var user = document.getElementById("appUname");
  var pass = document.getElementById("appPwrd");
  if (!user || !pass) throw new Error("login inputs not found");
  // __set_value (provided by the host) sets the value without focusing, so the
  // keyboard never pops on the hidden WebView.
  window.__set_value(user, creds.username);
  window.__set_value(pass, creds.password);

  if (typeof window.applogin === "function") {
    window.applogin();
  } else if (typeof window.login === "function") {
    window.login();
  } else {
    var form = document.getElementById("appLogin");
    if (form) form.submit();
    else throw new Error("no login submit path found");
  }
}

// Read the rendered balance summary off the dashboard into a single bill_view.
// The statement id is not exposed as a stable field on this page; the view-bill
// form's #internalHashString is used when populated, otherwise the due date
// stands in as the per-statement identifier.
function read_dashboard_bill() {
  var account_ref = read_account_ref();
  var due_date = to_iso_date(text_by_id("billDueDate"));

  var hash_el = document.getElementById("internalHashString");
  var statement_id =
    hash_el && hash_el.value && hash_el.value.trim()
      ? hash_el.value.trim()
      : due_date;

  return { account_ref: account_ref, due_date: due_date, statement_id: statement_id };
}

// Host entry point.
function run_scrape(creds) {
  if (on_login_page()) {
    submit_login(creds);
    // Let the post-login navigation re-inject the script; post nothing now.
    return never();
  }

  if (on_dashboard()) {
    // The balance and due-date fields are filled by wssHome.js after load;
    // wait for the due-date element to render before reading.
    return wait_for(function () {
      return text_by_id("billDueDate") && read_account_ref();
    }, 30000).then(function () {
      var bill = read_dashboard_bill();
      return { bills: bill.account_ref ? [bill] : [], usage: [] };
    });
  }

  // Some other page (e.g. an interstitial). Wait to see whether it resolves to
  // the dashboard; if not, fail so the host surfaces an error.
  return wait_for(on_dashboard, 30000).then(function () {
    var bill = read_dashboard_bill();
    return { bills: bill.account_ref ? [bill] : [], usage: [] };
  });
}
