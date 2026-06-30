import { useEffect, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import {
  BlurMask,
  Canvas,
  Fill,
  Group,
  Path,
  Skia,
  useClock,
} from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import type { audio_io } from "./types";

// Full-black ambient idle screen shown while the wake word is listening and no
// voice session is active. On OLED the black pixels are off, recovering most of
// the locked-screen battery cost while the app stays foreground and listening.
// Dismissed on first touch.
//
// The waveform is the three-color bezier visualization from the fgnass CodePen,
// ported to react-native-skia. It reacts to the assistant's output level only
// (never the user's input) and is flat while no assistant audio is playing, so
// the idle screen lights no pixels until the assistant speaks.

// Reference canvas space from the pen; the path is built here and scaled to fit.
const REF_WIDTH = 1000;
const REF_HEIGHT = 400;
const MID = REF_HEIGHT / 2;

// Look options from the pen.
const opts = {
  color1: [203, 36, 128],
  color2: [41, 200, 192],
  color3: [24, 137, 218],
  fillOpacity: 0.6,
  glow: 10,
  width: 60,
  shift: 50,
  amp: 1,
};
const COLORS = [opts.color1, opts.color2, opts.color3];

// Per-index vertical scale: center peak is tallest (1,2,3,2,1)/3 * amp.
function band_scale(i: number): number {
  "worklet";
  const x = Math.abs(2 - i); // 2,1,0,1,2
  return ((3 - x) / 3) * opts.amp; // 1,2,3,2,1 -> /3
}

// Build one channel's closed bezier path in the reference coordinate space,
// mirroring path() in the pen. y holds the five peak heights for this channel.
function build_channel(channel: number, y: number[]): ReturnType<typeof Skia.Path.Make> {
  "worklet";
  const p = Skia.Path.Make();
  const offset = (REF_WIDTH - 15 * opts.width) / 2;
  const x: number[] = [];
  for (let i = 0; i < 15; i += 1) x.push(offset + channel * opts.shift + i * opts.width);
  const m = MID;
  const h = 2 * m;

  p.moveTo(0, m);
  p.lineTo(x[0], m + 1);
  p.cubicTo(x[1], m + 1, x[2], y[0], x[3], y[0]);
  p.cubicTo(x[4], y[0], x[4], y[1], x[5], y[1]);
  p.cubicTo(x[6], y[1], x[6], y[2], x[7], y[2]);
  p.cubicTo(x[8], y[2], x[8], y[3], x[9], y[3]);
  p.cubicTo(x[10], y[3], x[10], y[4], x[11], y[4]);
  p.cubicTo(x[12], y[4], x[12], m, x[13], m);
  p.lineTo(REF_WIDTH, m + 1);
  p.lineTo(x[13], m - 1);
  p.cubicTo(x[12], m, x[12], h - y[4], x[11], h - y[4]);
  p.cubicTo(x[10], h - y[4], x[10], h - y[3], x[9], h - y[3]);
  p.cubicTo(x[8], h - y[3], x[8], h - y[2], x[7], h - y[2]);
  p.cubicTo(x[6], h - y[2], x[6], h - y[1], x[5], h - y[1]);
  p.cubicTo(x[4], h - y[1], x[4], h - y[0], x[3], h - y[0]);
  p.cubicTo(x[2], h - y[0], x[1], m, x[0], m);
  p.lineTo(0, m);
  p.close();
  return p;
}

// Five peak heights for a channel, driven by the assistant level and time. At
// level 0 every peak collapses to the midline, so the waveform is flat. The
// per-band sine phase keeps neighboring peaks out of sync, as the pen's
// frequency bands are.
function channel_peaks(channel: number, level: number, t: number): number[] {
  "worklet";
  const y: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const wobble = 0.5 + 0.5 * Math.sin(t * 0.006 + channel * 1.7 + i * 1.3);
    const amp = level * 255 * band_scale(i) * wobble;
    y.push(Math.max(0, MID - amp));
  }
  return y;
}

export function IdleOverlay(props: { audio: audio_io; visible: boolean }) {
  const { width, height } = useWindowDimensions();
  const [dismissed, set_dismissed] = useState(false);

  // Assistant output level (0..1), smoothed so the waveform settles instead of
  // snapping. Written from the playback engine, read inside the path worklets.
  const level = useSharedValue(0);
  useEffect(() => {
    if (!props.visible) return;
    const off = props.audio.on_output_level((v) => {
      level.value = level.value * 0.6 + v * 0.4;
    });
    return off;
  }, [props.audio, props.visible, level]);

  // Reset the dismissal each time the overlay is re-shown.
  useEffect(() => {
    if (props.visible) set_dismissed(false);
  }, [props.visible]);

  const clock = useClock();

  const path0 = useDerivedValue(() => build_channel(0, channel_peaks(0, level.value, clock.value)));
  const path1 = useDerivedValue(() => build_channel(1, channel_peaks(1, level.value, clock.value)));
  const path2 = useDerivedValue(() => build_channel(2, channel_peaks(2, level.value, clock.value)));
  const paths = [path0, path1, path2];

  // Center the 1000x400 reference space in the screen, scaled to full width.
  const scale = width / REF_WIDTH;
  const transform = [
    { translateX: 0 },
    { translateY: height / 2 - (REF_HEIGHT * scale) / 2 },
    { scale },
  ];

  if (!props.visible || dismissed) return null;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => set_dismissed(true)}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color="black" />
        <Group transform={transform}>
          {paths.map((path, i) => {
            const c = COLORS[i];
            return (
              <Group key={i} blendMode="screen">
                <Path
                  path={path}
                  color={`rgba(${c[0]}, ${c[1]}, ${c[2]}, ${opts.fillOpacity})`}
                >
                  <BlurMask blur={opts.glow} style="solid" />
                </Path>
              </Group>
            );
          })}
        </Group>
      </Canvas>
    </Pressable>
  );
}
