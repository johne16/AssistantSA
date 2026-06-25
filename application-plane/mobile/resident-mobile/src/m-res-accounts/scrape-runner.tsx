// Off-screen WebView host. The portal mounts this once. It renders one hidden
// WebView per active scrape job, navigates to the site, injects the per-site
// script plus credentials, and resolves the job when the script posts results.
//
// The keyboard must not pop on a hidden WebView, so injected credential entry
// sets input .value programmatically and never calls focus().

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { scrape_job, scrape_message } from "./types";

// Imperative handle the hook drives the host through.
export interface scrape_runner_handle {
  // Run one job to completion (resolves on result or rejects on error).
  run(job: scrape_job): Promise<{ bills: never[]; usage: never[] }>;
}

// Hidden, zero-footprint container. Off-screen, not display:none, so the
// WebView still executes.
const offscreen = {
  position: "absolute" as const,
  width: 1,
  height: 1,
  left: -10000,
  top: -10000,
  opacity: 0,
};

// Internal active-job record with its promise resolvers.
interface active_job {
  id: number;
  job: scrape_job;
  resolve: (msg: scrape_message) => void;
  reject: (err: Error) => void;
}

// Wraps the per-site script. Supplies credentials to the page by setting input
// values programmatically (no focus, no keyboard) and forwards the script's
// posted result. The injected script reads credentials from the closure here,
// never from the keystore. The site script is expected to expose a global
// run_scrape(creds) that performs login + DOM reads and returns
// { bills, usage } (or throws). We bridge its return to postMessage.
function build_injection(job: scrape_job): string {
  const creds_json = JSON.stringify(job.credentials);
  return `
(function () {
  function post(payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  try {
    var __creds = ${creds_json};
    // Helper exposed to the site script: set a field value without focus so the
    // keyboard does not pop on the hidden WebView.
    window.__set_value = function (el, value) {
      if (!el) return;
      var setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      );
      if (setter && setter.set) { setter.set.call(el, value); }
      else { el.value = value; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    ${job.script}
    if (typeof run_scrape !== 'function') {
      post({ ok: false, error: 'site script missing run_scrape' });
    } else {
      Promise.resolve(run_scrape(__creds)).then(function (result) {
        post({ ok: true, bills: (result && result.bills) || [], usage: (result && result.usage) || [] });
      }).catch(function (e) {
        post({ ok: false, error: String(e && e.message ? e.message : e) });
      });
    }
  } catch (e) {
    post({ ok: false, error: String(e && e.message ? e.message : e) });
  }
})();
true;
`;
}

export const ScrapeRunner = forwardRef<scrape_runner_handle>((_props, ref) => {
  const [jobs, set_jobs] = useState<active_job[]>([]);
  const next_id = useRef(0);

  const finish = useCallback((id: number) => {
    set_jobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      run(job) {
        return new Promise((resolve, reject) => {
          const id = next_id.current++;
          set_jobs((prev) => [
            ...prev,
            {
              id,
              job,
              resolve: (msg) => {
                finish(id);
                if (msg.ok) {
                  resolve({
                    bills: (msg.bills ?? []) as never[],
                    usage: (msg.usage ?? []) as never[],
                  });
                } else {
                  reject(new Error(msg.error ?? "scrape failed"));
                }
              },
              reject: (err) => {
                finish(id);
                reject(err);
              },
            },
          ]);
        });
      },
    }),
    [finish],
  );

  const on_message = useCallback(
    (id: number, event: WebViewMessageEvent) => {
      const active = jobs.find((j) => j.id === id);
      if (!active) return;
      let msg: scrape_message;
      try {
        msg = JSON.parse(event.nativeEvent.data) as scrape_message;
      } catch {
        msg = { ok: false, error: "malformed scrape message" };
      }
      active.resolve(msg);
    },
    [jobs],
  );

  return (
    <View style={offscreen} pointerEvents="none">
      {jobs.map((active) => (
        <WebView
          key={active.id}
          source={{ uri: active.job.url }}
          originWhitelist={["*"]}
          injectedJavaScript={build_injection(active.job)}
          onMessage={(e) => on_message(active.id, e)}
          onError={() =>
            active.reject(new Error("webview load error"))
          }
          javaScriptEnabled
          domStorageEnabled
          // Keep the hidden WebView from grabbing the keyboard.
          keyboardDisplayRequiresUserAction
        />
      ))}
    </View>
  );
});

ScrapeRunner.displayName = "ScrapeRunner";
