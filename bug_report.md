# Bug Report

## ap-assistant (backend)

- [x] 1. `ap-assistant/src/core.ts:450-465` - mid-stream retry replays already-yielded chunks; a 529 after partial text duplicates output to the resident.
- [x] 2. `ap-assistant/src/core.ts:261-267` - non-transient mid-stream error appends only the degraded message to history, diverging from what the resident actually saw.
- [x] 3. `ap-assistant/src/core.ts:472-481` - empty assistant text pushes a lone user message, producing consecutive user roles that the Anthropic API rejects; every later turn in the session degrades.
- [x] 4. `ap-assistant/src/core.ts:374-384` - grounded follow-up passes tools but ignores tool_use events; a second tool selection yields empty text and no answer.
- [x] 5. `ap-assistant/src/core.ts:201-213` - pending confirmation is deleted before the filler check, so "um" silently discards a pending confirmed action.
- [x] 6. `ap-assistant/src/core.ts:133-142` - circuit breaker half-open admits unlimited concurrent probes instead of one.
- [x] 7. `ap-assistant/src/core.ts:245,254-259` - multiple tool_use events in one turn: only the last dispatches.
- [x] 8. `ap-assistant/src/handler.ts:54-59` - no per-socket serialization; back-to-back transcripts run turns concurrently, interleaving chunks and losing history writes.

## ap-civic

- [x] 9. `ap-civic/src/service.ts:100,120,138` - resolved by redesign: address-derived reads are store-only; fetching happens at app open (`POST /civic/refresh`) and in the scheduled warm pass. `stale_refreshed` and the stale-while-revalidate machinery removed.
- [x] 11. `ap-civic/src/service.ts:334-335` - AHAS and NWS fetches share one failure domain; either failing drops all alerts from both.
- [x] 12. `ap-civic/src/service.ts:569-576` - not a bug; the parser emits one row per service type. Updated the stale point-in-polygon comment on `read_collection_schedule` instead.
- [x] 13. `ap-civic/src/service.ts:836` - strict `=== true` on ArcGIS `isQualifyOrganics`; `"true"` or `1` drops the organics row.

## ap-utility

- [x] 14. `ap-utility/src/service.ts:127-138` - one failing address aborts the whole outage fetch pass.
- [x] 15. `ap-utility/src/service.ts:100-101` - outage dedupe on `outage_id` only; status changes ("reported" to "restored") never stored or notified.
- [x] 16. `ap-utility/src/service.ts:183-203` - no sent-reminder tracking; duplicate bill_due notifications every scheduler run.
- [x] 17. `ap-utility/src/service.ts:42-46,191` - `due_date` parsed as UTC midnight vs local now; bills due today are skipped in timezones west of UTC.
- [x] 18. `ap-utility/src/index.ts:24-29` - token verifier casts `sub` and `city_tenant_id` without presence checks; missing claim scopes data under tenant `undefined`.

## ap-voice (Rust)

- [x] 19. `ap-voice/src/service.rs:563,571-584` - filler task not aborted on turn error; "one moment please" plays into a dead turn.
- [x] 20. `ap-voice/src/service.rs:347` - assistant `"error"` frame handled like `"done"`; truncated reply presented as complete.
- [x] 21. `ap-voice/src/service.rs:146` - `HeaderValue::parse().unwrap()` on the Deepgram key panics on a trailing newline; session dies silently.
- [x] 22. `ap-voice/src/service.rs:159` - reconnect counter resets on every successful connect; connect-then-drop loops forever with no backoff.
- [x] 23. `ap-voice/src/types.rs:260-265` - sentence boundary fires on any `.`, splitting "$128.45" and "Aug." mid-number for TTS.
- [x] 24. `ap-voice/src/service.rs:437-452` + `ap-voice/src/main.rs:263-287` - barge-in flag reset at turn start races a late barge_in; next queued turn plays anyway.
- [x] 25. `ap-voice/src/service.rs:239` - reqwest 30s timeout covers the whole streamed TTS body; long streams cut mid-sentence.
- [x] 26. `ap-voice/src/service.rs:586-587` - latency values computed and discarded; `LatencyTracker::record` never called, `percentiles()` always `None`.

## crawl-service (Python)

- [ ] 27. `crawl-service/crawl_service.py:50-51` - no try/except around `crawler.arun`; raised failures return a 500 instead of `{success: false}`.
- [ ] 28. `crawl-service/crawl_service.py:51` - `result.markdown.raw_markdown` assumes markdown is non-None on success; AttributeError causes a 500.

## mobile: shell/portal

- [ ] 29. `m-res-portal/Portal.tsx:183-187` - initial-sync effect bails when anything is in flight and never re-fires; a second linked account is never scraped until background/foreground.
- [ ] 30. `m-res-portal/Portal.tsx:372-374` - mirror effect clobbers optimistic `linked` state; just-linked account vanishes on the next stale refetch.
- [ ] 31. `m-res-portal/Portal.tsx:357-368` - `on_save_profile` writes the press-time snapshot after await, wiping edits typed during the save.
- [ ] 32. `m-res-portal/screens/settings.tsx:126-127` + `m-res-portal/Portal.tsx:121-123` - language switch persists fire-and-forget; a failed save later flips the app back to English via a stale snapshot.
- [ ] 33. `m-res-shell/Shell.tsx:35-38` - `resolve_city` result computed and discarded; city resolution affects nothing.

## mobile: assistant/accounts

- [ ] 34. `m-res-assistant/useAssistantEngine.ts:332` + `m-res-assistant/voice-client.ts:231-242` - server-initiated close leaves a stale `voice_ref`; wake-word starts silently no-op until manual toggle.
- [ ] 35. `m-res-assistant/useAssistantEngine.ts:400` + `m-res-assistant/voice-client.ts:231-235` - socket error leaves `voice_state` at `"error"` forever; mic held hot, wake detection dead.
- [ ] 36. `m-res-assistant/useAssistantEngine.ts:85,128,299-308` - chat SSE stream never closed, including on unmount; callbacks fire on an unmounted hook.
- [ ] 37. `m-res-assistant/audio-io.ts:145-206` - `stop_capture` does not cancel an in-flight `start_capture`; quick toggle during the permission prompt leaves the mic recording with no owner.
- [ ] 38. `m-res-assistant/useAssistantEngine.ts:289-294,249-253` - silence timeout disarmed after a final user transcript; a backend that never responds keeps the session open indefinitely.
- [ ] 39. `m-res-assistant/useAssistantEngine.ts:249-253` - pending "..." assistant bubble never finalized when the session ends without an assistant transcript.
- [ ] 40. `m-res-assistant/AssistantScreen.tsx:146-155` - `onSubmitEditing` on a multiline TextInput without `submitBehavior="submit"`; return key inserts a newline instead of sending.
- [ ] 41. `m-res-accounts/scrape-runner.tsx:101-127` - no job timeout; a hung site script wedges a sync worker forever, eventually deadlocking all workers.
- [ ] 42. `m-res-accounts/LinkAccountFields.tsx:30-41` - `save_credentials` rejection is unhandled; keystore failure gives no error indication.
- [ ] 43. `m-res-accounts/useAccounts.ts:284-310` - no per-site in-flight guard; overlapping `sync` and `sync_all` double-scrape the same site and push bills twice.

## Cross-boundary mismatches

- [ ] 44. `ap-server/src/voice-bridge.ts:59,81` vs `m-res-assistant/voice-client.ts:181-228` - bridge sends error frames keyed `kind`; client only parses `type` and has no error branch. Auth failure or ap-voice down is a silent no-op session.
- [ ] 45. `ap-server/src/gateway.ts:435` vs `m-res-assistant/chat-client.ts:94` - server puts the SSE error message in `event.data`; client reads `event.message`. Real error text is always dropped for "connection error".
- [ ] 46. `ap-utility/src/service.ts:56-57` vs `ap-server/src/adapters/tool_ports.ts:58-63` and `m-res-accounts/types.ts:122-134` - bills read filters on `site_id` but every caller sends `account_ref`; per-account bill queries silently return all bills.
