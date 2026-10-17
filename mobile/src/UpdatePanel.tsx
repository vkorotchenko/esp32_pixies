import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { PixiesClient } from './client';
import { Status } from './model';
import { compareVersion, latestRelease, Release } from './releases';
import { checkCanceled, download, firmwareProblem, installer, removeDownload, updateFirmware } from './updates';
import { APP_VERSION, APP_VERSION_CODE } from './version';

interface Props {
  health: Status | null;
  disabled: boolean;
  client(): PixiesClient;
  onBusy(busy: boolean): void;
  reconnect(oldBoot: string, version: string, signal: AbortSignal): Promise<Status>;
}
function Action({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export function UpdatePanel({ health, disabled, client, onBusy, reconnect }: Props) {
  const [release, setRelease] = useState<Release | null>(null);
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(false);
  const [cancelable, setCancelable] = useState(true);
  const [pendingApk, setPendingApk] = useState<{ path: string; release: Release } | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        operation.current?.abort();
      }
    });
    return () => { listener.remove(); operation.current?.abort(); };
  }, []);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (operation.current || disabled) {
      return;
    }
    const abort = new AbortController();
    operation.current = abort;
    setActive(true); setCancelable(true); onBusy(true); setMessage('');
    const deadline = setTimeout(() => abort.abort(), 20 * 60 * 1000);
    try {
      await work(abort.signal);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Update failed. Read device state before retrying.');
    } finally {
      clearTimeout(deadline);
      operation.current = null;
      setActive(false); onBusy(false);
    }
  }
  function progress(stage: string, percent?: number) {
    if (stage === 'Verifying firmware on the ESP') {
      setCancelable(false);
    }
    setMessage(percent === undefined ? stage : `${stage}: ${percent}%`);
  }
  async function install(path: string, next: Release, signal: AbortSignal) {
    checkCanceled(signal);
    const native = installer();
    const permitted = await native.canInstall();
    checkCanceled(signal);
    if (!permitted) {
      setPendingApk({ path, release: next });
      setMessage('APK verified. Allow “Install unknown apps” for Pixies in Android settings, return here, then tap Install downloaded APK.');
      return;
    }
    const result = await native.install(path, next.version, next.android.versionCode, next.android.sha256);
    if (result !== 'installer_opened') {
      throw new Error('Android installer did not open.');
    }
    setPendingApk(null);
    setMessage('Android installer opened. Confirm installation there. This is not a confirmed install; the new app version appears after restarting the app.');
  }
  const problem = release ? firmwareProblem(health, release) : null;
  const newerApp = release && compareVersion(release.version, APP_VERSION) > 0 &&
    release.android.versionCode > APP_VERSION_CODE;
  return <View style={styles.card}>
    <Text style={styles.title}>Updates</Text>
    <Text style={styles.text}>App {APP_VERSION} · Firmware {health?.firmware.version ?? 'not connected'}</Text>
    <Text style={styles.text}>Downloads need Internet on your phone. Firmware transfers use Bluetooth, not the ESP hotspot. Keep the app open and controller powered during updates.</Text>
    {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
    <Action label="Check for updates" disabled={disabled || active} onPress={() => run(async signal => {
      const next = await latestRelease(signal);
      setRelease(next); setMessage(`Latest published release: ${next.version}`);
    })} />
    {release && <>
      <Text style={styles.text}>Available: {release.version}</Text>
      {problem && <Text style={styles.text}>{problem}</Text>}
      <Action label="Update controller firmware" disabled={disabled || active || !!problem}
        onPress={() => Alert.alert(`Install firmware ${release.version}?`,
          'Saved settings are preserved. Unsaved previews are lost on restart and lights pause during transfer. Keep the app open and stay near the controller.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Update', onPress: () => run(async signal => {
            const path = await download(release.firmware, signal, progress);
            try { await updateFirmware(client(), release, path, signal, progress, reconnect); }
            finally { await removeDownload(path); }
          }) }])} />
      {Platform.OS === 'android' ? <>
        {!newerApp && <Text style={styles.text}>No newer compatible Android app version is available.</Text>}
        <Action label="Update Android app" disabled={disabled || active || !newerApp}
          onPress={() => Alert.alert(`Install app ${release.version}?`,
            'Download the signed APK, then approve Android’s installer. A development-signed app must be uninstalled once before switching to the production signing key.',
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Download', onPress: () => run(async signal => {
              const path = await download(release.android, signal, progress);
              await install(path, release, signal);
            }) }])} />
      </> : <Text style={styles.text}>iPhone app updates use Apple distribution, not APK installation.</Text>}
    </>}
    {pendingApk && <>
      <Action label="Open Android install settings" disabled={disabled || active}
        onPress={() => run(async () => { await installer().openSettings(); })} />
      <Action label="Install downloaded APK" disabled={disabled || active}
        onPress={() => run(async signal => { await install(pendingApk.path, pendingApk.release, signal); })} />
    </>}
    {active && cancelable && <Action label="Cancel update" onPress={() => operation.current?.abort()} />}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#172033', padding: 18, borderRadius: 16, marginTop: 16, gap: 12 },
  title: { color: '#e0f2fe', fontSize: 21, fontWeight: '700' },
  text: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  button: { backgroundColor: '#add8e6', padding: 14, borderRadius: 10 },
  buttonText: { color: '#0f172a', fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
