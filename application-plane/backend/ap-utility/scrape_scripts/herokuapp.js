// herokuapp client scrape script (test flow, hand-written).
//
// @url https://the-internet.herokuapp.com/
//
// Runs inside the off-screen WebView mounted by scrape-runner. The runner
// re-injects this on every page load and calls run_scrape(creds) each time.
// Navigation steps that cause a page load advance a pointer so the flow resumes
// on the next injection; non-navigating steps run consecutively within one
// load. When the recorded extraction point is reached, the embedded routine
// reads the billing data and resolves once.
//
// Exercises every step type against a public automation-practice site:
// goto (initial and mid-flow), click (navigating), fill_text, wait_for, and
// fill_credential. Log in with username "tomsmith" and password
// "SuperSecretPassword!". The extraction reads the secure-area flash message
// and reports its character count as the bill total with a dummy due date.
//
// Each element is located by the same identity the recorder captures (id, then
// name, aria-label, placeholder, then role + visible text) rather than a
// brittle CSS path, so small DOM differences between record and replay don't
// break it. The step pointer lives in window.name (survives cross-origin
// navigations; empty in a fresh WebView, so each job starts at step 0).

var NAV_STEPS = [
  {
    "type": "goto",
    "url": "https://the-internet.herokuapp.com/"
  },
  {
    "type": "click",
    "descriptor": {
      "tag": "a",
      "id": "",
      "name": "",
      "aria_label": "",
      "placeholder": "",
      "role": "",
      "text": "Key Presses"
    }
  },
  {
    "type": "fill_text",
    "descriptor": {
      "tag": "input",
      "id": "target",
      "name": "",
      "aria_label": "",
      "placeholder": "",
      "role": "",
      "text": ""
    },
    "value": "scrape-runner test"
  },
  {
    "type": "goto",
    "url": "https://the-internet.herokuapp.com/login"
  },
  {
    "type": "wait_for",
    "descriptor": {
      "tag": "input",
      "id": "username",
      "name": "username",
      "aria_label": "",
      "placeholder": "",
      "role": "",
      "text": ""
    }
  },
  {
    "type": "fill_credential",
    "descriptor": {
      "tag": "input",
      "id": "username",
      "name": "username",
      "aria_label": "",
      "placeholder": "",
      "role": "",
      "text": ""
    },
    "which": "username"
  },
  {
    "type": "fill_credential",
    "descriptor": {
      "tag": "input",
      "id": "password",
      "name": "password",
      "aria_label": "",
      "placeholder": "",
      "role": "",
      "text": ""
    },
    "which": "password"
  },
  {
    "type": "click",
    "descriptor": {
      "tag": "button",
      "id": "",
      "name": "",
      "aria_label": "",
      "placeholder": "",
      "role": "",
      "text": "Login"
    }
  }
];

var EXTRACTION = () => {
  const flash = document.querySelector('#flash');
  if (!flash) return { bills: [], usage: [] };
  const message = flash.textContent.trim();
  return {
    bills: [{ due_date: "2026-12-31", total: message.length }],
    usage: []
  };
};

var NAME_PREFIX = "__recorder_step:";

function never() {
  return new Promise(function () {});
}

// Locate an element by the recorder's captured identity, most-stable first.
function find_el(d) {
  if (d.id) {
    var byId = document.getElementById(d.id);
    if (byId) return byId;
  }
  if (d.name) {
    var byName = document.querySelector('[name="' + d.name.replace(/"/g, '\\"') + '"]');
    if (byName) return byName;
  }
  if (d.aria_label) {
    var byAria = document.querySelector('[aria-label="' + d.aria_label.replace(/"/g, '\\"') + '"]');
    if (byAria) return byAria;
  }
  if (d.placeholder) {
    var byPlace = document.querySelector('[placeholder="' + d.placeholder.replace(/"/g, '\\"') + '"]');
    if (byPlace) return byPlace;
  }
  if (d.text) {
    var nodes = document.querySelectorAll(d.tag || 'button, a, input, [role]');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].innerText || nodes[i].textContent || '').trim();
      if (t === d.text) return nodes[i];
    }
  }
  return null;
}

// Poll for an element matching the descriptor until it appears or times out.
function wait_el(d, timeout_ms) {
  var deadline = Date.now() + (timeout_ms || 30000);
  return new Promise(function (resolve, reject) {
    (function poll() {
      var el = find_el(d);
      if (el) { resolve(el); return; }
      if (Date.now() > deadline) { reject(new Error("element not found")); return; }
      setTimeout(poll, 250);
    })();
  });
}

// Run the extraction routine, retrying while the page renders its JS-populated
// billing fields. Returns whatever it has after the last attempt.
function extract_with_retry(attempts) {
  return Promise.resolve(EXTRACTION()).then(function (result) {
    var bills = (result && result.bills) || [];
    var usage = (result && result.usage) || [];
    if (bills.length || usage.length || attempts <= 0) {
      return { bills: bills, usage: usage };
    }
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(extract_with_retry(attempts - 1)); }, 500);
    });
  });
}

function get_step() {
  var name = window.name || "";
  if (name.indexOf(NAME_PREFIX) !== 0) return 0;
  return parseInt(name.slice(NAME_PREFIX.length), 10) || 0;
}

function set_step(i) {
  window.name = NAME_PREFIX + String(i);
}

// Run one recorded navigation step. Resolves "continue" to keep stepping in this
// same load, or "navigated" when a page load follows (wait for re-injection).
function run_step(step, creds, idx) {
  if (step.type === "fill_credential") {
    return wait_el(step.descriptor).then(function (el) {
      window.__set_value(el, step.which === "username" ? creds.username : creds.password);
      return "continue";
    });
  }
  if (step.type === "fill_text") {
    return wait_el(step.descriptor).then(function (el) {
      window.__set_value(el, step.value);
      return "continue";
    });
  }
  if (step.type === "wait_for") {
    return wait_el(step.descriptor).then(function () { return "continue"; });
  }
  if (step.type === "click") {
    return wait_el(step.descriptor).then(function (el) {
      // Advance the pointer before clicking. A click may navigate, tearing the
      // context down at any moment afterward; the pointer must already point at
      // the next step so re-injection resumes past this click.
      set_step(idx + 1);
      el.click();
      // The click may instead update in place (no reload). Settle: navigation
      // preempts by destroying the context, otherwise keep stepping.
      return new Promise(function (resolve) {
        setTimeout(function () { resolve("continue"); }, 3000);
      });
    });
  }
  if (step.type === "goto") {
    window.location.href = step.url;
    return Promise.resolve("navigated");
  }
  return Promise.reject(new Error("unknown step type " + step.type));
}

// Progress line to the native console when the runner provides __log.
function log(msg) {
  if (typeof window.__log === "function") window.__log(msg);
}

function run_scrape(creds) {
  if (get_step() >= NAV_STEPS.length) {
    window.name = "";
    log("all steps done, extracting");
    return extract_with_retry(20).then(function (result) {
      log("extraction returned " + result.bills.length + " bills");
      return result;
    });
  }

  function step_loop() {
    var idx = get_step();
    if (idx >= NAV_STEPS.length) return run_scrape(creds);
    log("step " + idx + " (" + NAV_STEPS[idx].type + ") starting");
    return run_step(NAV_STEPS[idx], creds, idx).then(function (outcome) {
      log("step " + idx + " outcome=" + outcome);
      set_step(idx + 1);
      if (outcome === "navigated") return never();
      return step_loop();
    }, function (err) {
      log("step " + idx + " failed: " + String(err && err.message ? err.message : err));
      throw err;
    });
  }

  return step_loop();
}
