//! ap-voice: latency-sensitive voice path. Streaming STT (Deepgram) ->
//! ap-assistant token stream -> sentence-chunked streaming TTS (ElevenLabs)
//! -> duplex client socket. No audio persisted; transcript only.

pub mod service;
pub mod types;

pub use service::{
    AbortSignal, AssistantClient, AssistantWsClient, DeepgramTranscriber, ElevenLabsTts,
    ResponseSink, Stt, Transcriber, Tts, VoiceSession,
};
pub use types::{
    FillerPool, LatencyTracker, Percentiles, ResponseEvent, SentenceStreamer, Stage,
    TenantContextToken, Transcript, TtsSettings, VoiceConfig, VoiceError, VoiceQuery,
};
