# Wake Word Plan

## Decisions locked — do not re-ask

These are settled. Implement to them. Do not ask the user to reconsider any of them.

- Engine: openWakeWord (ONNX), on-device. Not Porcupine, DaVoice, Azure, or Vosk.
- Scope: foreground only. No background or app-closed listening. No Always On Processor.
- Custom model: trained by the user from text via openWakeWord's Colab. The user owns this step; the classifier model file is the only missing input. Treat it as a drop-in path; do not block on or re-litigate it.
- Audio format: 16-bit 16kHz mono PCM, 80ms frame multiples. Matches existing capture; no resampling.
- Idle behavior: while `wake_enabled` is on, hold the screen awake (`expo-keep-awake`) and show a full-black idle overlay, dismissed on first touch.
- Idle animation: the three-color bezier waveform from `CodePen_Example.txt`, full size, full-black background. Reacts to the assistant's voice only (output level), never the user's input. Flat while idle.
- Renderer: react-native-skia.
- Mic handoff: wake engine and voice session never run at once; disable wake while talk mode is on, re-enable after.
- Placement: wake listener and idle screen live in `m-res-assistant`; reuse the existing `wake_enabled` flag and `toggle_voice` path; do not add a second flag.
- Installing the required libraries is pre-authorized for this feature.

The only open item is the trained model file (user-supplied) and the one technical risk under "Known risk".

## Goal

Make the "Hey Bex" wake word functional. Today it is UI only: the wake bar and the Settings wake-word switch drive a `wake_enabled` flag, but nothing listens. No detection engine exists.

## Library

openWakeWord (on-device, ONNX).

- Free, open source, no sales contact, no paid key.
- Purpose-built wake-word DNN pipeline: melspectrogram -> Google speech embedding -> small phrase classifier.
- The melspectrogram and embedding models are shared/pretrained and ship with the project. Only the "Hey Bex" classifier is custom.
- Runs in React Native through `onnxruntime-react-native` (native module; native builds are already in use, Expo Go is not).

### Rejected alternatives

- Picovoice Porcupine: free tier discontinued June 30, 2026; paid pricing is sales-quote only.
- DaVoice `react-native-wakeword`: requires a license key and a custom model by email; cost unpublished.
- Azure Custom Keyword: no React Native SDK, locked to Microsoft's native SDK.
- Vosk (`react-native-vosk`): viable and lower effort, but a full STT engine constrained to a grammar, heavier than a purpose-built detector and requires bundling a ~50MB model. Not chosen.

## Custom model

- Train the "Hey Bex" classifier from the phrase as text using openWakeWord's Colab notebook.
- Uses synthetic text-to-speech training data. No recording the user's voice.
- Output is the classifier model file, dropped into the app. The melspectrogram and embedding models are reused as-is.

## Audio format

- openWakeWord expects 16-bit 16kHz mono PCM, frames in multiples of 80ms.
- The existing capture path (expo-two-way-audio) already produces linear16 / 16kHz / mono. No resampling needed.

## Scope

- Foreground only. The wake word never runs while the app is backgrounded or closed.
- No use of Apple's Always On Processor; it is not accessible to third-party apps. Detection runs on the main CPU while the app is foreground.

## Idle timeout + battery

- While the wake word is toggled on, hold the screen awake with `expo-keep-awake` (`activateKeepAwakeAsync(tag)` on enable, `deactivateKeepAwake(tag)` on disable or when a voice session starts). Use a dedicated tag.
- A continuously bright screen is the dominant battery cost, more than the wake inference.
- Mitigation: show a full-black ambient screen while listening, dismissed on first touch. On OLED (all current and mid-to-high-end phones, including iPhone 14) black pixels are off, so this recovers most of the locked-screen battery savings while the app stays foreground and listening. Do not shrink the animation to save power; it should render at full size. The waveform is flat (no lit pixels) while idle and only lights up when the assistant speaks, so the savings come for free without compromising the visual.

## Idle screen animation

- Style: the three-color bezier waveform from `CodePen_Example.txt` (root folder; saved copy of the fgnass pen at https://codepen.io/fgnass/pen/LWeKNq). Three overlapping colored curves on a full-black background.
- Reference is vanilla canvas 2D + Web Audio AnalyserNode; the only external dependency there (dat.GUI) is just its control panel and is not part of the effect.
- Reacts to the assistant's voice only. Drive amplitude from the assistant output level (`onOutputVolumeLevelData` from expo-two-way-audio). Do not react to the user's input level.
- Idle/listening with no assistant audio: the waveform is flat. It animates only while the assistant is speaking.

## Mic handoff

- The wake engine and the talk-mode voice session both need the mic. They never run at once.
- Disable the wake engine while talk mode is toggled on; re-enable it when talk mode is off. Simple toggle, no shared-mic coordination.

## Rendering

- The waveform renders with react-native-skia (GPU canvas). It reproduces the reference faithfully: bezier curves, glow (canvas `shadowBlur`), and the "screen" blend across the three colored layers.

## Module placement and integration points

- The wake listener and the idle screen live inside `m-res-assistant`, the module that already owns the mic (`audio-io.ts`) and the voice session (`voice-client.ts`, `AssistantScreen.tsx`). Feature modules never import each other; the portal composes (see existing `Portal.tsx`).
- The `wake_enabled` flag and the wake bar already exist in `Portal.tsx` / `components/chrome.tsx`. Pass `wake_enabled` into the assistant surface; do not add a second flag.
- On detection, start the existing voice session via the same path as the manual voice toggle (`toggle_voice` in `AssistantScreen.tsx`). Disable the wake listener while the voice session is live; re-enable when it ends.
- The full-black idle screen is an overlay owned by the assistant surface, shown while `wake_enabled` is on and no voice session is active, dismissed on first touch.

## Integration steps

1. Add `onnxruntime-react-native` and load the three ONNX models (melspectrogram, embedding, classifier).
2. Feed mic frames through the three models in sequence, maintain a short rolling buffer, compare the classifier score to a threshold, debounce repeats.
3. On detection, start the existing voice session.
4. Gate the engine on the existing `wake_enabled` flag; tie `expo-keep-awake` and the ambient screen to the same flag.
5. Train the "Hey Bex" classifier in Colab and bundle it.

## Known risk

- The one real unknown is whether all three ONNX models (especially the melspectrogram step) run cleanly under `onnxruntime-react-native`, or whether an op is unsupported. Everything else is wiring. Accuracy and threshold will need tuning.
