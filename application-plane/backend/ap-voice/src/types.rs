//! All ap-voice type definitions. No types live outside this file.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::time::Duration;
use thiserror::Error;

/// Decoded claim set of the canonical tenant_context_token.
/// The encoded JWT travels on the wire as a String; this is the decoded form.
/// Mirror of the canonical token; zero deviation in fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantContextToken {
    pub sub: String,
    pub city_tenant_id: String,
    pub iat: i64,
    pub exp: i64,
}

/// Transcribed query forwarded to ap-assistant.
/// tenant_context_token is the encoded JWT String, never bare claims.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceQuery {
    pub tenant_context_token: String,
    pub transcript: String,
}

/// One STT transcript, interim or final.
#[derive(Debug, Clone)]
pub struct Transcript {
    pub text: String,
    pub is_final: bool,
}

/// An event off the STT stream: either a transcript, or Deepgram's UtteranceEnd
/// message (a word-timing gap marking end of speech). UtteranceEnd is the turn
/// boundary; endpointing/speech_final is not used, so a pause mid-utterance (e.g.
/// after the wake word) never splits one spoken request into two turns.
#[derive(Debug, Clone)]
pub enum SttEvent {
    Transcript(Transcript),
    UtteranceEnd,
}

/// Typed errors. A provider error aborts only the current turn, not the session.
#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("stt provider error: {0}")]
    Stt(String),
    #[error("tts provider error: {0}")]
    Tts(String),
    #[error("assistant provider error: {0}")]
    Assistant(String),
    #[error("websocket error: {0}")]
    WebSocket(String),
    #[error("turn aborted by barge-in")]
    BargeIn,
    #[error("socket closed mid-send; frame dropped")]
    FrameDropped,
}

/// A reminder the assistant set during a turn, forwarded to the client so it can
/// record it and render a confirmation chip. Mirrors the assistant's reminder
/// chunk; when is the human display label, scheduled_at the ISO instant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderPayload {
    pub title: String,
    pub body: String,
    pub when: String,
    pub scheduled_at: String,
}

/// Outbound events on the client duplex socket. Audio is never persisted.
#[derive(Debug, Clone)]
pub enum ResponseEvent {
    /// Marks the start of a fresh turn's audio. Sent before any audio of the
    /// turn so the client stops dropping the barged-out turn's tail and plays
    /// this one from the beginning.
    ResponseStart,
    /// MP3 audio chunk; streamed, never fully buffered.
    AudioChunk(Vec<u8>),
    /// User's transcribed query text for the shared chat thread. Streamed live:
    /// is_final is false for interim/partial text (the bubble keeps updating) and
    /// true once UtteranceEnd closes the utterance.
    UserTranscript { text: String, is_final: bool },
    /// Assistant reply text for the shared chat thread.
    AssistantTranscript(String),
    /// A reminder the assistant set; forwarded as a text frame to the client.
    Reminder(ReminderPayload),
}

/// One event from the assistant token stream: an incremental text token, or a
/// reminder the assistant set mid-turn.
#[derive(Debug, Clone)]
pub enum AssistantEvent {
    Token(String),
    Reminder(ReminderPayload),
}

/// Config. Secrets injected, never hard-coded.
#[derive(Debug, Clone)]
pub struct VoiceConfig {
    pub filler_delay_ms: u64,
    pub deepgram_api_key: String,
    pub elevenlabs_api_key: String,
    pub elevenlabs_voice_id: String,
    pub assistant_ws_url: String,
    /// Deepgram live-stream input encoding. Spec does not pin the uplink format;
    /// Deepgram streaming accepts linear16, opus, mulaw, etc (not mp3). Must match
    /// the mobile capture format. Default linear16.
    pub stt_encoding: String,
    /// Uplink sample rate in Hz. Must match the mobile capture rate. Default 16000.
    pub stt_sample_rate: u32,
    /// Deepgram utterance_end_ms: silence gap (ms) between finalized words before
    /// UtteranceEnd fires, which is the turn boundary. Floor 1000 per Deepgram.
    pub stt_utterance_end_ms: u32,
    /// When false, the server ignores client barge_in messages and every reply
    /// plays to completion.
    pub enable_barge_in: bool,
}

impl VoiceConfig {
    pub fn filler_delay(&self) -> Duration {
        Duration::from_millis(self.filler_delay_ms)
    }
}

/// Low-latency TTS tuning per spec: flash model, style off, stability high,
/// similarity high, speaker boost on. Library-forced field names (camelCase
/// mapping handled by serde rename in the impl).
#[derive(Debug, Clone)]
pub struct TtsSettings {
    pub model_id: String,
    pub stability: f32,
    pub similarity_boost: f32,
    pub style: f32,
    pub use_speaker_boost: bool,
    /// PCM 16-bit mono at 16000 Hz to match the client playback engine.
    pub output_format: String,
}

impl Default for TtsSettings {
    fn default() -> Self {
        Self {
            model_id: "eleven_flash_v2_5".to_string(),
            stability: 0.85,
            similarity_boost: 0.9,
            style: 0.0,
            use_speaker_boost: true,
            output_format: "pcm_16000".to_string(),
        }
    }
}

/// Just the type tag of any Deepgram message, parsed first to tell a Results
/// message (channel is an object) from an UtteranceEnd message (channel is an
/// array), which would otherwise fail the full DeepgramResult parse.
#[derive(Debug, Deserialize)]
pub struct DeepgramEnvelope {
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
}

/// Deepgram streaming result message (subset we read).
#[derive(Debug, Deserialize)]
pub struct DeepgramResult {
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
    pub is_final: Option<bool>,
    pub channel: Option<DeepgramChannel>,
}

#[derive(Debug, Deserialize)]
pub struct DeepgramChannel {
    pub alternatives: Vec<DeepgramAlternative>,
}

#[derive(Debug, Deserialize)]
pub struct DeepgramAlternative {
    pub transcript: String,
}

/// ElevenLabs request body.
#[derive(Debug, Serialize)]
pub struct ElevenLabsRequest {
    pub text: String,
    pub model_id: String,
    pub voice_settings: ElevenLabsVoiceSettings,
}

#[derive(Debug, Serialize)]
pub struct ElevenLabsVoiceSettings {
    pub stability: f32,
    pub similarity_boost: f32,
    pub style: f32,
    pub use_speaker_boost: bool,
}

/// Assistant token-stream frame over the localhost WS. ap-assistant streams
/// { type: "text", text } chunks, a { type: "reminder", title, body, when,
/// scheduled_at } frame when it sets a reminder, and signals end with
/// { type: "done" } (or { type: "error" }).
#[derive(Debug, Deserialize)]
pub struct AssistantToken {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub text: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub when: Option<String>,
    pub scheduled_at: Option<String>,
}

/// Sentence streamer: folds the assistant token stream into sentences,
/// holding any sentence shorter than min_len and folding it into the next.
pub struct SentenceStreamer {
    buf: String,
    min_len: usize,
}

impl SentenceStreamer {
    pub fn new(min_len: usize) -> Self {
        Self {
            buf: String::new(),
            min_len,
        }
    }

    /// Push a token; return completed sentences ready for TTS.
    pub fn push(&mut self, token: &str) -> Vec<String> {
        self.buf.push_str(token);
        let mut out = Vec::new();
        loop {
            let Some(end) = self.find_boundary() else {
                break;
            };
            let candidate: String = self.buf.drain(..=end).collect();
            // Min-length folding: hold short fragments unless buffer already
            // carries more, in which case emit the folded run.
            if candidate.trim().len() < self.min_len && self.buf.is_empty() {
                self.buf = candidate;
                break;
            }
            out.push(candidate.trim().to_string());
        }
        out
    }

    /// Flush any remaining buffered text at end of turn.
    pub fn flush(&mut self) -> Option<String> {
        let s = self.buf.trim().to_string();
        self.buf.clear();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    fn find_boundary(&self) -> Option<usize> {
        self.buf
            .char_indices()
            .find(|(_, c)| matches!(c, '.' | '!' | '?'))
            .map(|(i, c)| i + c.len_utf8() - 1)
    }
}

/// Per-stage latency tracking with p50/p95/p99.
#[derive(Debug, Default)]
pub struct LatencyTracker {
    stt: Vec<u128>,
    assistant: Vec<u128>,
    tts: Vec<u128>,
}

#[derive(Debug, Clone, Copy)]
pub enum Stage {
    Stt,
    Assistant,
    Tts,
}

#[derive(Debug, Clone, Copy)]
pub struct Percentiles {
    pub p50: u128,
    pub p95: u128,
    pub p99: u128,
}

impl LatencyTracker {
    pub fn record(&mut self, stage: Stage, millis: u128) {
        match stage {
            Stage::Stt => self.stt.push(millis),
            Stage::Assistant => self.assistant.push(millis),
            Stage::Tts => self.tts.push(millis),
        }
    }

    pub fn percentiles(&self, stage: Stage) -> Option<Percentiles> {
        let samples = match stage {
            Stage::Stt => &self.stt,
            Stage::Assistant => &self.assistant,
            Stage::Tts => &self.tts,
        };
        if samples.is_empty() {
            return None;
        }
        let mut s = samples.clone();
        s.sort_unstable();
        let pick = |q: f64| s[(((s.len() - 1) as f64) * q).round() as usize];
        Some(Percentiles {
            p50: pick(0.50),
            p95: pick(0.95),
            p99: pick(0.99),
        })
    }
}

/// Session-scoped filler phrase pool. Phrases vary within a session (no repeat)
/// and match tone.
pub struct FillerPool {
    phrases: Vec<String>,
}

impl FillerPool {
    pub fn new(tone_casual: bool) -> Self {
        let phrases = if tone_casual {
            vec!["one sec", "let me check", "gimme a moment", "looking now"]
        } else {
            vec![
                "one moment please",
                "let me look into that",
                "checking on that for you",
                "just a moment",
            ]
        };
        Self {
            phrases: phrases.into_iter().map(String::from).collect(),
        }
    }

    /// Random filler with no recency bias, or None if the pool is empty.
    pub fn next(&mut self) -> Option<String> {
        if self.phrases.is_empty() {
            return None;
        }
        let seed = RandomState::new().build_hasher().finish();
        let idx = (seed % self.phrases.len() as u64) as usize;
        Some(self.phrases[idx].clone())
    }
}
