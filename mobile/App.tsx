import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  Modal,
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
import { PowerNotice, PowerSettings } from './src/PowerSettings';
import { DEFAULT_LIGHTS, sliderCount } from './src/power';
import { checkCanceled } from './src/updates';
import {
  Config,
  EFFECTS,
  isConfig,
  Palette,
  PowerConfig,
  record,
  Snapshot,
  snapshot,
  Status,
  status,
  validateWifi,
  WifiNetwork,
  wifiScan,
} from './src/model';
const MAX_PALETTE_COLORS = 5;
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
  const lastRead = useRef<Snapshot | null>(null);
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<
    'Lights' | 'Connection' | 'Updates' | 'Wi-Fi' | 'Device'
  >('Lights');
  const [state, setState] = useState<Snapshot | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Config>(DEFAULT_LIGHTS);
  const [count, setCount] = useState(String(DEFAULT_LIGHTS.ledCount));
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [websitePassword, setWebsitePassword] = useState('');
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [paletteName, setPaletteName] = useState('');
  const [paletteColors, setPaletteColors] = useState(['#ADD8E6']);
  const [colorPicker, setColorPicker] = useState<{
    index: number;
    color: string;
  } | null>(null);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }
      if (tab !== 'Lights') {
        setTab('Lights');
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [menuOpen, tab]);
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
    lastRead.current = value;
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
      setDraft(lastRead.current?.config ?? DEFAULT_LIGHTS);
      setCount(
        String(lastRead.current?.config.ledCount ?? DEFAULT_LIGHTS.ledCount),
      );
      setMessage('');
      setColorPicker(null);
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
        setColorPicker(null);
        setDraft(lastRead.current?.config ?? DEFAULT_LIGHTS);
        setCount(
          String(lastRead.current?.config.ledCount ?? DEFAULT_LIGHTS.ledCount),
        );
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
    if (value.customPalettes.some(p => p.colors.length > MAX_PALETTE_COLORS)) {
      throw new Error(
        'Custom palettes have more than 5 colors. Edit them and remove colors to 5 or fewer before Preview or Save. Saved colors have not been changed.',
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
  async function savePower(value: PowerConfig) {
    const previous = deviceStatus;
    if (!previous?.power) {
      throw new Error('Update controller firmware before configuring power.');
    }
    const next = status(
      await api().command('power.save', {
        baseRevision: previous.power.revision,
        power: value,
      }),
    );
    if (
      next.bootId !== previous.bootId ||
      !next.power?.ready ||
      next.power.revision <= previous.power.revision ||
      next.power.supplyWatts !== value.supplyWatts ||
      next.power.ledMilliWatts !== value.ledMilliWatts
    ) {
      throw new Error(
        'Power save is not confirmed. Refresh device status before retrying.',
      );
    }
    setDeviceStatus(next);
    setMessage(
      'Power settings saved. Protection is active; no restart needed.',
    );
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
    setPaletteColors([...palette.colors]);
    setColorPicker(null);
  }
  function keepPalette() {
    if (blocked || colorPicker) {
      return;
    }
    if (paletteColors.length > MAX_PALETTE_COLORS) {
      setMessage('Remove colors to 5 or fewer, then update the palette draft.');
      return;
    }
    const id = paletteId || `palette-${Date.now().toString(36)}`;
    const palette = {
      id,
      name: paletteName,
      colors: paletteColors,
    };
    const current = draft.customPalettes.filter(p => p.id !== id);
    const next = {
      ...draft,
      paletteId: id,
      customPalettes: [...current, palette],
    };
    if (!isConfig(next)) {
      setMessage(
        'Use 1-32 ASCII characters for a name, 1-5 colors, and at most 10 palettes.',
      );
      return;
    }
    setDraft(next);
    setPaletteId(null);
    setPaletteName('');
    setPaletteColors(['#ADD8E6']);
    setMessage(
      'Palette added to your draft. Preview or Save to send it to the ESP.',
    );
  }
  const blocked = busy || !connected || deviceStatus?.update.busy === true;
  const oversizedPalettes = draft.customPalettes.filter(
    p => p.colors.length > MAX_PALETTE_COLORS,
  );
  const paletteBlocked = blocked || colorPicker !== null;
  const hasEdits =
    draft &&
    state &&
    (JSON.stringify(draft) !== JSON.stringify(state.config) ||
      count !== String(state.config.ledCount));
  const estimateCount = Math.max(Number(count), state?.activeLedCount ?? 0);
  const lighting = (
    <View
      testID="lighting-controls"
      style={[styles.lighting, !connected && styles.disabled]}
    >
      <Card title="Lighting">
        <View style={styles.row}>
          <Text style={styles.text}>Lights on</Text>
          <Switch
            accessibilityLabel="Lights on"
            disabled={blocked}
            value={draft.on}
            onValueChange={on => setDraft({ ...draft, on })}
          />
        </View>
        <Text style={styles.text}>
          {!connected
            ? state
              ? 'Disconnected - last read values shown. Controls are disabled.'
              : 'Not connected - default values shown. Connect from Settings to load your lights.'
            : hasEdits
            ? 'Draft changes not applied'
            : state?.dirty
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
              onPress={() => setDraft({ ...draft, paletteId: p.id })}
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
              onPress={() => setDraft({ ...draft, effect })}
            />
          ))}
        </View>
        {(['brightness', 'speed', 'intensity', 'density'] as const).map(key => (
          <View key={key}>
            <Text style={styles.label}>
              {key}: {draft[key]}%
            </Text>
            <Slider
              accessibilityLabel={key}
              disabled={
                blocked || (key !== 'brightness' && draft.effect === 'steady')
              }
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={draft[key]}
              minimumTrackTintColor="#7dd3fc"
              maximumTrackTintColor="#475569"
              onValueChange={value =>
                setDraft(current => ({ ...current, [key]: Math.round(value) }))
              }
            />
          </View>
        ))}
        <Text style={styles.label}>LED count: {count}</Text>
        <Slider
          accessibilityLabel="LED count"
          disabled={blocked}
          minimumValue={25}
          maximumValue={1000}
          step={25}
          value={sliderCount(Number(count))}
          minimumTrackTintColor="#7dd3fc"
          maximumTrackTintColor="#475569"
          onValueChange={value => setCount(String(sliderCount(value)))}
        />
        {Number(count) % 25 !== 0 || Number(count) < 25 ? (
          <Text style={styles.text}>
            Existing count {count} is unchanged. Moving the slider selects
            25-LED increments.
          </Text>
        ) : null}
        <Text style={styles.text}>
          Active: {state?.activeLedCount ?? 'not read'}. Only LED-count changes
          need Save, then Restart. Other lighting settings do not need a
          restart.
        </Text>
        <PowerNotice
          profile={deviceStatus?.power}
          count={estimateCount}
          brightness={draft.brightness}
        />
        {oversizedPalettes.length > 0 && (
          <Text accessibilityRole="alert" style={styles.text}>
            {oversizedPalettes.map(p => p.name).join(', ')}: more than 5 colors.
            Saved colors have not been changed. Edit these palettes and remove
            colors to 5 or fewer, then update each palette draft before Preview
            or Save.
          </Text>
        )}
        <View style={styles.row}>
          <Button
            label="Preview"
            disabled={paletteBlocked || oversizedPalettes.length > 0}
            onPress={() => run(() => preview(false))}
          />
          <Button
            label="Save"
            disabled={paletteBlocked || oversizedPalettes.length > 0}
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
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reload', onPress: () => run(load) },
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
              disabled={paletteBlocked}
              onPress={() => editPalette(p)}
            />
            <Button
              label={`Delete ${p.name}`}
              disabled={paletteBlocked}
              onPress={() =>
                setDraft({
                  ...draft,
                  paletteId:
                    draft.paletteId === p.id ? 'halloween' : draft.paletteId,
                  customPalettes: draft.customPalettes.filter(
                    item => item.id !== p.id,
                  ),
                })
              }
            />
          </View>
        ))}
        <Text style={styles.text}>
          {draft.customPalettes.length}/10 palettes. Changes remain a draft
          until Preview or Save.
        </Text>
        <Input
          accessibilityLabel="Palette name"
          placeholder="Palette name"
          editable={!paletteBlocked}
          maxLength={32}
          value={paletteName}
          onChangeText={setPaletteName}
        />
        <Text style={styles.text}>
          {paletteColors.length}/{MAX_PALETTE_COLORS} colors. Tap a color to
          choose it. Keep at least one color.
        </Text>
        {paletteColors.length > MAX_PALETTE_COLORS && (
          <Text accessibilityRole="alert" style={styles.text}>
            All existing colors are shown. Remove colors to 5 or fewer to
            update this palette draft; nothing is removed automatically.
          </Text>
        )}
        {paletteColors.map((color, index) => (
          <View key={index} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit color ${index + 1}`}
              accessibilityValue={{ text: color }}
              accessibilityState={{
                disabled: paletteBlocked,
                selected: colorPicker?.index === index,
              }}
              disabled={paletteBlocked}
              onPress={() => {
                if (!paletteBlocked) setColorPicker({ index, color });
              }}
              style={[
                styles.button,
                styles.colorButton,
                colorPicker?.index === index && styles.selected,
                paletteBlocked && styles.disabled,
              ]}
            >
              <View style={[styles.swatch, { backgroundColor: color }]} />
              <Text style={styles.buttonText}>Color {index + 1}</Text>
            </Pressable>
            <Button
              label={`Remove color ${index + 1}`}
              disabled={paletteBlocked || paletteColors.length <= 1}
              onPress={() => {
                if (!paletteBlocked && paletteColors.length > 1) {
                  setPaletteColors(colors =>
                    colors.filter((_, i) => i !== index),
                  );
                }
              }}
            />
          </View>
        ))}
        <Button
          label="Add color"
          disabled={
            paletteBlocked || paletteColors.length >= MAX_PALETTE_COLORS
          }
          onPress={() => {
            if (!paletteBlocked && paletteColors.length < MAX_PALETTE_COLORS) {
              setColorPicker({
                index: paletteColors.length,
                color: '#ADD8E6',
              });
            }
          }}
        />
        <Button
          label={paletteId ? 'Update palette draft' : 'Add palette draft'}
          disabled={
            paletteBlocked || paletteColors.length > MAX_PALETTE_COLORS
          }
          onPress={keepPalette}
        />
      </Card>
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Pixies</Text>
          <Text style={styles.subtitle}>
            {connected || 'Your pixie lights'}
          </Text>
        </View>
        <Pressable
          testID="settings-menu-toggle"
          accessibilityRole="button"
          accessibilityLabel={
            updateAttention || !connected || connectionError
              ? 'Settings, attention needed'
              : 'Settings'
          }
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen(value => !value)}
          style={styles.menuToggle}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.menuDots}
          >
            {[0, 1, 2].map(dot => (
              <View key={dot} style={styles.menuDot} />
            ))}
          </View>
          {(updateAttention || !connected || connectionError) && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>!</Text>
            </View>
          )}
        </Pressable>
        {menuOpen && (
          <View
            testID="settings-dropdown"
            accessibilityRole="menu"
            style={styles.dropdown}
          >
            {(['Connection', 'Updates', 'Wi-Fi', 'Device'] as const).map(
              name => (
                <Button
                  key={name}
                  label={name === 'Device' ? 'Device settings' : name}
                  attention={
                    name === 'Connection'
                      ? !connected || connectionError
                      : name === 'Updates'
                      ? updateAttention
                      : undefined
                  }
                  onPress={() => {
                    setTab(name);
                    setMenuOpen(false);
                  }}
                />
              ),
            )}
          </View>
        )}
      </View>
      {menuOpen && (
        <Pressable
          accessibilityLabel="Dismiss settings menu"
          style={styles.menuDismiss}
          onPress={() => setMenuOpen(false)}
        />
      )}
      <View style={styles.body}>
        <ScrollView
          testID="lighting-home"
          accessibilityElementsHidden={tab !== 'Lights'}
          importantForAccessibility={
            tab === 'Lights' ? 'auto' : 'no-hide-descendants'
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
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
            ]}
          >
            {message ||
              (updating.current
                ? 'Updating. See Updates.'
                : connected
                ? 'Ready.'
                : 'Controls are disabled until pixies connects.')}
          </Text>
          {lighting}
        </ScrollView>
        <View
          testID="settings-panel"
          style={[styles.settingsPanel, tab === 'Lights' && styles.hidden]}
          accessibilityViewIsModal={tab !== 'Lights'}
          accessibilityElementsHidden={tab === 'Lights'}
          importantForAccessibility={
            tab === 'Lights' ? 'no-hide-descendants' : 'auto'
          }
          onAccessibilityEscape={() => setTab('Lights')}
        >
          <View style={styles.panelHeader}>
            <Text accessibilityRole="header" style={styles.title}>
              {tab === 'Device' ? 'Device settings' : tab}
            </Text>
            <Button label="Back to lights" onPress={() => setTab('Lights')} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {(tab === 'Wi-Fi' || tab === 'Device') && (
              <Text
                testID="settings-status"
                accessibilityRole={message ? 'alert' : undefined}
                accessibilityLiveRegion="polite"
                style={[
                  styles.notice,
                  !message && styles.invisible,
                  {
                    minHeight:
                      2 * styles.notice.padding +
                      3 * styles.notice.lineHeight * fontScale,
                  },
                ]}
              >
                {message || ' '}
              </Text>
            )}
            <UpdatePanel
              health={connected ? deviceStatus : null}
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
                  single nearby pixies is selected after scanning finishes.
                  Accept the phone's Bluetooth permission or pairing prompt if
                  shown.
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
            <>
              {tab === 'Wi-Fi' && (
                <Card title="Optional Wi-Fi">
                  <Text style={styles.text}>
                    Lighting and Bluetooth work without Wi-Fi. Joining your
                    local 2.4 GHz network enables the website; it does not
                    expose the ESP to the Internet.
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
                    Passwords are sent over encrypted Bluetooth and saved only
                    on the ESP after a successful connection.
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
                  <PowerSettings
                    key={`${deviceStatus?.bootId}:${deviceStatus?.power?.revision}`}
                    profile={deviceStatus?.power}
                    connected={!!connected}
                    disabled={blocked}
                    count={estimateCount}
                    brightness={draft.brightness}
                    onSave={value =>
                      run(() => savePower(value), 'Saving power settings...')
                    }
                  />
                  {deviceStatus && (
                    <Text style={styles.text}>
                      Firmware {deviceStatus.firmware.version}
                      {'\n'}
                      LEDs: {deviceStatus.led.ready
                        ? 'ready'
                        : 'unavailable'}{' '}
                      on GPIO{deviceStatus.led.gpio}
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
                                if (
                                  !record(result) ||
                                  result.restarting !== true
                                ) {
                                  throw new Error(
                                    'Restart was not acknowledged.',
                                  );
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
                        Not needed for this app. Set a website password only if
                        you want browser firmware uploads or web administration.
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
                              const result = await api().command(
                                'admin.claim',
                                {
                                  password: websitePassword,
                                },
                              );
                              if (
                                !record(result) ||
                                result.configured !== true
                              ) {
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
        </View>
      </View>
      {colorPicker && (
        <Modal transparent onRequestClose={() => setColorPicker(null)}>
          <View style={styles.pickerOverlay}>
            <SafeAreaView
              style={styles.pickerSheet}
              accessibilityViewIsModal
              onAccessibilityEscape={() => setColorPicker(null)}
            >
              <ScrollView contentContainerStyle={styles.card}>
                <Text accessibilityRole="header" style={styles.title}>
                  {colorPicker.index === paletteColors.length
                    ? 'Add color'
                    : `Edit color ${colorPicker.index + 1}`}
                </Text>
                <View
                  testID="color-picker-preview"
                  accessible
                  accessibilityLabel={`Selected color ${colorPicker.color}`}
                  style={[
                    styles.colorPreview,
                    { backgroundColor: colorPicker.color },
                  ]}
                />
                <Text style={styles.text}>{colorPicker.color}</Text>
                {(['Red', 'Green', 'Blue'] as const).map((channel, index) => {
                  const offset = 1 + index * 2;
                  const value = parseInt(
                    colorPicker.color.slice(offset, offset + 2),
                    16,
                  );
                  return (
                    <View key={channel}>
                      <Text style={styles.label}>
                        {channel}: {value}
                      </Text>
                      <Slider
                        accessibilityLabel={`${channel} channel`}
                        accessibilityValue={{ min: 0, max: 255, now: value }}
                        disabled={blocked}
                        minimumValue={0}
                        maximumValue={255}
                        step={1}
                        value={value}
                        minimumTrackTintColor={
                          ['#f87171', '#4ade80', '#60a5fa'][index]
                        }
                        maximumTrackTintColor="#475569"
                        style={styles.colorSlider}
                        onValueChange={next => {
                          if (blocked) return;
                          setColorPicker(current =>
                            current
                              ? {
                                  ...current,
                                  color:
                                    current.color.slice(0, offset) +
                                    Math.round(next)
                                      .toString(16)
                                      .padStart(2, '0')
                                      .toUpperCase() +
                                    current.color.slice(offset + 2),
                                }
                              : null,
                          );
                        }}
                      />
                    </View>
                  );
                })}
                <Text style={styles.text}>
                  Done changes only this palette editor. Update the palette
                  draft, then Preview or Save to send it to the ESP.
                </Text>
                <View style={styles.row}>
                  <Button
                    label="Done"
                    disabled={blocked}
                    onPress={() => {
                      if (blocked) return;
                      setPaletteColors(colors =>
                        colorPicker.index < colors.length
                          ? colors.map((color, index) =>
                              index === colorPicker.index
                                ? colorPicker.color
                                : color,
                            )
                          : colors.length < MAX_PALETTE_COLORS
                          ? [...colors, colorPicker.color]
                          : colors,
                      );
                      setColorPicker(null);
                    }}
                  />
                  <Button
                    label="Cancel"
                    onPress={() => setColorPicker(null)}
                  />
                </View>
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  body: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 3,
  },
  menuToggle: {
    minHeight: 48,
    minWidth: 48,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  menuDots: { gap: 4, padding: 4 },
  menuDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#bae6fd' },
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 20,
    minWidth: 210,
    padding: 12,
    gap: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 12,
    elevation: 12,
  },
  menuDismiss: { ...StyleSheet.absoluteFillObject, zIndex: 2 },
  settingsPanel: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b1220',
  },
  panelHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  lighting: { gap: 14 },
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
  colorButton: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
  colorPreview: {
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
  colorSlider: { height: 48 },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  pickerSheet: { maxHeight: '100%' },
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
