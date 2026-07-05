# Standalone login-flow recorder.
#
# Drives a real browser with Playwright while an LLM (Claude) decides the
# navigation. The model sees the page as Playwright's accessibility tree (role +
# accessible name per element) and acts on elements by role and name, so
# Playwright's own engine resolves and auto-waits for them. The login
# credentials are entered at the prompt, stored as environment variables, filled
# into the browser by this harness, and never placed in any prompt.
#
# When the model reaches the billing data and supplies an extraction routine,
# the recorder writes a per-site `<site_id>.js` scrape script (the WebView
# run_scrape format) that replays the learned path without the LLM.
#
# Usage:
#   ANTHROPIC_API_KEY is read from the .env file in this folder.
#   python recorder.py
#   Select the site from the numbered menu, then enter the login credentials at
#   the prompt.
#
# Add --headed to watch the browser. Output is written to ./out/<site_id>.js.

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

MODEL = "claude-opus-4-8"
USERNAME_ENV = "RECORDER_USERNAME"
PASSWORD_ENV = "RECORDER_PASSWORD"
MAX_STEPS = 40

# The canonical root URL each supported site must start from. The generated
# script begins at this URL for its site-id; nothing else may seed the start.
SITE_ROOTS = {
    "cps": "https://www.cpsenergy.com/",
    "att": "https://www.att.com/",
}

# Roles worth surfacing to the model from the accessibility tree.
INTERESTING_ROLES = {
    "button", "link", "textbox", "searchbox", "combobox", "checkbox",
    "radio", "menuitem", "tab", "switch", "spinbutton",
}

# Captures the stable identity of a resolved element for the replay script.
# Excludes the element's value so a typed credential cannot be recorded.
DESCRIBE_JS = """el => ({
  tag: el.tagName.toLowerCase(),
  id: el.id || '',
  name: el.getAttribute('name') || '',
  aria_label: el.getAttribute('aria-label') || '',
  placeholder: el.getAttribute('placeholder') || '',
  role: el.getAttribute('role') || '',
  text: (el.innerText || el.textContent || '').trim().slice(0, 80)
})"""

SYSTEM_PROMPT = """You are driving a real web browser to learn a utility \
provider's login-and-scrape flow. You never see the username or password; the \
harness fills those when you call fill_credential.

Each turn you receive the current page as a list of interactive elements from \
the accessibility tree (each with a role and accessible name), the URL and \
title, the rendered page text (page_text), and the page HTML (html). Act on an \
element by giving its role and name. Call exactly one tool per turn.

When you write extraction_js, base it on the actual page_text and html shown, \
not on assumed label wording. Prefer reading the specific DOM nodes that hold \
the balance, due date, and account number over matching generic label strings, \
so the routine keeps working when surrounding text changes.

The objective is to capture the MOST RECENT bill for the account, and stop as \
soon as you have it. Do not page through bill history; one bill_view for the \
latest statement is the goal.

Steps, in order:
1. Log in: fill the username textbox (fill_credential which="username"), fill \
the password textbox (fill_credential which="password"), then click the submit \
button.
2. Navigate to the page that shows the current/most recent bill (its balance, \
due date, and account number; usage if present on the same view).
3. Once the most recent bill is visible, call extract_data with a JavaScript \
routine that reads it from the DOM and returns { bills, usage } where bills \
contains exactly the most recent statement:
   bill_view = { due_date (ISO date YYYY-MM-DD), total (number, the amount due) }
   usage_view = { account_ref (string, the account number), period_start (ISO \
date YYYY-MM-DD), period_end (ISO date YYYY-MM-DD), amount (number), unit \
(string, e.g. kWh) }
   bills must contain the most recent bill. usage must contain a usage_view per \
usage row shown on the same view; return [] for usage only when the view shows \
no usage data.
4. Call finish. Only call finish after extract_data has succeeded with the most \
recent bill; do not call it before then.

If an element you need has not rendered yet, call wait_for with its role and \
name before acting on it."""

TOOLS = [
    {
        "name": "fill_credential",
        "description": "Fill the username or password field. The harness "
        "substitutes the real secret; you never see it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "role": {"type": "string", "description": "Accessibility role, e.g. textbox."},
                "name": {"type": "string", "description": "Accessible name of the field."},
                "which": {"type": "string", "enum": ["username", "password"]},
            },
            "required": ["role", "name", "which"],
            "additionalProperties": False,
        },
    },
    {
        "name": "fill_text",
        "description": "Type a non-secret value into a field. Never use this for credentials.",
        "input_schema": {
            "type": "object",
            "properties": {
                "role": {"type": "string"},
                "name": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["role", "name", "value"],
            "additionalProperties": False,
        },
    },
    {
        "name": "click",
        "description": "Click an element by role and accessible name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "role": {"type": "string"},
                "name": {"type": "string"},
            },
            "required": ["role", "name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "goto",
        "description": "Navigate directly to a URL.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
            "additionalProperties": False,
        },
    },
    {
        "name": "wait_for",
        "description": "Wait for an element (role + name) to be visible before continuing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "role": {"type": "string"},
                "name": {"type": "string"},
            },
            "required": ["role", "name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "extract_data",
        "description": "Provide a JavaScript routine that reads the billing data "
        "from the current page and returns { bills, usage }. It is a complete "
        "arrow function: () => { ... return { bills, usage }; }.",
        "input_schema": {
            "type": "object",
            "properties": {
                "extraction_js": {
                    "type": "string",
                    "description": "Arrow function source returning { bills, usage }.",
                }
            },
            "required": ["extraction_js"],
            "additionalProperties": False,
        },
    },
    {
        "name": "finish",
        "description": "Signal the flow is fully recorded.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


def snapshot(page):
    """The page as a flat list of interesting accessibility nodes, plus URL/title.

    A preceding action may still be navigating; wait for load and retry.
    """
    last_err = None
    for _ in range(5):
        try:
            page.wait_for_load_state("domcontentloaded", timeout=15000)
        except PlaywrightTimeout:
            pass
        try:
            tree = page.accessibility.snapshot(interesting_only=True)
            break
        except PlaywrightError as e:
            if "Execution context was destroyed" not in str(e):
                raise
            last_err = e
            page.wait_for_timeout(1000)
    else:
        raise last_err

    elements = []

    def walk(node):
        role = node.get("role", "")
        name = (node.get("name") or "").strip()
        if role in INTERESTING_ROLES:
            elements.append({"role": role, "name": name})
        for child in node.get("children", []) or []:
            walk(child)

    if tree:
        walk(tree)

    # The accessibility tree only carries interactive nodes; billing values
    # (balance, due date, account number) are static text the model must read to
    # write a correct extraction routine. Surface the rendered text and HTML so
    # the model authors extraction_js against what is actually on the page.
    page_text = page.evaluate(
        "() => document.body ? document.body.innerText : ''"
    ) or ""
    page_html = page.evaluate(
        "() => document.body ? document.body.outerHTML : ''"
    ) or ""
    return {
        "url": page.url,
        "title": page.title(),
        "elements": elements[:80],
        "page_text": page_text[:12000],
        "html": page_html[:40000],
    }


def locator_for(page, role, name):
    """Resolve a role+name to a single Playwright locator."""
    if name:
        return page.get_by_role(role, name=name, exact=False).first
    return page.get_by_role(role).first


def _retry_nav(fn):
    """Run a page action, retrying transient races from an in-flight navigation."""
    last_err = None
    for _ in range(4):
        try:
            return fn()
        except (PlaywrightError, PlaywrightTimeout) as e:
            msg = str(e)
            if not ("Execution context was destroyed" in msg
                    or "detached" in msg or "navigation" in msg):
                raise
            last_err = e
    raise last_err


def describe(locator):
    """Capture the stable identity of a located element for the replay script."""
    return locator.element_handle(timeout=30000).evaluate(DESCRIBE_JS)


def run_action(page, name, args, creds, steps):
    """Execute one model action against the live page; record replayable steps.

    Returns a short status string for the model.
    """
    if name in ("fill_credential", "fill_text", "click", "wait_for"):
        loc = locator_for(page, args["role"], args["name"])

    if name == "fill_credential":
        value = creds[args["which"]]
        _retry_nav(lambda: loc.fill(value, timeout=30000))
        steps.append({"type": "fill_credential", "descriptor": describe(loc),
                      "which": args["which"]})
        return f"filled {args['which']} into {args['role']} '{args['name']}'"

    if name == "fill_text":
        _retry_nav(lambda: loc.fill(args["value"], timeout=30000))
        steps.append({"type": "fill_text", "descriptor": describe(loc),
                      "value": args["value"]})
        return f"typed into {args['role']} '{args['name']}'"

    if name == "click":
        descriptor = describe(loc)
        steps.append({"type": "click", "descriptor": descriptor})
        _retry_nav(lambda: loc.click(timeout=30000))
        return f"clicked {args['role']} '{args['name']}'"

    if name == "wait_for":
        _retry_nav(lambda: loc.wait_for(state="visible", timeout=30000))
        steps.append({"type": "wait_for", "descriptor": describe(loc)})
        return f"{args['role']} '{args['name']}' is visible"

    if name == "goto":
        # Record where navigation actually lands, not the requested URL. A
        # requested URL may redirect (or partially 404 and be reloaded), so the
        # effective page.url is what replay must revisit.
        page.goto(args["url"])
        try:
            page.wait_for_load_state("domcontentloaded", timeout=15000)
        except PlaywrightTimeout:
            pass
        landed = page.url
        steps.append({"type": "goto", "url": landed})
        return f"navigated to {landed}"

    if name == "extract_data":
        result = page.evaluate(args["extraction_js"])
        if not isinstance(result, dict) or "bills" not in result or "usage" not in result:
            return "extraction_js did not return an object with bills and usage; revise."
        bills = result.get("bills") or []
        if not bills:
            return ("extraction returned no bills; the most recent bill is the "
                    "objective. Navigate to the bill and revise the routine so "
                    "bills contains it.")
        # Show the extracted values to the user and require confirmation that they
        # match the real bill on screen. The model's self-check is not enough; a
        # human verifies the fields before the routine is accepted.
        usage = result.get("usage") or []
        print("\nExtracted from the current page:")
        print(f"  bills: {json.dumps(bills, indent=2)}")
        print(f"  usage: {json.dumps(usage, indent=2)}")
        answer = input("Do these match the bill shown on the page? [y/N]: ").strip().lower()
        if answer not in ("y", "yes"):
            return ("the user reviewed the extracted values and they are NOT "
                    "correct. Inspect page_text/html again and revise "
                    "extraction_js so every field matches the most recent bill, "
                    "then call extract_data.")
        # Drop any previous attempt; keep only this user-confirmed one.
        steps[:] = [s for s in steps if s["type"] != "extract"]
        steps.append({"type": "extract", "extraction_js": args["extraction_js"]})
        return (f"user confirmed the extracted values ({len(bills)} bill(s), "
                f"{len(usage)} usage rows) are correct. Call finish.")

    return f"unknown action {name}"


def generate_script(site_id, url, steps):
    """Emit the per-site WebView run_scrape script from the recorded steps."""
    nav_steps = [s for s in steps if s["type"] != "extract"]
    extract = next((s for s in steps if s["type"] == "extract"), None)
    extraction_js = extract["extraction_js"] if extract else "() => ({ bills: [], usage: [] })"
    steps_json = json.dumps(nav_steps, indent=2)

    return f"""// {site_id} client scrape script (generated by login-flow-recorder).
//
// @url {url}
//
// Runs inside the off-screen WebView mounted by scrape-runner. The runner
// re-injects this on every page load and calls run_scrape(creds) each time.
// Navigation steps that cause a page load advance a pointer so the flow resumes
// on the next injection; non-navigating steps run consecutively within one
// load. When the recorded extraction point is reached, the embedded routine
// reads the billing data and resolves once.
//
// Each element is located by the same identity the recorder captured (id, then
// name, aria-label, placeholder, then role + visible text) rather than a
// brittle CSS path, so small DOM differences between record and replay don't
// break it. The step pointer lives in window.name (survives cross-origin
// navigations; empty in a fresh WebView, so each job starts at step 0).

var NAV_STEPS = {steps_json};

var EXTRACTION = {extraction_js};

var NAME_PREFIX = "__recorder_step:";

function never() {{
  return new Promise(function () {{}});
}}

// Locate an element by the recorder's captured identity, most-stable first.
function find_el(d) {{
  if (d.id) {{
    var byId = document.getElementById(d.id);
    if (byId) return byId;
  }}
  if (d.name) {{
    var byName = document.querySelector('[name="' + d.name.replace(/"/g, '\\\\"') + '"]');
    if (byName) return byName;
  }}
  if (d.aria_label) {{
    var byAria = document.querySelector('[aria-label="' + d.aria_label.replace(/"/g, '\\\\"') + '"]');
    if (byAria) return byAria;
  }}
  if (d.placeholder) {{
    var byPlace = document.querySelector('[placeholder="' + d.placeholder.replace(/"/g, '\\\\"') + '"]');
    if (byPlace) return byPlace;
  }}
  if (d.text) {{
    var nodes = document.querySelectorAll(d.tag || 'button, a, input, [role]');
    for (var i = 0; i < nodes.length; i++) {{
      var t = (nodes[i].innerText || nodes[i].textContent || '').trim();
      if (t === d.text) return nodes[i];
    }}
  }}
  return null;
}}

// Poll for an element matching the descriptor until it appears or times out.
function wait_el(d, timeout_ms) {{
  var deadline = Date.now() + (timeout_ms || 30000);
  return new Promise(function (resolve, reject) {{
    (function poll() {{
      var el = find_el(d);
      if (el) {{ resolve(el); return; }}
      if (Date.now() > deadline) {{ reject(new Error("element not found")); return; }}
      setTimeout(poll, 250);
    }})();
  }});
}}

// Run the extraction routine, retrying while the page renders its JS-populated
// billing fields. Returns whatever it has after the last attempt.
function extract_with_retry(attempts) {{
  return Promise.resolve(EXTRACTION()).then(function (result) {{
    var bills = (result && result.bills) || [];
    var usage = (result && result.usage) || [];
    if (bills.length || usage.length || attempts <= 0) {{
      return {{ bills: bills, usage: usage }};
    }}
    return new Promise(function (resolve) {{
      setTimeout(function () {{ resolve(extract_with_retry(attempts - 1)); }}, 500);
    }});
  }});
}}

function get_step() {{
  var name = window.name || "";
  if (name.indexOf(NAME_PREFIX) !== 0) return 0;
  return parseInt(name.slice(NAME_PREFIX.length), 10) || 0;
}}

function set_step(i) {{
  window.name = NAME_PREFIX + String(i);
}}

// Run one recorded navigation step. Resolves "continue" to keep stepping in this
// same load, or "navigated" when a page load follows (wait for re-injection).
function run_step(step, creds, idx) {{
  if (step.type === "fill_credential") {{
    return wait_el(step.descriptor).then(function (el) {{
      window.__set_value(el, step.which === "username" ? creds.username : creds.password);
      return "continue";
    }});
  }}
  if (step.type === "fill_text") {{
    return wait_el(step.descriptor).then(function (el) {{
      window.__set_value(el, step.value);
      return "continue";
    }});
  }}
  if (step.type === "wait_for") {{
    return wait_el(step.descriptor).then(function () {{ return "continue"; }});
  }}
  if (step.type === "click") {{
    return wait_el(step.descriptor).then(function (el) {{
      // Advance the pointer before clicking. A click may navigate, tearing the
      // context down at any moment afterward; the pointer must already point at
      // the next step so re-injection resumes past this click.
      set_step(idx + 1);
      el.click();
      // The click may instead update in place (no reload). Settle: navigation
      // preempts by destroying the context, otherwise keep stepping.
      return new Promise(function (resolve) {{
        setTimeout(function () {{ resolve("continue"); }}, 3000);
      }});
    }});
  }}
  if (step.type === "goto") {{
    window.location.href = step.url;
    return Promise.resolve("navigated");
  }}
  return Promise.reject(new Error("unknown step type " + step.type));
}}

function run_scrape(creds) {{
  if (get_step() >= NAV_STEPS.length) {{
    window.name = "";
    return extract_with_retry(20);
  }}

  function step_loop() {{
    var idx = get_step();
    if (idx >= NAV_STEPS.length) return run_scrape(creds);
    return run_step(NAV_STEPS[idx], creds, idx).then(function (outcome) {{
      set_step(idx + 1);
      if (outcome === "navigated") return never();
      return step_loop();
    }});
  }}

  return step_loop();
}}
"""


def select_site():
    """Prompt for one of the supported sites by number. Loops until a listed
    number is chosen; the user never types a name or URL."""
    site_ids = sorted(SITE_ROOTS)
    print("Select the site to record:")
    for i, site_id in enumerate(site_ids, start=1):
        print(f"  {i}. {site_id} ({SITE_ROOTS[site_id]})")
    while True:
        choice = input("Enter number: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(site_ids):
            return site_ids[int(choice) - 1]
        print(f"Enter a number 1-{len(site_ids)}.")


def main():
    parser = argparse.ArgumentParser(description="Record a utility login/scrape flow.")
    parser.add_argument("--headed", action="store_true", help="Show the browser.")
    parser.add_argument("--out-dir", default="out", help="Where to write <site_id>.js.")
    args = parser.parse_args()

    # The site is chosen from a numbered menu; the start URL is fixed per site.
    site_id = select_site()
    start_url = SITE_ROOTS[site_id]

    # Load the Anthropic API key from the .env file in this folder.
    load_dotenv(Path(__file__).resolve().parent / ".env")

    # The user supplies the site login credentials at the prompt; the recorder
    # stores them as environment variables and never passes them to the model.
    os.environ[USERNAME_ENV] = input("site username: ")
    os.environ[PASSWORD_ENV] = getpass.getpass("site password: ")
    creds = {"username": os.environ[USERNAME_ENV], "password": os.environ[PASSWORD_ENV]}

    client = anthropic.Anthropic()
    messages = []

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Seed the replay with the fixed start URL so the generated script always
    # begins there, independent of what the model navigates to afterward.
    steps = [{"type": "goto", "url": start_url}]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        page = browser.new_page()
        page.goto(start_url)

        messages.append({
            "role": "user",
            "content": "Current page:\n" + json.dumps(snapshot(page)),
        })

        finished = False
        for _ in range(MAX_STEPS):
            response = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                thinking={"type": "adaptive"},
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
            )
            messages.append({"role": "assistant", "content": response.content})

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                messages.append({
                    "role": "user",
                    "content": "Call a tool. Current page:\n" + json.dumps(snapshot(page)),
                })
                continue

            # Execute one action per turn (the model is told to call exactly one).
            results = []
            for tu in tool_uses:
                if tu.name == "finish":
                    if any(s["type"] == "extract" for s in steps):
                        finished = True
                        results.append({"type": "tool_result", "tool_use_id": tu.id,
                                        "content": "done"})
                    else:
                        results.append({"type": "tool_result", "tool_use_id": tu.id,
                                        "content": "cannot finish: no bill captured "
                                        "yet. Reach the most recent bill and call "
                                        "extract_data first."})
                    continue
                try:
                    status = run_action(page, tu.name, tu.input, creds, steps)
                except (PlaywrightError, PlaywrightTimeout) as e:
                    status = f"action failed: {e}"
                results.append({"type": "tool_result", "tool_use_id": tu.id,
                                "content": status})

            if finished:
                break

            messages.append({"role": "user", "content": results})
            messages.append({
                "role": "user",
                "content": "Resulting page:\n" + json.dumps(snapshot(page)),
            })

        browser.close()

    if not any(s["type"] == "extract" for s in steps):
        print("flow ended without an extraction step; no script written", file=sys.stderr)
        return 1

    out_path = out_dir / f"{site_id}.js"
    out_path.write_text(generate_script(site_id, start_url, steps), encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
