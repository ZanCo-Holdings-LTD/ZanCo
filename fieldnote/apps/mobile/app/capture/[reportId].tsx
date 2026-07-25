import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { addCapture, addPhoto } from '../../src/store/local';
import { OfflineBadge } from '../../src/components/OfflineBadge';
import { SectionChips } from '../../src/components/SectionChips';

/**
 * Capture — the only screen that matters.
 *
 * A large record button, a live level meter, a horizontal strip of section
 * chips, and a camera button. Nothing else. The surveyor is holding a torch in
 * one hand and a moisture meter in the other; every additional control is one
 * they might hit by accident.
 *
 * Recording never waits on the network. Everything is written to disk the
 * moment it exists, and the upload queue takes it from there — which is why the
 * offline indicator is informational rather than a warning.
 */
export default function CaptureScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);

  const startedAt = useRef<number>(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tick.current) clearInterval(tick.current);
      // Never leave the microphone held open on unmount.
      void recording?.stopAndUnloadAsync().catch(() => {});
    };
  }, [recording]);

  async function start() {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Microphone needed',
        'Fieldnote records your spoken notes so you do not have to type the report afterwards.',
      );
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      // Keeps recording when the screen locks or the surveyor switches apps to
      // check a plan. A survey interrupted by a phone call must not be lost.
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });

    const { recording: created } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
      (status) => {
        if (status.isRecording) {
          setElapsedMs(status.durationMillis);
          setLevel(status.metering === undefined ? 0 : normaliseMetering(status.metering));
        }
      },
      100,
    );

    startedAt.current = Date.now();
    setRecording(created);
  }

  async function stop() {
    if (!recording) return;

    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    const status = await recording.getStatusAsync();
    setRecording(null);
    setElapsedMs(0);
    setLevel(0);

    if (!uri) return;

    // Straight to disk, in `pending` state. No network call on this path.
    await addCapture({
      id: crypto.randomUUID(),
      report_id: reportId,
      file_uri: uri,
      duration_ms: status.durationMillis ?? 0,
      section_key: sectionKey,
      created_at: Date.now(),
    });
  }

  async function attachPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, exif: true });
    if (result.canceled || !result.assets[0]) return;

    await addPhoto({
      id: crypto.randomUUID(),
      report_id: reportId,
      capture_id: null,
      file_uri: result.assets[0].uri,
      section_key: sectionKey,
      caption: null,
      // Anchored to the moment in the recording, so the reviewer sees the
      // photograph against what was being said when it was taken.
      capture_offset_ms: recording ? Date.now() - startedAt.current : null,
      created_at: Date.now(),
    });

    setPhotoCount((count) => count + 1);
  }

  return (
    <View style={styles.screen}>
      <OfflineBadge />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        <SectionChips selected={sectionKey} onSelect={setSectionKey} />
      </ScrollView>

      <View style={styles.meterArea}>
        <Text style={styles.timer}>{formatElapsed(elapsedMs)}</Text>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%` }]} />
        </View>
        {photoCount > 0 && (
          <Text style={styles.photoCount}>
            {photoCount} photograph{photoCount === 1 ? '' : 's'} attached
          </Text>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={attachPhoto}
          accessibilityLabel="Take a photograph"
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>Photo</Text>
        </Pressable>

        <Pressable
          onPress={() => void (recording ? stop() : start())}
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          style={[styles.recordButton, recording && styles.recordButtonActive]}
        >
          <Text style={styles.recordLabel}>{recording ? 'Stop' : 'Record'}</Text>
        </Pressable>

        <View style={styles.secondaryButton} />
      </View>
    </View>
  );
}

/** Metering arrives in dBFS, roughly -160 (silence) to 0 (clipping). */
function normaliseMetering(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfbf9' },
  chips: { flexGrow: 0, paddingVertical: 12 },
  meterArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  timer: { fontSize: 56, fontVariant: ['tabular-nums'], color: '#1a1a1a' },
  meter: {
    width: '70%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e5e5e5',
    overflow: 'hidden',
  },
  meterFill: { height: '100%', backgroundColor: '#1a1a1a' },
  photoCount: { color: '#5c5c5c', fontSize: 14 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  // Deliberately oversized: this is pressed with cold hands, in gloves, in bad
  // light, without looking at the screen.
  recordButton: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: { backgroundColor: '#b3261e' },
  recordLabel: { color: '#fff', fontSize: 18, fontWeight: '600' },
  secondaryButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  secondaryLabel: { color: '#1a1a1a', fontSize: 14 },
});
