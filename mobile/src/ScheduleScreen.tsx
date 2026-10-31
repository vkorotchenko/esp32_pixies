import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { phoneTimezone } from './phoneTimezone';
import {
  defaultSchedule,
  isSchedule,
  minuteText,
  ScheduleResponse,
  ScheduleV1,
  sameSchedule,
  utcText,
  WEEKDAYS,
} from './schedule';

type Props = {
  connected: boolean;
  supported: boolean;
  disabled: boolean;
  response: ScheduleResponse | null;
  error: string;
  onSave(
    value: ScheduleV1,
    base: Pick<ScheduleResponse, 'bootId' | 'revision'>,
  ): Promise<ScheduleResponse | undefined> | undefined;
  onRefresh(): void;
  onSync(): void;
  onResume(): void;
  onUpdates(): void;
};
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
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}
export function ScheduleScreen(props: Props) {
  const { response, connected, supported, disabled } = props;
  const [draft, setDraft] = useState(defaultSchedule);
  const [base, setBase] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<{
    day: number;
    field: 'onMinute' | 'offMinute';
    minute: number;
  } | null>(null);
  const mounted = useRef(false);
  const hasEdits = !!base && (!sameSchedule(draft, base.schedule) || !!picker);
  const conflict =
    !!base &&
    !!response &&
    (base.bootId !== response.bootId || base.revision !== response.revision);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (connected && response && !hasEdits && response !== base) {
      setBase(response);
      setDraft(response.schedule);
      setError('');
    }
  }, [response, connected, hasEdits, base]);
  const blocked = disabled || !connected || !supported || !response;
  const runtime = response?.runtime;
  return (
    <ScrollView contentContainerStyle={styles.content} testID="schedule-screen">
      <Text accessibilityRole="header" style={styles.heading}>
        Weekly schedule
      </Text>
      {!supported && (
        <>
          <Text style={styles.text}>Controller firmware update required</Text>
          <Action label="Open Updates" onPress={props.onUpdates} />
        </>
      )}
      {!connected && (
        <Text style={styles.text}>
          Connect to read or save your controller schedule.
        </Text>
      )}
      {!!(error || props.error) && (
        <Text accessibilityRole="alert" style={styles.warning}>
          {error || props.error}
        </Text>
      )}
      {conflict && (
        <Text accessibilityRole="alert" style={styles.warning}>
          Schedule changed on the controller or the controller restarted. Your
          draft and its original save revision are kept. Discard the draft and
          load the saved schedule before saving again.
        </Text>
      )}
      {(hasEdits || conflict) && (
        <Action
          label="Discard draft and load saved schedule"
          disabled={blocked}
          onPress={() => {
            if (blocked || !response) return;
            setBase(response);
            setDraft(response.schedule);
            setPicker(null);
            setError('');
          }}
        />
      )}
      {runtime && (
        <>
          <Text style={styles.text}>
            Controller clock: {utcText(runtime.clock.utcSeconds)} (
            {runtime.clock.source}, sync age{' '}
            {runtime.clock.syncAgeSeconds ?? 'unknown'} seconds)
          </Text>
          <Text style={styles.text}>
            Saved timezone: {runtime.timezoneId ?? 'Not set'}
          </Text>
          <Text style={styles.text}>
            Rule expiry: {utcText(runtime.ruleExpiryUtc)}
          </Text>
          <Text style={styles.text}>
            Effective output: {runtime.effectiveOn ? 'ON' : 'OFF'}
          </Text>
          <Text style={styles.text}>
            Automation: {runtime.enabled ? 'enabled' : 'disabled'};{' '}
            {runtime.pauseReason === 'none' ? 'ready' : runtime.pauseReason}
          </Text>
          <Text style={styles.text}>
            {runtime.overrideActive
              ? `Manual override ${runtime.overrideOn ? 'ON' : 'OFF'}: ${
                  !runtime.clock.synced
                    ? 'awaiting clock sync, then the next effective boundary'
                    : runtime.overrideUntilUtc === null
                    ? 'until Resume schedule, schedule Save or reboot (no future boundary)'
                    : `until ${utcText(runtime.overrideUntilUtc)}`
                }`
              : `Next effective boundary: ${utcText(runtime.nextBoundaryUtc)}`}
          </Text>
        </>
      )}
      <View style={styles.row}>
        <Text style={styles.text}>Enable weekly schedule</Text>
        <Switch
          accessibilityLabel="Enable weekly schedule"
          value={draft.enabled}
          disabled={blocked}
          onValueChange={enabled => setDraft({ ...draft, enabled })}
        />
      </View>
      <Text style={styles.text}>
        Draft timezone: {draft.timezone?.id ?? 'Choose your phone timezone'};
        expires {utcText(draft.timezone?.untilUtc ?? null)}
      </Text>
      <Action
        label="Use phone timezone"
        disabled={blocked}
        onPress={() => {
          if (blocked) return;
          try {
            setDraft({ ...draft, timezone: phoneTimezone() });
            setError('');
          } catch (e) {
            setError(
              e instanceof Error ? e.message : 'Timezone setup unavailable.',
            );
          }
        }}
      />
      {WEEKDAYS.map((day, index) => (
        <View key={day} testID={`schedule-${day}`} style={styles.day}>
          <View style={styles.row}>
            <Text style={styles.heading}>{day}</Text>
            <Switch
              accessibilityLabel={`${day} enabled`}
              value={draft.days[index].enabled}
              disabled={blocked}
              onValueChange={enabled =>
                setDraft({
                  ...draft,
                  days: draft.days.map((d, i) =>
                    i === index ? { ...d, enabled } : d,
                  ),
                })
              }
            />
          </View>
          <View style={styles.row}>
            {(['onMinute', 'offMinute'] as const).map(field => (
              <Action
                key={field}
                label={`${day} ${
                  field === 'onMinute' ? 'ON' : 'OFF'
                } ${minuteText(draft.days[index][field])}`}
                disabled={blocked}
                onPress={() => {
                  if (!blocked)
                    setPicker({
                      day: index,
                      field,
                      minute: draft.days[index][field],
                    });
                }}
              />
            ))}
          </View>
          {draft.days[index].offMinute < draft.days[index].onMinute && (
            <Text style={styles.text}>OFF is the following day.</Text>
          )}
        </View>
      ))}
      <Text style={styles.text}>
        Edits stay on this phone until Save schedule. Disabled days start no
        window; the previous night's window may continue. Equal ON/OFF times are
        invalid. Save also clears a manual override.
      </Text>
      <Text style={styles.text}>
        After a cold boot automation stays OFF until phone or Wi-Fi time sync.
        Powered controllers keep time offline. Expired rules pause automation;
        use phone timezone and Save to refresh. Refresh after timezone-law
        changes.
      </Text>
      <Action
        label="Save schedule"
        disabled={blocked || conflict}
        onPress={async () => {
          if (blocked || conflict || !base) return;
          if (!isSchedule(draft)) {
            setError(
              'Choose a timezone and different ON/OFF times for every enabled day.',
            );
            return;
          }
          setError('');
          const saved = await props.onSave(draft, {
            bootId: base.bootId,
            revision: base.revision,
          });
          if (mounted.current && saved) {
            setBase(saved);
            setDraft(current =>
              sameSchedule(current, draft) ? saved.schedule : current,
            );
          }
        }}
      />
      <Action
        label="Reload schedule"
        disabled={disabled || !connected || !supported}
        onPress={props.onRefresh}
      />
      <Action
        label="Sync phone clock"
        disabled={blocked}
        onPress={props.onSync}
      />
      <Action
        label="Resume schedule"
        disabled={blocked || !runtime?.overrideActive}
        onPress={props.onResume}
      />
      {picker && (
        <Modal
          visible
          transparent
          onRequestClose={() => setPicker(null)}
          accessibilityViewIsModal
        >
          {picker && (
            <View style={styles.backdrop}>
              <View style={styles.dialog}>
                <Text style={styles.heading}>
                  {WEEKDAYS[picker.day]}{' '}
                  {picker.field === 'onMinute' ? 'ON' : 'OFF'}{' '}
                  {minuteText(picker.minute)}
                </Text>
                <Text style={styles.text}>Hour</Text>
                <Slider
                  accessibilityLabel="Schedule hour"
                  minimumValue={0}
                  maximumValue={23}
                  step={1}
                  value={Math.floor(picker.minute / 60)}
                  onValueChange={hour =>
                    setPicker({
                      ...picker,
                      minute: Math.round(hour) * 60 + (picker.minute % 60),
                    })
                  }
                />
                <Text style={styles.text}>Minute</Text>
                <Slider
                  accessibilityLabel="Schedule minute"
                  minimumValue={0}
                  maximumValue={59}
                  step={1}
                  value={picker.minute % 60}
                  onValueChange={minute =>
                    setPicker({
                      ...picker,
                      minute:
                        Math.floor(picker.minute / 60) * 60 +
                        Math.round(minute),
                    })
                  }
                />
                <Action
                  label="Done"
                  disabled={blocked}
                  onPress={() => {
                    if (!blocked) {
                      setDraft({
                        ...draft,
                        days: draft.days.map((d, i) =>
                          i === picker.day
                            ? { ...d, [picker.field]: picker.minute }
                            : d,
                        ),
                      });
                      setPicker(null);
                    }
                  }}
                />
                <Action label="Cancel" onPress={() => setPicker(null)} />
              </View>
            </View>
          )}
        </Modal>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 18, gap: 12, backgroundColor: '#0f172a' },
  text: { color: '#e2e8f0', fontSize: 16 },
  heading: { color: '#f8fafc', fontSize: 20, fontWeight: '600' },
  warning: { color: '#fbbf24', fontSize: 16 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  day: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  button: { backgroundColor: '#334155', padding: 12, borderRadius: 8 },
  disabled: { opacity: 0.45 },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#000a',
  },
  dialog: {
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 12,
    gap: 12,
  },
});
