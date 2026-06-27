//! Voice service: ports (traits) plus concrete Deepgram/ElevenLabs/assistant
//! providers and the pump/worker turn loop. Latency-sensitive duplex path.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::types::*;

// ---- Ports (traits) so concrete providers are swappable ----

/// STT port. Streams audio up, yields interim + final transcripts.
#[async_trait]
pub trait Transcriber: Send + Sync {
    /// Send an audio frame. Drops the frame (not crash) if socket closed.
    async fn send_audio(&self, frame: Vec<u8>) -> Result<(), VoiceError>;
    /// Pull the next transcript, interim or final.
    async fn next_transcript(&mut self) -> Option<Transcript>;
}
/// Spec alias.
pub trait Stt: Transcriber {}

/// Sink port: streams response events (audio + transcript text) to the client.
#[async_trait]
pub trait ResponseSink: Send + Sync {
    async fn send(&self, event: ResponseEvent) -> Result<(), VoiceError>;
}

/// Assistant port: forward voiceQuery, consume token stream incrementally.
#[async_trait]
pub trait AssistantClient: Send + Sync {
    /// Open a turn; events (text tokens and reminders) arrive on the returned
    /// channel until done.
    async fn query(
        &self,
        query: VoiceQuery,
    ) -> Result<mpsc::Receiver<Result<AssistantEvent, VoiceError>>, VoiceError>;
}

/// TTS port: synthesize one sentence to streamed PCM chunks.
#[async_trait]
pub trait Tts: Send + Sync {
    async fn synthesize(
        &self,
        sentence: &str,
    ) -> Result<mpsc::Receiver<Result<Vec<u8>, VoiceError>>, VoiceError>;
}

// ---- Shared abort flag for barge-in ----

#[derive(Clone, Default)]
pub struct AbortSignal(Arc<AtomicBool>);

impl AbortSignal {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
    pub fn raise(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
    pub fn is_raised(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

// ---- Deepgram STT (concrete) ----

const DEEPGRAM_MAX_RECONNECT: u32 = 3;

pub struct DeepgramTranscriber {
    audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    transcript_rx: mpsc::UnboundedReceiver<Transcript>,
}

impl DeepgramTranscriber {
    /// Connect and spawn the persistent live loop with bounded reconnect. The
    /// encoding and sample_rate must match the mobile capture format; both come
    /// from config, never hard-coded.
    pub async fn connect(
        api_key: String,
        encoding: String,
        sample_rate: u32,
    ) -> Result<Self, VoiceError> {
        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (transcript_tx, transcript_rx) = mpsc::unbounded_channel::<Transcript>();
        tokio::spawn(deepgram_loop(
            api_key,
            encoding,
            sample_rate,
            audio_rx,
            transcript_tx,
        ));
        Ok(Self {
            audio_tx,
            transcript_rx,
        })
    }

    /// Cloned audio-up sender so the inbound WS loop can push frames while the
    /// session holds the transcriber for transcript draining.
    pub fn audio_sender(&self) -> mpsc::UnboundedSender<Vec<u8>> {
        self.audio_tx.clone()
    }
}

async fn deepgram_loop(
    api_key: String,
    encoding: String,
    sample_rate: u32,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    transcript_tx: mpsc::UnboundedSender<Transcript>,
) {
    let url = format!(
        "wss://api.deepgram.com/v1/listen?\
        encoding={encoding}&sample_rate={sample_rate}&interim_results=true&model=nova-3&language=en-US"
    );
    let url = url.as_str();
    let mut attempts = 0u32;
    loop {
        let mut req = match url.into_client_request() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[ap-voice] deepgram request build failed: {e}");
                return;
            }
        };
        req.headers_mut()
            .insert("Authorization", format!("Token {api_key}").parse().unwrap());

        let ws = match connect_async(req).await {
            Ok((ws, _)) => ws,
            Err(e) => {
                attempts += 1;
                eprintln!("[ap-voice] deepgram connect failed ({attempts}): {e}");
                if attempts > DEEPGRAM_MAX_RECONNECT {
                    return;
                }
                continue;
            }
        };
        attempts = 0;
        let (mut sink, mut stream) = ws.split();

        loop {
            tokio::select! {
                maybe_frame = audio_rx.recv() => {
                    let Some(frame) = maybe_frame else { return; };
                    // Drop the frame rather than crash if the socket is gone.
                    if sink.send(Message::Binary(frame.into())).await.is_err() {
                        eprintln!("[ap-voice] deepgram send failed; dropping frame, reconnecting");
                        break;
                    }
                }
                maybe_msg = stream.next() => {
                    match maybe_msg {
                        Some(Ok(Message::Text(txt))) => {
                            if let Ok(res) = serde_json::from_str::<DeepgramResult>(&txt) {
                                if let Some(ch) = res.channel {
                                    if let Some(alt) = ch.alternatives.into_iter().next() {
                                        if !alt.transcript.is_empty() {
                                            let _ = transcript_tx.send(Transcript {
                                                text: alt.transcript,
                                                is_final: res.is_final.unwrap_or(false),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Err(e)) => {
                            eprintln!("[ap-voice] deepgram stream error: {e}");
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
        // fell through: reconnect (bounded by attempts at top)
    }
}

#[async_trait]
impl Transcriber for DeepgramTranscriber {
    async fn send_audio(&self, frame: Vec<u8>) -> Result<(), VoiceError> {
        self.audio_tx
            .send(frame)
            .map_err(|_| VoiceError::FrameDropped)
    }
    async fn next_transcript(&mut self) -> Option<Transcript> {
        self.transcript_rx.recv().await
    }
}
impl Stt for DeepgramTranscriber {}

// ---- ElevenLabs TTS (concrete) ----

pub struct ElevenLabsTts {
    client: reqwest::Client,
    api_key: String,
    voice_id: String,
    settings: TtsSettings,
}

impl ElevenLabsTts {
    /// Reuse a keep-alive client across the session with explicit timeouts.
    pub fn new(api_key: String, voice_id: String, settings: TtsSettings) -> Self {
        let client = reqwest::Client::builder()
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("reqwest client");
        Self {
            client,
            api_key,
            voice_id,
            settings,
        }
    }
}

#[async_trait]
impl Tts for ElevenLabsTts {
    async fn synthesize(
        &self,
        sentence: &str,
    ) -> Result<mpsc::Receiver<Result<Vec<u8>, VoiceError>>, VoiceError> {
        let url = format!(
            "https://api.elevenlabs.io/v1/text-to-speech/{}/stream?output_format={}",
            self.voice_id, self.settings.output_format
        );
        let body = ElevenLabsRequest {
            text: sentence.to_string(),
            model_id: self.settings.model_id.clone(),
            voice_settings: ElevenLabsVoiceSettings {
                stability: self.settings.stability,
                similarity_boost: self.settings.similarity_boost,
                style: self.settings.style,
                use_speaker_boost: self.settings.use_speaker_boost,
            },
        };
        let resp = self
            .client
            .post(&url)
            .header("xi-api-key", &self.api_key)
            // No accept header: output_format in the query string is authoritative
            // (mp3_* or pcm_*), so the same path serves both downstream formats.
            .json(&body)
            .send()
            .await
            .map_err(|e| VoiceError::Tts(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(VoiceError::Tts(format!("http {}", resp.status())));
        }

        // Stream MP3 chunks; never buffer the full reply.
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, VoiceError>>(16);
        tokio::spawn(async move {
            let mut stream = resp.bytes_stream();
            while let Some(item) = stream.next().await {
                match item {
                    Ok(bytes) => {
                        if tx.send(Ok(bytes.to_vec())).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(VoiceError::Tts(e.to_string()))).await;
                        break;
                    }
                }
            }
        });
        Ok(rx)
    }
}

// ---- Assistant localhost WS client (concrete) ----

pub struct AssistantWsClient {
    ws_url: String,
}

impl AssistantWsClient {
    pub fn new(ws_url: String) -> Self {
        Self { ws_url }
    }
}

#[async_trait]
impl AssistantClient for AssistantWsClient {
    async fn query(
        &self,
        query: VoiceQuery,
    ) -> Result<mpsc::Receiver<Result<AssistantEvent, VoiceError>>, VoiceError> {
        let req = self
            .ws_url
            .as_str()
            .into_client_request()
            .map_err(|e| VoiceError::Assistant(e.to_string()))?;
        let (ws, _) = connect_async(req)
            .await
            .map_err(|e| VoiceError::Assistant(e.to_string()))?;
        let (mut sink, mut stream) = ws.split();

        let payload =
            serde_json::to_string(&query).map_err(|e| VoiceError::Assistant(e.to_string()))?;
        sink.send(Message::Text(payload.into()))
            .await
            .map_err(|e| VoiceError::Assistant(e.to_string()))?;

        let (tx, rx) = mpsc::channel::<Result<AssistantEvent, VoiceError>>(64);
        tokio::spawn(async move {
            while let Some(msg) = stream.next().await {
                match msg {
                    Ok(Message::Text(txt)) => {
                        if let Ok(frame) = serde_json::from_str::<AssistantToken>(&txt) {
                            match frame.kind.as_deref() {
                                Some("done") | Some("error") => break,
                                Some("reminder") => {
                                    let payload = ReminderPayload {
                                        title: frame.title.unwrap_or_default(),
                                        body: frame.body.unwrap_or_default(),
                                        when: frame.when.unwrap_or_default(),
                                        scheduled_at: frame.scheduled_at.unwrap_or_default(),
                                    };
                                    if tx.send(Ok(AssistantEvent::Reminder(payload))).await.is_err() {
                                        break;
                                    }
                                }
                                _ => {
                                    if let Some(text) = frame.text {
                                        if tx.send(Ok(AssistantEvent::Token(text))).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Err(e) => {
                        let _ = tx.send(Err(VoiceError::Assistant(e.to_string()))).await;
                        break;
                    }
                    _ => {}
                }
            }
        });
        Ok(rx)
    }
}

// ---- Pump/worker turn engine ----

/// Holds the swappable provider ports and session config.
pub struct VoiceSession {
    pub stt: Box<dyn Transcriber>,
    pub assistant: Arc<dyn AssistantClient>,
    pub tts: Arc<dyn Tts>,
    pub sink: Arc<dyn ResponseSink>,
    pub config: VoiceConfig,
    /// Encoded tenant_context_token from the inbound socket; forwarded verbatim
    /// to ap-assistant on each voiceQuery. Never parsed to bare claims here.
    pub tenant_context_token: String,
    /// Shared barge-in flag. Raised by the inbound socket pump when the client
    /// sends an explicit barge_in message; checked between TTS units so the
    /// in-progress turn stops generating. The client is the single source of
    /// barge-in truth (it owns the AEC'd input level), so the server never
    /// infers barge-in from interim transcripts.
    pub abort: AbortSignal,
    pub latency: LatencyTracker,
}

impl VoiceSession {
    pub fn new(
        stt: Box<dyn Transcriber>,
        assistant: Arc<dyn AssistantClient>,
        tts: Arc<dyn Tts>,
        sink: Arc<dyn ResponseSink>,
        config: VoiceConfig,
        tenant_context_token: String,
        abort: AbortSignal,
    ) -> Self {
        Self {
            stt,
            assistant,
            tts,
            sink,
            config,
            tenant_context_token,
            abort,
            latency: LatencyTracker::default(),
        }
    }

    /// Pump: drain STT transcripts onto a queue. Final transcripts enqueue a
    /// turn. Barge-in is driven by the client, not by interim transcripts here.
    /// Runs until STT ends.
    pub async fn run(&mut self) {
        let (turn_tx, mut turn_rx) = mpsc::unbounded_channel::<String>();
        let abort = self.abort.clone();

        // Worker: one turn at a time.
        let assistant = self.assistant.clone();
        let tts = self.tts.clone();
        let sink = self.sink.clone();
        let config = self.config.clone();
        let token = self.tenant_context_token.clone();
        let worker_abort = abort.clone();
        let worker = tokio::spawn(async move {
            while let Some(transcript) = turn_rx.recv().await {
                worker_abort.reset();
                // Barge-in is normal turn cancellation, not an error; only real
                // provider/stream failures are logged.
                if let Err(e) =
                    run_turn(&assistant, &tts, &sink, &config, &worker_abort, &token, transcript)
                        .await
                {
                    if !matches!(e, VoiceError::BargeIn) {
                        eprintln!("[ap-voice] turn failed: {e}");
                    }
                }
            }
        });

        // Ingestion pump: only final transcripts matter here; each starts a turn.
        while let Some(t) = self.stt.next_transcript().await {
            if t.is_final && !t.text.trim().is_empty() {
                let _ = self
                    .sink
                    .send(ResponseEvent::UserTranscript(t.text.clone()))
                    .await;
                let _ = turn_tx.send(t.text);
            }
        }
        drop(turn_tx);
        let _ = worker.await;
    }
}

/// One turn: query assistant, sentence-chunk tokens, synthesize each sentence
/// to PCM, stream small units down. Filler masks think-time. Barge-in checked
/// between TTS units. A provider failure aborts only this turn.
async fn run_turn(
    assistant: &Arc<dyn AssistantClient>,
    tts: &Arc<dyn Tts>,
    sink: &Arc<dyn ResponseSink>,
    config: &VoiceConfig,
    abort: &AbortSignal,
    tenant_context_token: &str,
    transcript: String,
) -> Result<(), VoiceError> {
    let query = VoiceQuery {
        // Encoded token from the inbound voice socket; ap-assistant verifies it.
        tenant_context_token: tenant_context_token.to_string(),
        transcript,
    };

    // Tell the client a fresh response is starting so it stops suppressing the
    // tail of the turn it just barged out of and plays this one from the top.
    sink.send(ResponseEvent::ResponseStart).await?;

    let assistant_start = Instant::now();
    let mut tokens = assistant.query(query).await?;

    // Filler masking task: speak a filler past filler_delay_ms if no real audio
    // yet; cancelled the instant real audio begins.
    let first_audio = Arc::new(AtomicBool::new(false));
    let filler_handle = spawn_filler(
        config.clone(),
        tts.clone(),
        sink.clone(),
        abort.clone(),
        first_audio.clone(),
    );

    let mut streamer = SentenceStreamer::new(24);
    let mut reply_text = String::new();
    let mut tts_total_ms: u128 = 0;

    while let Some(item) = tokens.recv().await {
        if abort.is_raised() {
            filler_handle.abort();
            return Err(VoiceError::BargeIn);
        }
        match item? {
            AssistantEvent::Reminder(payload) => {
                // Forward the reminder to the client as a text frame; it is not
                // spoken, so it never enters the TTS path.
                let _ = sink.send(ResponseEvent::Reminder(payload)).await;
            }
            AssistantEvent::Token(token) => {
                reply_text.push_str(&token);
                for sentence in streamer.push(&token) {
                    tts_total_ms += stream_sentence(
                        tts, sink, abort, &first_audio, &filler_handle, &sentence,
                    )
                    .await?;
                }
            }
        }
    }
    if let Some(tail) = streamer.flush() {
        tts_total_ms += stream_sentence(
            tts, sink, abort, &first_audio, &filler_handle, &tail,
        )
        .await?;
    }
    let _ = assistant_start;
    let _ = tts_total_ms;

    filler_handle.abort();
    // Emit assistant transcript so the shared chat thread shows the spoken turn.
    let _ = sink
        .send(ResponseEvent::AssistantTranscript(reply_text))
        .await;
    Ok(())
}

/// Downstream PCM unit size: ~40ms of pcm_16000 mono s16 (32000 bytes/sec).
/// Even, so every emitted chunk ends on a whole 16-bit sample. Small units keep
/// the client's playback buffer shallow so barge-in drops near-instantly.
const PCM_CHUNK_BYTES: usize = 1280;

/// Synthesize one sentence and stream it down as small fixed-size PCM units,
/// checking barge-in between units. Returns synthesis time in ms.
async fn stream_sentence(
    tts: &Arc<dyn Tts>,
    sink: &Arc<dyn ResponseSink>,
    abort: &AbortSignal,
    first_audio: &Arc<AtomicBool>,
    filler_handle: &tokio::task::JoinHandle<()>,
    sentence: &str,
) -> Result<u128, VoiceError> {
    let start = Instant::now();
    let mut chunks = tts.synthesize(sentence).await?;
    // Forward pcm_16000 as it arrives, sliced into PCM_CHUNK_BYTES units on
    // whole-sample boundaries. carry holds the partial tail between provider
    // chunks (which can split mid-sample) until a full unit is available.
    let mut carry: Vec<u8> = Vec::new();
    while let Some(chunk) = chunks.recv().await {
        if abort.is_raised() {
            // Unwind: drop queued audio for this turn.
            return Err(VoiceError::BargeIn);
        }
        carry.extend_from_slice(&chunk?);
        while carry.len() >= PCM_CHUNK_BYTES {
            if abort.is_raised() {
                return Err(VoiceError::BargeIn);
            }
            let unit: Vec<u8> = carry.drain(..PCM_CHUNK_BYTES).collect();
            if !first_audio.swap(true, Ordering::SeqCst) {
                // Real audio began; cancel filler.
                filler_handle.abort();
            }
            sink.send(ResponseEvent::AudioChunk(unit)).await?;
        }
    }
    // Flush the sentence tail (whole samples; total pcm length is even).
    if !carry.is_empty() {
        if abort.is_raised() {
            return Err(VoiceError::BargeIn);
        }
        if !first_audio.swap(true, Ordering::SeqCst) {
            filler_handle.abort();
        }
        sink.send(ResponseEvent::AudioChunk(carry)).await?;
    }
    Ok(start.elapsed().as_millis())
}

/// Spawn the filler task: wait filler_delay, then speak a filler if no real
/// audio has started. Self-cancels via abort.
fn spawn_filler(
    config: VoiceConfig,
    tts: Arc<dyn Tts>,
    sink: Arc<dyn ResponseSink>,
    abort: AbortSignal,
    first_audio: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        tokio::time::sleep(config.filler_delay()).await;
        if first_audio.load(Ordering::SeqCst) || abort.is_raised() {
            return;
        }
        let mut pool = FillerPool::new(false);
        let Some(phrase) = pool.next() else { return };
        // Synthesize the filler to MP3 and stream it, masking think-time with
        // real audio. Provider failure here is swallowed: the filler is
        // best-effort and must never abort the real turn.
        let Ok(mut chunks) = tts.synthesize(&phrase).await else {
            return;
        };
        // Forward the filler as small PCM units too, so barging in during the
        // filler drops it just as fast. carry holds the partial tail between
        // provider chunks until a whole-sample unit is available.
        let mut carry: Vec<u8> = Vec::new();
        while let Some(chunk) = chunks.recv().await {
            if first_audio.load(Ordering::SeqCst) || abort.is_raised() {
                return;
            }
            let Ok(bytes) = chunk else { return };
            carry.extend_from_slice(&bytes);
            while carry.len() >= PCM_CHUNK_BYTES {
                if first_audio.load(Ordering::SeqCst) || abort.is_raised() {
                    return;
                }
                let unit: Vec<u8> = carry.drain(..PCM_CHUNK_BYTES).collect();
                let _ = sink.send(ResponseEvent::AudioChunk(unit)).await;
            }
        }
        if carry.is_empty() || first_audio.load(Ordering::SeqCst) || abort.is_raised() {
            return;
        }
        let _ = sink.send(ResponseEvent::AudioChunk(carry)).await;
    })
}
