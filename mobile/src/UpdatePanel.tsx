import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PixiesClient } from './client';
import { Status } from './model';
import {
  compareVersion,
  isVersion,
  latestRelease,
  NoPublishedRelease,
  Release,
} from './releases';
import {
  checkCanceled,
  download,
  firmwareProblem,
  installer,
  removeDownload,
  updateFirmware,
} from './updates';
import { APP_VERSION, APP_VERSION_CODE } from './version';

interface Props {
  health: Status | null;
  disabled: boolean;
  client(): PixiesClient;
  onBusy(busy: boolean): void;
  reconnect(
    oldBoot: string,
    version: string,
    signal: AbortSignal,
  ): Promise<Status>;
  visible?: boolean;
  onAttention?(needed: boolean): void;
}
function Action({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
export function UpdatePanel({
  health,
  disabled,
  client,
  onBusy,
  reconnect,
  visible = true,
  onAttention,
}: Props) {
  const [release, setRelease] = useState<Release | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const [checkFailed, setCheckFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(false);
  const [cancelable, setCancelable] = useState(true);
  const [pendingApk, setPendingApk] = useState<{
    path: string;
    release: Release;
  } | null>(null);
  const operation = useRef<AbortController | null>(null);
  const checkingOperation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const foreground = useRef(AppState.currentState !== 'background');
  const checkRequested = useRef(false);
  const checkAction = useRef<() => Promise<void>>(async () => {});
  checkAction.current = async () => {
    checkRequested.current = true;
    if (
      !mounted.current ||
      !foreground.current ||
      checkingOperation.current ||
      operation.current
    ) {
      return;
    }
    checkRequested.current = false;
    const abort = new AbortController();
    checkingOperation.current = abort;
    setChecking(true);
    setCheckFailed(false);
    setCheckMessage('Checking for updates...');
    try {
      const next = await latestRelease(abort.signal);
      if (mounted.current && !abort.signal.aborted) {
        setRelease(next);
        setCheckMessage(`Latest published release: ${next.version}`);
      }
    } catch (error) {
      if (mounted.current && !abort.signal.aborted) {
        if (error instanceof NoPublishedRelease) {
          setRelease(null);
          setCheckMessage(error.message);
        } else {
          setCheckFailed(true);
          setCheckMessage(
            error instanceof Error
              ? error.message
              : 'Could not check for updates.',
          );
        }
      }
    } finally {
      checkingOperation.current = null;
      if (mounted.current) {
        setChecking(false);
        if (checkRequested.current && foreground.current) {
          checkAction.current();
        }
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    checkAction.current();
    const listener = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state !== 'active') {
        operation.current?.abort();
        checkingOperation.current?.abort();
      } else {
        checkAction.current();
      }
    });
    return () => {
      mounted.current = false;
      listener.remove();
      operation.current?.abort();
      checkingOperation.current?.abort();
    };
  }, []);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (operation.current || disabled) {
      return;
    }
    const abort = new AbortController();
    operation.current = abort;
    setActive(true);
    setCancelable(true);
    setFailed(false);
    onBusy(true);
    setMessage('');
    const deadline = setTimeout(() => abort.abort(), 20 * 60 * 1000);
    try {
      await work(abort.signal);
    } catch (error) {
      if (mounted.current) {
        setFailed(true);
        setMessage(
          error instanceof Error
            ? error.message
            : 'Update failed. Read device state before retrying.',
        );
      }
    } finally {
      clearTimeout(deadline);
      operation.current = null;
      if (mounted.current) {
        setActive(false);
        onBusy(false);
        if (checkRequested.current) {
          checkAction.current();
        }
      }
    }
  }
  function progress(stage: string, percent?: number) {
    if (!mounted.current) {
      return;
    }
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
      setMessage(
        'APK verified. Allow “Install unknown apps” for Pixies in Android settings, return here, then tap Install downloaded APK.',
      );
      return;
    }
    const result = await native.install(
      path,
      next.version,
      next.android.versionCode,
      next.android.sha256,
    );
    if (result !== 'installer_opened') {
      throw new Error('Android installer did not open.');
    }
    setPendingApk(null);
    setMessage(
      'Android installer opened. Confirm installation there. This is not a confirmed install; the new app version appears after restarting the app.',
    );
  }
  const problem = release ? firmwareProblem(health, release) : null;
  const newerApp =
    release &&
    compareVersion(release.version, APP_VERSION) > 0 &&
    release.android.versionCode > APP_VERSION_CODE;
  const newerFirmware =
    release &&
    health &&
    release.firmware.target === health.firmware.target &&
    (!isVersion(health.firmware.version) ||
      compareVersion(release.version, health.firmware.version) > 0);
  const attention = !!(
    checkFailed ||
    failed ||
    pendingApk ||
    newerFirmware ||
    (Platform.OS === 'android' && newerApp)
  );
  useEffect(() => {
    onAttention?.(attention);
  }, [attention, onAttention]);
  return (
    <View
      testID="updates-panel"
      style={[styles.card, !visible && styles.hidden]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <Text style={styles.title}>Updates</Text>
      <Text style={styles.text}>
        App {APP_VERSION} · Firmware{' '}
        {health?.firmware.version ?? 'not connected'}
      </Text>
      <Text style={styles.text}>
        Downloads need Internet on your phone. Firmware transfers use Bluetooth,
        not the ESP hotspot. Keep the app open and controller powered during
        updates.
      </Text>
      {message ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {message}
        </Text>
      ) : null}
      {checkMessage ? (
        <Text
          testID="update-check-status"
          accessibilityRole={checkFailed ? 'alert' : undefined}
          style={styles.text}
        >
          {checkMessage}
        </Text>
      ) : null}
      <Action
        label="Check for updates"
        disabled={checking || active}
        onPress={() => {
          checkAction.current();
        }}
      />
      {release && (
        <>
          <Text style={styles.text}>Available: {release.version}</Text>
          {problem && <Text style={styles.text}>{problem}</Text>}
          <Action
            label="Update controller firmware"
            disabled={disabled || active || !!problem}
            onPress={() =>
              Alert.alert(
                `Install firmware ${release.version}?`,
                'Saved settings are preserved. Unsaved previews are lost on restart and lights pause during transfer. Keep the app open and stay near the controller.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Update',
                    onPress: () =>
                      run(async signal => {
                        const path = await download(
                          release.firmware,
                          signal,
                          progress,
                        );
                        try {
                          await updateFirmware(
                            client(),
                            release,
                            path,
                            signal,
                            progress,
                            reconnect,
                          );
                        } finally {
                          await removeDownload(path);
                        }
                      }),
                  },
                ],
              )
            }
          />
          {Platform.OS === 'android' ? (
            <>
              {!newerApp && (
                <Text style={styles.text}>
                  No newer compatible Android app version is available.
                </Text>
              )}
              <Action
                label="Update Android app"
                disabled={disabled || active || !newerApp}
                onPress={() =>
                  Alert.alert(
                    `Install app ${release.version}?`,
                    'Download the signed APK, then approve Android’s installer. A development-signed app must be uninstalled once before switching to the production signing key.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Download',
                        onPress: () =>
                          run(async signal => {
                            const path = await download(
                              release.android,
                              signal,
                              progress,
                            );
                            await install(path, release, signal);
                          }),
                      },
                    ],
                  )
                }
              />
            </>
          ) : (
            <Text style={styles.text}>
              iPhone app updates use Apple distribution, not APK installation.
            </Text>
          )}
        </>
      )}
      {pendingApk && (
        <>
          <Text style={styles.text}>
            Verified APK waiting for installation: {pendingApk.release.version}
          </Text>
          <Action
            label="Open Android install settings"
            disabled={disabled || active}
            onPress={() =>
              run(async () => {
                await installer().openSettings();
              })
            }
          />
          <Action
            label="Install downloaded APK"
            disabled={disabled || active}
            onPress={() =>
              run(async signal => {
                await install(pendingApk.path, pendingApk.release, signal);
              })
            }
          />
        </>
      )}
      {active && cancelable && (
        <Action
          label="Cancel update"
          onPress={() => operation.current?.abort()}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  hidden: { display: 'none' },
  card: {
    backgroundColor: '#172033',
    padding: 18,
    borderRadius: 16,
    marginTop: 16,
    gap: 12,
  },
  title: { color: '#e0f2fe', fontSize: 21, fontWeight: '700' },
  text: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  button: { backgroundColor: '#add8e6', padding: 14, borderRadius: 10 },
  buttonText: { color: '#0f172a', fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
