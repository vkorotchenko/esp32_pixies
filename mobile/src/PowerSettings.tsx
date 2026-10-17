import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PowerConfig, PowerStatus } from './model';
import { powerEstimate, powerInputs, proposedPower } from './power';

export function PowerNotice({
  profile,
  count,
  brightness,
  testID = 'lighting-power-notice',
}: {
  profile?: PowerStatus;
  count: number;
  brightness: number;
  testID?: string;
}) {
  if (!profile) return null;
  const estimate = powerEstimate(count, brightness, profile);
  const warning = !profile.ready || estimate.exceedsBudget;
  return (
    <View testID={testID} style={[styles.notice, warning && styles.warning]}>
      <Text
        accessibilityRole={warning ? 'alert' : undefined}
        style={styles.text}
      >
        {!profile.ready
          ? 'LED output disabled: power settings could not be loaded. Verify and save them in Device settings.'
          : estimate.standbyExceedsBudget
          ? 'Warning: even the LED standby allowance exceeds the power budget. RGB output is off; software dimming cannot make this supply sufficient.'
          : `${
              estimate.exceedsSupply
                ? 'Warning: supply rating exceeded. '
                : estimate.exceedsBudget
                ? 'Warning: power budget exceeded. '
                : ''
            }Up to ${(estimate.requestedMilliWatts / 1000).toFixed(
              1,
            )} W at ${brightness}% brightness / ${(
              estimate.budgetMilliWatts / 1000
            ).toFixed(1)} W output budget. ${
              estimate.exceedsBudget
                ? 'Output is automatically limited when needed.'
                : ''
            }`}
      </Text>
    </View>
  );
}

export function PowerSettings({
  profile,
  connected,
  disabled,
  count,
  brightness,
  onSave,
}: {
  profile?: PowerStatus;
  connected: boolean;
  disabled: boolean;
  count: number;
  brightness: number;
  onSave(value: PowerConfig): void;
}) {
  const [supply, setSupply] = useState(
    profile ? String(profile.supplyWatts) : '',
  );
  const [led, setLed] = useState(
    profile ? String(profile.ledMilliWatts / 1000) : '',
  );
  let candidate: PowerConfig | null = null;
  let error = '';
  if (profile) {
    try {
      candidate = powerInputs(supply, led);
    } catch (problem) {
      error =
        problem instanceof Error
          ? problem.message
          : 'Power settings are invalid.';
    }
  }
  const blocked = disabled || !connected || !profile;
  return (
    <View style={styles.form}>
      <Text style={styles.title}>Power protection</Text>
      {!connected ? (
        <Text style={styles.text}>
          Connect to edit controller power settings.
        </Text>
      ) : !profile ? (
        <Text style={styles.text}>
          Update controller firmware to configure supply wattage and per-LED
          power. Its existing current limit remains active.
        </Text>
      ) : null}
      <Text style={styles.text}>
        The ESP automatically limits estimated output to 80% of the supply
        rating, while retaining its existing current ceiling. Settings are
        stored on this controller and apply without restarting.
      </Text>
      <Text style={styles.text}>Power supply rating (W)</Text>
      <TextInput
        accessibilityLabel="Power supply wattage"
        style={styles.input}
        keyboardType="number-pad"
        editable={!blocked}
        value={supply}
        maxLength={4}
        placeholder="60"
        placeholderTextColor="#94a3b8"
        onChangeText={setSupply}
      />
      <Text style={styles.text}>Power per LED at full brightness (W)</Text>
      <TextInput
        accessibilityLabel="Power per LED"
        style={styles.input}
        keyboardType="decimal-pad"
        editable={!blocked}
        value={led}
        maxLength={8}
        placeholder="0.3"
        placeholderTextColor="#94a3b8"
        onChangeText={setLed}
      />
      {error && connected ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {profile?.recovery === 'missing' ? (
        <Text style={styles.text}>
          Default power profile. Confirm your supply and LED ratings, then Save.
        </Text>
      ) : null}
      {profile && !profile.ready ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Power record unavailable ({profile.recovery}). Output stays disabled
          until valid settings are saved.
        </Text>
      ) : null}
      {profile && (
        <Text style={styles.text}>
          Active output budget:{' '}
          {((profile.budgetMa * profile.volts) / 1000).toFixed(1)} W. Controller
          ceiling: {profile.maximumMa / 1000} A at {profile.volts} V.
        </Text>
      )}
      {profile && candidate ? (
        <>
          <Text style={styles.text}>
            Estimate after saving these power settings:
          </Text>
          <PowerNotice
            testID="device-power-notice"
            profile={proposedPower(profile, candidate)}
            count={count}
            brightness={brightness}
          />
        </>
      ) : null}
      <Text style={styles.text}>
        Full-white estimates include 1 mA standby per physical LED and use the
        larger active/requested count until an LED-count restart. Effects can
        draw less. These are estimates, not a sensor or electrical cutoff; use
        correctly rated, fused wiring and power injection.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save power settings"
        accessibilityState={{ disabled: blocked || !candidate }}
        disabled={blocked || !candidate}
        style={[styles.button, (blocked || !candidate) && styles.disabled]}
        onPress={() => {
          if (candidate && !blocked) onSave(candidate);
        }}
      >
        <Text style={styles.buttonText}>Save power settings</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: 12, marginVertical: 8 },
  title: { color: '#f1f5f9', fontSize: 20, fontWeight: '600' },
  text: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  notice: { backgroundColor: '#164e63', padding: 12, borderRadius: 10 },
  warning: {
    backgroundColor: '#713f12',
    borderColor: '#fb923c',
    borderWidth: 1,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    padding: 12,
    color: '#f1f5f9',
    fontSize: 16,
  },
  button: {
    minHeight: 46,
    padding: 14,
    backgroundColor: '#334155',
    borderRadius: 10,
  },
  buttonText: { color: '#f8fafc', fontWeight: '600', textAlign: 'center' },
  error: { color: '#fdba74', fontSize: 15, lineHeight: 22 },
  disabled: { opacity: 0.4 },
});
