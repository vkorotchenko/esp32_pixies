import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Bluetooth, FoundDevice } from './src/ble';
import { PixiesClient } from './src/client';
import {
  rememberedController,
  rememberController,
} from './src/controllerPreference';
import { UpdatePanel } from './src/UpdatePanel';
import { checkCanceled } from './src/updates';
import {
  Config,
  EFFECTS,
  isConfig,
  Palette,
  record,
  Snapshot,
  snapshot,
  Status,
  status,
  validateWifi,
  WifiNetwork,
  wifiScan,
} from './src/model';
const PRESETS: Palette[] = [
  {
    id: 'builtin:light-blue',
    name: 'Light blue',
    colors: ['#ADD8E6'],
  },
  {
    id: 'halloween',
    name: 'Halloween',
    colors: ['#00FF00', '#FFA500'],
  },
  {
    id: 'christmas',
    name: 'Christmas',
    colors: ['#FF0000', '#FFFFFF', '#00FF00'],
  },
];
const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  attention?: boolean;
  role?: 'button' | 'tab';
};
function Button({
  label,
  onPress,
  disabled,
  selected,
  attention,
  role = 'button',
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={attention ? `${label}, attention needed` : label}
      accessibilityState={{
        disabled,
        selected,
      }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        selected && styles.selected,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.buttonContent}>
        <Text style={styles.buttonText}>{label}</Text>
        {attention !== undefined && (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.badge, !attention && styles.invisible]}
          >
            <Text style={styles.badgeText}>!</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}
function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#94a3b8"
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}
function Controller() {
  const { fontScale } = useWindowDimensions();
  const [bluetooth] = useState(() => new Bluetooth());
  const client = useRef<PixiesClient | null>(null);
  const working = useRef(false);
  const selectedDevice = useRef<FoundDevice | null>(null);
  const updating = useRef(false);
  const mounted = useRef(false);
  const foreground = useRef(AppState.currentState !== 'background');
  const connectedRef = useRef(false);
  const paused = useRef(false);
  const autoRequested = useRef(false);
  const automaticConnection = useRef<() => Promise<void>>(async () => {});
  const connectionAttempt = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [connected, setConnected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [connectionMessage, setConnectionMessage] = useState(
    'Connecting automatically...',
  );
  const [connectionError, setConnectionError] = useState(false);
  const [updateAttention, setUpdateAttention] = useState(false);
  const [tab, setTab] = useState<
    'Lights' | 'Connection' | 'Updates' | 'Wi-Fi' | 'Device'
  >('Lights');
  const [state, setState] = useState<Snapshot | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [count, setCount] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [websitePassword, setWebsitePassword] = useState('');
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [paletteName, setPaletteName] = useState('');
  const [paletteColors, setPaletteColors] = useState('#ADD8E6');
  useEffect(() => {
    mounted.current = true;
    const request = () => {
      autoRequested.current = true;
      automaticConnection.current();
    };
    const stopWatching = bluetooth.onPoweredOn(request);
    const listener = AppState.addEventListener('change', next => {
      if (next === 'background') {
        foreground.current = false;
        connectionAttempt.current?.abort();
      } else if (next === 'active' && !foreground.current) {
        foreground.current = true;
        paused.current = false;
        request();
      }
    });
    request();
    return () => {
      mounted.current = false;
      connectionAttempt.current?.abort();
      stopWatching();
      listener.remove();
      client.current?.close();
      bluetooth
        .destroy()
        .catch(error => console.warn('Bluetooth cleanup failed:', error));
    };
  }, [bluetooth]);
  async function run(
    work: () => Promise<unknown>,
    progressMessage = '',
    connection = false,
  ) {
    if (working.current) {
      return;
    }
    working.current = true;
    setBusy(true);
    const report = connection ? setConnectionMessage : setMessage;
    report(progressMessage);
    if (connection) {
      setConnectionError(false);
    }
    try {
      await work();
    } catch (error) {
      if (mounted.current) {
        report(
          error instanceof Error
            ? error.message
            : 'Operation failed. Reload device state before retrying.',
        );
        if (connection) {
          setConnectionError(true);
        }
      }
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        if (autoRequested.current) {
          automaticConnection.current();
        }
      }
    }
  }
  async function runConnection(
    work: (signal: AbortSignal) => Promise<unknown>,
    progressMessage: string,
  ) {
    if (working.current) {
      return;
    }
    const abort = new AbortController();
    connectionAttempt.current = abort;
    try {
      await run(() => work(abort.signal), progressMessage, true);
    } finally {
      if (connectionAttempt.current === abort) {
        connectionAttempt.current = null;
      }
    }
  }
  function api(): PixiesClient {
    if (!client.current) {
      throw new Error('Connect to a Pixies controller first.');
    }
    return client.current;
  }
  function accept(value: Snapshot) {
    setState(value);
    setDraft(value.config);
    setCount(String(value.config.ledCount));
  }
  async function load() {
    const current = snapshot(await api().command('config'));
    const health = status(await api().command('status'));
    if (current.bootId !== health.bootId) {
      throw new Error('Controller restarted while reading. Reload again.');
    }
    accept(current);
    setDeviceStatus(health);
    return health;
  }
  async function disconnect() {
    connectedRef.current = false;
    client.current?.close();
    client.current = null;
    if (mounted.current) {
      setConnected(null);
      setState(null);
      setDraft(null);
      setDeviceStatus(null);
      setMessage('');
      setPassword('');
      setWebsitePassword('');
    }
    await bluetooth.close();
  }
  async function connect(device: FoundDevice, signal?: AbortSignal) {
    await disconnect();
    selectedDevice.current = device;
    const link = await bluetooth.connect(
      device.id,
      error => {
        if (!mounted.current) {
          return;
        }
        const wasConnected = connectedRef.current;
        client.current?.close();
        client.current = null;
        connectedRef.current = false;
        setConnected(null);
        setState(null);
        setDraft(null);
        setDeviceStatus(null);
        setPassword('');
        setWebsitePassword('');
        if (!updating.current) {
          setConnectionMessage(error.message);
          if (wasConnected) {
            autoRequested.current = true;
            automaticConnection.current();
          }
        }
      },
      signal,
    );
    client.current = new PixiesClient(link);
    const cancel = () => client.current?.close();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) {
        throw new Error('Bluetooth connection attempt canceled.');
      }
      await load();
      if (signal?.aborted || !mounted.current) {
        throw new Error('Bluetooth connection attempt canceled.');
      }
      connectedRef.current = true;
      setConnected(device.name);
    } catch (error) {
      await disconnect();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (!updating.current) {
      try {
        await rememberController(device.id);
      } catch (error) {
        throw new Error(
          `Connected, but automatic reconnection could not be saved: ${
            error instanceof Error ? error.message : 'storage failed'
          }`,
        );
      }
    }
    if (mounted.current) {
      setConnectionMessage(
        'Connected over Bluetooth. This controller is remembered.',
      );
    }
  }
  async function reconnectAfterUpdate(
    oldBoot: string,
    version: string,
    signal: AbortSignal,
  ): Promise<Status> {
    const device = selectedDevice.current;
    if (!device) {
      throw new Error(
        'Original controller identity is unavailable; reconnect manually to verify.',
      );
    }
    await disconnect();
    const deadline = Date.now() + 90000;
    let lastError = 'Controller did not reconnect.';
    while (Date.now() < deadline) {
      checkCanceled(signal);
      await sleep(1500);
      try {
        await connect(device, signal);
        const health = await load();
        checkCanceled(signal);
        if (health.bootId !== oldBoot && health.firmware.version === version) {
          return health;
        }
        lastError = `Controller still reports firmware ${health.firmware.version}; update is not verified.`;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : 'Bluetooth reconnection failed.';
      }
      await disconnect();
    }
    throw new Error(`Update is not verified. ${lastError}`);
  }
  async function scan(automatic: boolean, signal: AbortSignal) {
    setDevices([]);
    setScanning(true);
    try {
      const found = await new Promise<FoundDevice[]>((resolve, reject) => {
        const devicesById = new Map<string, FoundDevice>();
        bluetooth
          .scan(
            device => {
              if (mounted.current && !signal.aborted) {
                devicesById.set(device.id, device);
                setDevices([...devicesById.values()]);
              }
            },
            reject,
            () => resolve([...devicesById.values()]),
            signal,
          )
          .catch(reject);
      });
      if (signal.aborted) {
        throw new Error('Bluetooth connection attempt canceled.');
      }
      if (automatic) {
        autoRequested.current = false;
      }
      if (automatic && found.length === 1) {
        setConnectionMessage('Connecting to pixies...');
        await connect(found[0], signal);
      } else {
        setConnectionMessage(
          found.length
            ? 'Choose your controller below. Multiple controllers are never selected automatically.'
            : 'No controllers found. Power your pixies, then scan again.',
        );
      }
    } finally {
      if (mounted.current) {
        setScanning(false);
      }
    }
  }
  automaticConnection.current = async () => {
    if (connectedRef.current) {
      autoRequested.current = false;
      return;
    }
    if (
      !mounted.current ||
      !foreground.current ||
      paused.current ||
      working.current ||
      updating.current
    ) {
      return;
    }
    autoRequested.current = false;
    await runConnection(async signal => {
      const id = await rememberedController();
      if (signal.aborted) {
        throw new Error('Bluetooth connection attempt canceled.');
      }
      if (id) {
        await connect({ id, name: 'pixies', rssi: null }, signal);
      } else {
        await scan(true, signal);
      }
    }, 'Connecting automatically...');
  };
  function candidate(): Config {
    if (!draft || !/^\d{1,4}$/.test(count)) {
      throw new Error('Enter a whole LED count from 1 to 1000.');
    }
    const value = {
      ...draft,
      ledCount: Number(count),
    };
    if (!isConfig(value)) {
      throw new Error(
        'Check the LED count, controls, and custom palette limits.',
      );
    }
    return value;
  }
  async function preview(save: boolean) {
    if (!state) {
      throw new Error('Reload the controller configuration first.');
    }
    const current = snapshot(
      await api().command('config.set', {
        baseRevision: state.revision,
        config: candidate(),
      }),
    );
    accept(current);
    if (save) {
      const saved = snapshot(
        await api().command('config.save', {
          baseRevision: current.revision,
        }),
      );
      accept(saved);
      setMessage(
        saved.savedRestartRequired
          ? 'Saved. Restart for the LED count only.'
          : 'Saved. No restart needed.',
      );
    } else {
      setMessage('Preview active. Tap Save to keep it.');
    }
  }
  async function scanWifi() {
    const response = await api().command('wifi.scan');
    if (!record(response) || response.state !== 'running') {
      throw new Error('Wi-Fi scan was not acknowledged.');
    }
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const result = wifiScan(await api().command('wifi.scan.get'));
      if (result.state === 'complete') {
        setNetworks(result.networks);
        setMessage(
          result.networks.length
            ? 'Select your 2.4 GHz network.'
            : 'No networks found. You can enter a hidden SSID manually.',
        );
        return;
      }
      if (result.state !== 'running') {
        throw new Error('The ESP could not complete its Wi-Fi scan.');
      }
    }
    throw new Error(
      'Wi-Fi scan is still pending. Refresh status before retrying.',
    );
  }
  async function joinWifi() {
    validateWifi(ssid, password);
    try {
      const reply = await api().command('wifi.connect', {
        ssid,
        password,
      });
      if (!record(reply) || reply.state !== 'connecting') {
        throw new Error('Wi-Fi provisioning was not acknowledged.');
      }
    } finally {
      setPassword('');
    }
    setMessage('The ESP is testing this network. Bluetooth stays connected.');
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const result = status(await api().command('status'));
      setDeviceStatus(result);
      if (result.network.candidateState === 'failed') {
        throw new Error(
          `Wi-Fi setup failed: ${result.network.error}. Check the network and try again.`,
        );
      }
      if (
        result.network.candidateState === 'succeeded' &&
        result.network.connected &&
        result.network.wifiSaved
      ) {
        setMessage(
          `Wi-Fi connected and saved. Website: http://${result.network.ip}`,
        );
        return;
      }
    }
    throw new Error(
      'Wi-Fi outcome is not confirmed. Refresh device status before retrying.',
    );
  }
  function editPalette(palette: Palette) {
    setPaletteId(palette.id);
    setPaletteName(palette.name);
    setPaletteColors(palette.colors.join(', '));
  }
  function keepPalette() {
    if (!draft) {
      return;
    }
    const id = paletteId || `palette-${Date.now().toString(36)}`;
    const palette = {
      id,
      name: paletteName,
      colors: paletteColors.split(',').map(c => c.trim().toUpperCase()),
    };
    const current = draft.customPalettes.filter(p => p.id !== id);
    const next = {
      ...draft,
      paletteId: id,
      customPalettes: [...current, palette],
    };
    if (!isConfig(next)) {
      setMessage(
        'Use 1-32 ASCII characters for a name, 1-8 RGB hex colors, and at most 10 palettes.',
      );
      return;
    }
    setDraft(next);
    setPaletteId(null);
    setPaletteName('');
    setPaletteColors('#ADD8E6');
    setMessage(
      'Palette added to your draft. Preview or Save to send it to the ESP.',
    );
  }
  const blocked = busy || !connected || deviceStatus?.update.busy === true;
  const hasEdits =
    draft &&
    state &&
    (JSON.stringify(draft) !== JSON.stringify(state.config) ||
      count !== String(state.config.ledCount));
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Text style={styles.heading}>Pixies</Text>
        <Text style={styles.subtitle}>{connected || 'Your pixie lights'}</Text>
        <View accessibilityRole="tablist" style={styles.row}>
          {(
            ['Lights', 'Connection', 'Updates', 'Wi-Fi', 'Device'] as const
          ).map(name => (
            <Button
              key={name}
              role="tab"
              label={name}
              selected={tab === name}
              attention={
                name === 'Connection'
                  ? !connected || connectionError
                  : name === 'Updates'
                  ? updateAttention
                  : undefined
              }
              onPress={() => setTab(name)}
            />
          ))}
        </View>
        <Text
          testID="operation-status"
          accessibilityRole={message ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            {
              minHeight:
                2 * styles.notice.padding +
                3 * styles.notice.lineHeight * fontScale,
            },
            (tab === 'Connection' || tab === 'Updates') && styles.hidden,
          ]}
        >
          {message ||
            (updating.current
              ? 'Updating. See Updates.'
              : connected
              ? 'Ready.'
              : 'Lighting settings load after connection.')}
        </Text>
        <UpdatePanel
          health={deviceStatus}
          disabled={busy}
          visible={tab === 'Updates'}
          onAttention={setUpdateAttention}
          client={api}
          reconnect={reconnectAfterUpdate}
          onBusy={value => {
            updating.current = value;
            working.current = value;
            setBusy(value);
            if (!value && autoRequested.current) {
              automaticConnection.current();
            }
          }}
        />
        {tab === 'Connection' && (
          <Card title="Connection">
            <Text style={styles.text}>
              The last controller reconnects automatically. On first use, a
              single nearby pixies is selected after scanning finishes. Accept
              the phone's Bluetooth permission or pairing prompt if shown.
            </Text>
            <Text
              testID="connection-status"
              accessibilityRole={connectionError ? 'alert' : undefined}
              style={styles.text}
            >
              {connectionMessage}
            </Text>
            {connected && (
              <Button
                label="Disconnect"
                disabled={busy}
                onPress={() => {
                  paused.current = true;
                  autoRequested.current = false;
                  run(
                    disconnect,
                    'Disconnected. Automatic connection resumes next time you open the app.',
                    true,
                  );
                }}
              />
            )}
            <Button
              label={scanning ? 'Scan again' : 'Scan controllers'}
              disabled={busy}
              onPress={() => {
                paused.current = false;
                runConnection(
                  signal => scan(false, signal),
                  'Scanning for controllers...',
                );
              }}
            />
            {!connected && (
              <Button
                label="Reconnect automatically"
                disabled={busy}
                onPress={() => {
                  paused.current = false;
                  autoRequested.current = true;
                  automaticConnection.current();
                }}
              />
            )}
            {busy && connectionAttempt.current && (
              <Button
                label="Cancel connection"
                onPress={() => {
                  paused.current = true;
                  autoRequested.current = false;
                  connectionAttempt.current?.abort();
                }}
              />
            )}
            {devices.map(device => (
              <Button
                key={device.id}
                label={`${device.name}${
                  device.rssi !== null ? ` (${device.rssi} dBm)` : ''
                }`}
                disabled={busy}
                onPress={() => {
                  paused.current = false;
                  runConnection(
                    signal => connect(device, signal),
                    'Connecting to pixies...',
                  );
                }}
              />
            ))}
            {!devices.length && (
              <Text style={styles.text}>
                The ESP must be running the new Bluetooth-enabled firmware.
                Phones find it inside this app, not by joining its Wi-Fi
                hotspot.
              </Text>
            )}
          </Card>
        )}
        {tab === 'Lights' && (!draft || !state) && (
          <Card title="Lighting">
            <Text style={styles.text}>
              Your lighting settings will appear here when pixies connects.
              Connection and update checks run automatically without leaving
              this screen. Use their tabs if an orange exclamation mark needs
              attention.
            </Text>
          </Card>
        )}
        <>
          {tab === 'Lights' && draft && state && (
            <>
              <Card title="Lighting">
                <View style={styles.row}>
                  <Text style={styles.text}>Lights on</Text>
                  <Switch
                    accessibilityLabel="Lights on"
                    disabled={blocked}
                    value={draft.on}
                    onValueChange={on =>
                      setDraft({
                        ...draft,
                        on,
                      })
                    }
                  />
                </View>
                <Text style={styles.text}>
                  {hasEdits
                    ? 'Draft changes not applied'
                    : state.dirty
                    ? 'Device preview is not saved'
                    : 'Device settings loaded'}
                </Text>
                <Text style={styles.label}>Theme</Text>
                <View style={styles.row}>
                  {[...PRESETS, ...draft.customPalettes].map(p => (
                    <Button
                      key={p.id}
                      label={p.name}
                      selected={p.id === draft.paletteId}
                      disabled={blocked}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          paletteId: p.id,
                        })
                      }
                    />
                  ))}
                </View>
                <Text style={styles.label}>Effect</Text>
                <View style={styles.row}>
                  {EFFECTS.map(effect => (
                    <Button
                      key={effect}
                      label={effect}
                      selected={effect === draft.effect}
                      disabled={blocked}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          effect,
                        })
                      }
                    />
                  ))}
                </View>
                {(['brightness', 'speed', 'intensity', 'density'] as const).map(
                  key => (
                    <View key={key}>
                      <Text style={styles.label}>
                        {key}: {draft[key]}%
                      </Text>
                      <Slider
                        accessibilityLabel={key}
                        disabled={
                          blocked ||
                          (key !== 'brightness' && draft.effect === 'steady')
                        }
                        minimumValue={0}
                        maximumValue={100}
                        step={1}
                        value={draft[key]}
                        minimumTrackTintColor="#7dd3fc"
                        maximumTrackTintColor="#475569"
                        onValueChange={value =>
                          setDraft(current =>
                            current
                              ? {
                                  ...current,
                                  [key]: Math.round(value),
                                }
                              : current,
                          )
                        }
                      />
                    </View>
                  ),
                )}
                <Text style={styles.label}>LED count (1-1000)</Text>
                <Input
                  accessibilityLabel="LED count"
                  editable={!blocked}
                  keyboardType="number-pad"
                  value={count}
                  onChangeText={setCount}
                  maxLength={4}
                />
                <Text style={styles.text}>
                  Active: {state.activeLedCount}. Only LED-count changes need
                  Save, then Restart. Other lighting settings do not need a
                  restart.
                </Text>
                <View style={styles.row}>
                  <Button
                    label="Preview"
                    disabled={blocked}
                    onPress={() => run(() => preview(false))}
                  />
                  <Button
                    label="Save"
                    disabled={blocked}
                    onPress={() => run(() => preview(true), 'Saving...')}
                  />
                  <Button
                    label="Reload"
                    disabled={blocked}
                    onPress={() =>
                      Alert.alert(
                        'Reload from ESP?',
                        'Local draft edits will be replaced.',
                        [
                          {
                            text: 'Cancel',
                            style: 'cancel',
                          },
                          {
                            text: 'Reload',
                            onPress: () => run(load),
                          },
                        ],
                      )
                    }
                  />
                </View>
              </Card>
              <Card title="Custom palettes">
                {draft.customPalettes.map(p => (
                  <View key={p.id} style={styles.row}>
                    <Button
                      label={`Edit ${p.name}`}
                      disabled={blocked}
                      onPress={() => editPalette(p)}
                    />
                    <Button
                      label={`Delete ${p.name}`}
                      disabled={blocked}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          paletteId:
                            draft.paletteId === p.id
                              ? 'halloween'
                              : draft.paletteId,
                          customPalettes: draft.customPalettes.filter(
                            item => item.id !== p.id,
                          ),
                        })
                      }
                    />
                  </View>
                ))}
                <Text style={styles.text}>
                  {draft.customPalettes.length}/10 palettes. Changes remain a
                  draft until Preview or Save.
                </Text>
                <Input
                  accessibilityLabel="Palette name"
                  placeholder="Palette name"
                  editable={!blocked}
                  maxLength={32}
                  value={paletteName}
                  onChangeText={setPaletteName}
                />
                <Input
                  accessibilityLabel="Palette colors"
                  placeholder="#ADD8E6, #FFFFFF"
                  editable={!blocked}
                  value={paletteColors}
                  onChangeText={setPaletteColors}
                />
                <Text style={styles.text}>
                  Enter 1-8 six-digit RGB colors, separated by commas.
                </Text>
                <Button
                  label={
                    paletteId ? 'Update palette draft' : 'Add palette draft'
                  }
                  disabled={blocked}
                  onPress={keepPalette}
                />
              </Card>
            </>
          )}
          {tab === 'Wi-Fi' && (
            <Card title="Optional Wi-Fi">
              <Text style={styles.text}>
                Lighting and Bluetooth work without Wi-Fi. Joining your local
                2.4 GHz network enables the website; it does not expose the ESP
                to the Internet.
              </Text>
              <Button
                label="Scan Wi-Fi networks"
                disabled={blocked}
                onPress={() => run(scanWifi)}
              />
              {networks.map((n, i) => (
                <Button
                  key={`${n.ssid}-${i}`}
                  label={`${n.ssid || '(hidden)'} (${n.rssi} dBm)${
                    n.open ? ' - open' : ''
                  }`}
                  disabled={blocked || !n.ssid}
                  onPress={() => {
                    setSsid(n.ssid);
                    setPassword('');
                  }}
                />
              ))}
              <Input
                accessibilityLabel="Wi-Fi network"
                placeholder="Network name"
                editable={!blocked}
                value={ssid}
                onChangeText={setSsid}
              />
              <Input
                accessibilityLabel="Wi-Fi password"
                placeholder="Wi-Fi password"
                editable={!blocked}
                secureTextEntry
                textContentType="password"
                value={password}
                onChangeText={setPassword}
              />
              <Text style={styles.text}>
                Passwords are sent over encrypted Bluetooth and saved only on
                the ESP after a successful connection.
              </Text>
              <Button
                label="Connect and save Wi-Fi"
                disabled={blocked}
                onPress={() => run(joinWifi)}
              />
              <Button
                label="Refresh network status"
                disabled={blocked}
                onPress={() =>
                  run(async () => {
                    setDeviceStatus(status(await api().command('status')));
                  })
                }
              />
              {deviceStatus && (
                <Text style={styles.text}>
                  {deviceStatus.network.state}
                  {'\n'}
                  {deviceStatus.network.ip}
                  {'\n'}
                  {deviceStatus.network.hostname}
                </Text>
              )}
              {!!deviceStatus?.network.ip && (
                <Button
                  label="Open local website"
                  disabled={blocked}
                  onPress={() =>
                    run(async () => {
                      await Linking.openURL(
                        `http://${deviceStatus.network.ip}`,
                      );
                    })
                  }
                />
              )}
            </Card>
          )}
          {tab === 'Device' && (
            <Card title="Device">
              {deviceStatus && (
                <Text style={styles.text}>
                  Firmware {deviceStatus.firmware.version}
                  {'\n'}
                  LEDs: {deviceStatus.led.ready ? 'ready' : 'unavailable'} on
                  GPIO{deviceStatus.led.gpio}
                  {'\n'}
                  Frames: {deviceStatus.led.frames}
                  {'\n'}
                  Estimated current: {deviceStatus.led.estimatedMa} mA
                  {deviceStatus.led.limited ? ' (limited)' : ''}
                </Text>
              )}
              <Button
                label="Refresh device status"
                disabled={blocked}
                onPress={() =>
                  run(async () =>
                    setDeviceStatus(status(await api().command('status'))),
                  )
                }
              />
              <Button
                label="Restart ESP"
                disabled={blocked}
                onPress={() =>
                  Alert.alert(
                    'Restart ESP?',
                    'Only saved settings return after restart.',
                    [
                      {
                        text: 'Cancel',
                        style: 'cancel',
                      },
                      {
                        text: 'Restart',
                        onPress: () =>
                          run(async () => {
                            const result = await api().command('restart', {
                              confirm: 'restart',
                            });
                            if (!record(result) || result.restarting !== true) {
                              throw new Error('Restart was not acknowledged.');
                            }
                            await disconnect();
                            setMessage(
                              'Restart requested. Reconnect to load saved settings.',
                            );
                          }),
                      },
                    ],
                  )
                }
              />
              {deviceStatus && !deviceStatus.admin.configured && (
                <>
                  <Text style={styles.label}>
                    Optional website administration
                  </Text>
                  <Text style={styles.text}>
                    Not needed for this app. Set a website password only if you
                    want browser firmware uploads or web administration.
                  </Text>
                  <Input
                    accessibilityLabel="Website administration password"
                    placeholder="12-64 byte website password"
                    secureTextEntry
                    editable={!blocked}
                    value={websitePassword}
                    onChangeText={setWebsitePassword}
                  />
                  <Button
                    label="Set optional website password"
                    disabled={blocked}
                    onPress={() =>
                      run(async () => {
                        try {
                          const result = await api().command('admin.claim', {
                            password: websitePassword,
                          });
                          if (!record(result) || result.configured !== true) {
                            throw new Error(
                              'Website administration was not confirmed.',
                            );
                          }
                          setDeviceStatus(
                            status(await api().command('status')),
                          );
                          setMessage(
                            'Website password saved. The Bluetooth app still needs no login.',
                          );
                        } finally {
                          setWebsitePassword('');
                        }
                      })
                    }
                  />
                </>
              )}
            </Card>
          )}
        </>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  hidden: { display: 'none' },
  invisible: { opacity: 0 },
  buttonContent: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fb923c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#0b1220', fontSize: 15, fontWeight: '800' },
  safe: {
    flex: 1,
    backgroundColor: '#0b1220',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
    gap: 14,
  },
  heading: {
    fontSize: 36,
    fontWeight: '700',
    color: '#bae6fd',
  },
  subtitle: {
    fontSize: 15,
    color: '#94a3b8',
  },
  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#172033',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: '#cbd5e1',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e2e8f0',
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  button: {
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#334155',
  },
  selected: {
    backgroundColor: '#075985',
    borderWidth: 1,
    borderColor: '#7dd3fc',
  },
  disabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f8fafc',
  },
  notice: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#164e63',
    color: '#e0f2fe',
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    minHeight: 48,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    color: '#f1f5f9',
    fontSize: 16,
  },
});
export default function App() {
  return (
    <SafeAreaProvider>
      <Controller />
    </SafeAreaProvider>
  );
}
