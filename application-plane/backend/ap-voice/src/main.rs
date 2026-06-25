//! ap-voice runnable server. Binds a WS server at the address ap-server proxies
//! the resident voice socket to (config key ap_voice_ws_url, default
//! ws://localhost:8090/voice). Each accepted client WS runs one voice session
//! over the existing turn engine. No audio is persisted.

use std::env;
use std::sync::Arc;

use async_trait::async_trait;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use ap_voice::{
    AssistantClient, AssistantWsClient, DeepgramTranscriber, ElevenLabsTts, ResponseEvent,
    ResponseSink, Tts, TtsSettings, VoiceConfig, VoiceError, VoiceSession,
};

/// Inbound handshake frame: the first text frame carries the encoded token and
/// the selected voice. Downstream audio is always pcm_16000 to match the client
/// playback engine.
#[derive(Debug, Deserialize)]
struct VoiceHandshake {
    tenant_context_token: String,
    #[serde(default)]
    voice_id: Option<String>,
}

/// Outbound transcript frame on the client socket. Audio rides as binary frames.
#[derive(Debug, Serialize)]
struct TranscriptFrame<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    text: String,
}

type WsSink = SplitSink<WebSocketStream<TcpStream>, Message>;

/// ResponseSink that writes turn events to the client WS. Audio chunks go as
/// binary frames; transcript text goes as JSON text frames.
struct WsResponseSink {
    sink: Arc<Mutex<WsSink>>,
}

#[async_trait]
impl ResponseSink for WsResponseSink {
    async fn send(&self, event: ResponseEvent) -> Result<(), VoiceError> {
        let msg = match event {
            ResponseEvent::AudioChunk(bytes) => Message::Binary(bytes.into()),
            ResponseEvent::UserTranscript(text) => {
                let frame = TranscriptFrame { kind: "user_transcript", text };
                Message::Text(
                    serde_json::to_string(&frame)
                        .map_err(|e| VoiceError::WebSocket(e.to_string()))?
                        .into(),
                )
            }
            ResponseEvent::AssistantTranscript(text) => {
                let frame = TranscriptFrame { kind: "assistant_transcript", text };
                Message::Text(
                    serde_json::to_string(&frame)
                        .map_err(|e| VoiceError::WebSocket(e.to_string()))?
                        .into(),
                )
            }
        };
        self.sink
            .lock()
            .await
            .send(msg)
            .await
            .map_err(|_| VoiceError::FrameDropped)
    }
}

/// Read config from env. Secrets only from env, never hard-coded.
fn load_config() -> VoiceConfig {
    VoiceConfig {
        filler_delay_ms: env::var("filler_delay_ms")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(600),
        deepgram_api_key: env::var("deepgram_api_key").unwrap_or_default(),
        elevenlabs_api_key: env::var("elevenlabs_api_key").unwrap_or_default(),
        elevenlabs_voice_id: env::var("elevenlabs_voice_id").unwrap_or_default(),
        assistant_ws_url: env::var("assistant_ws_url")
            .unwrap_or_else(|_| "ws://localhost:8080/assistant".to_string()),
        stt_encoding: env::var("stt_encoding").unwrap_or_else(|_| "linear16".to_string()),
        stt_sample_rate: env::var("stt_sample_rate")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(16000),
    }
}

#[tokio::main]
async fn main() {
    // Startup/lifecycle notices go to stderr directly.
    let addr = env::var("AP_VOICE_LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8090".to_string());
    let config = load_config();

    let listener = TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("ap-voice bind {addr} failed: {e}"));
    eprintln!("ap-voice listening on ws://{addr}/voice");

    while let Ok((tcp, peer)) = listener.accept().await {
        let config = config.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_client(tcp, config).await {
                eprintln!("voice session ({peer}) ended: {e}");
            }
        });
    }
}

/// One client WS connection -> one voice session.
async fn handle_client(tcp: TcpStream, config: VoiceConfig) -> Result<(), VoiceError> {
    let ws = accept_async(tcp)
        .await
        .map_err(|e| VoiceError::WebSocket(e.to_string()))?;
    let (ws_sink, mut ws_stream) = ws.split();

    // Connect providers once for the session (pooled across turns).
    let transcriber = DeepgramTranscriber::connect(
        config.deepgram_api_key.clone(),
        config.stt_encoding.clone(),
        config.stt_sample_rate,
    )
    .await?;
    let audio_up = transcriber.audio_sender();

    let assistant: Arc<dyn AssistantClient> =
        Arc::new(AssistantWsClient::new(config.assistant_ws_url.clone()));
    let sink: Arc<dyn ResponseSink> = Arc::new(WsResponseSink {
        sink: Arc::new(Mutex::new(ws_sink)),
    });

    // Inbound demux: first text frame is the handshake (token + voice);
    // binary frames are audio_chunks pushed to the Transcriber; close ends it.
    let mut token: Option<String> = None;
    // ElevenLabs voice the client selected; falls back to the env default. Set
    // from the handshake (the only path that breaks past the loop below).
    let voice_id: Option<String>;
    // Buffer early audio that arrives before the handshake so no frame is lost.
    let mut pending_audio: Vec<Vec<u8>> = Vec::new();

    loop {
        match ws_stream.next().await {
            Some(Ok(Message::Text(txt))) => {
                if token.is_none() {
                    let hs: VoiceHandshake = serde_json::from_str(&txt)
                        .map_err(|e| VoiceError::WebSocket(format!("bad handshake: {e}")))?;
                    token = Some(hs.tenant_context_token);
                    voice_id = hs.voice_id.filter(|v| !v.is_empty());
                    break;
                }
            }
            Some(Ok(Message::Binary(bytes))) => {
                // Audio before the handshake: hold it.
                pending_audio.push(bytes.to_vec());
            }
            Some(Ok(Message::Close(_))) | None => return Ok(()),
            Some(Ok(_)) => {}
            Some(Err(e)) => return Err(VoiceError::WebSocket(e.to_string())),
        }
    }

    let tenant_context_token = token.unwrap_or_default();

    // The client's expo-two-way-audio engine plays PCM 16-bit mono at 16000 Hz
    // only, so the downstream is fixed at pcm_16000.
    let mut tts_settings = TtsSettings::default();
    tts_settings.output_format = "pcm_16000".to_string();
    // Per-session voice: the client's selection, falling back to the env default.
    let session_voice_id = voice_id.unwrap_or_else(|| config.elevenlabs_voice_id.clone());
    let tts: Arc<dyn Tts> = Arc::new(ElevenLabsTts::new(
        config.elevenlabs_api_key.clone(),
        session_voice_id,
        tts_settings,
    ));

    // Flush any audio buffered before the handshake.
    for frame in pending_audio.drain(..) {
        let _ = audio_up.send(frame);
    }

    // Audio-up pump: keep forwarding inbound binary frames into the Transcriber
    // for the rest of the session, concurrently with the turn engine.
    let audio_pump = tokio::spawn(async move {
        while let Some(msg) = ws_stream.next().await {
            match msg {
                Ok(Message::Binary(bytes)) => {
                    // Drop the frame (not crash) if the STT loop is gone.
                    if audio_up.send(bytes.to_vec()).is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
    });

    // Run the turn engine to completion (until STT yields no more transcripts).
    let mut session = VoiceSession::new(
        Box::new(transcriber),
        assistant,
        tts,
        sink,
        config,
        tenant_context_token,
    );
    session.run().await;

    audio_pump.abort();
    Ok(())
}
