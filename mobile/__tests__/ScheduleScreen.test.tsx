import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import { ScheduleScreen } from '../src/ScheduleScreen';
import { scheduleFixture } from '../testFixtures/schedule';
import { WEEKDAYS } from '../src/schedule';
import { phoneTimezone } from '../src/phoneTimezone';
jest.mock('@react-native-community/slider', () => 'Slider');
jest.mock('../src/phoneTimezone', () => ({ phoneTimezone: jest.fn() }));
let rendered: ReactTestRenderer;
afterEach(() => {
  act(() => rendered?.unmount());
  jest.clearAllMocks();
});
function fixture() {
  const props = {
    connected: true,
    supported: true,
    disabled: false,
    response: scheduleFixture(),
    error: '',
    onSave: jest.fn(),
    onRefresh: jest.fn(),
    onSync: jest.fn(),
    onResume: jest.fn(),
    onUpdates: jest.fn(),
  };
  act(() => {
    rendered = TestRenderer.create(<ScheduleScreen {...props} />);
  });
  return props;
}
function press(label: string) {
  let action: Promise<void> | undefined;
  act(() => {
    action = rendered.root
      .findByProps({ accessibilityLabel: label })
      .props.onPress();
  });
  return action;
}
test('seven weekday rows, integer modal Done/Cancel and switches stay local until Save', () => {
  const p = fixture();
  for (const day of WEEKDAYS)
    expect(
      rendered.root.findByProps({ testID: `schedule-${day}` }),
    ).toBeDefined();
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Enable weekly schedule' })
      .props.onValueChange(true),
  );
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Monday enabled' })
      .props.onValueChange(true),
  );
  press('Monday ON 18:00');
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Schedule hour' })
      .props.onValueChange(19),
  );
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Schedule minute' })
      .props.onValueChange(30),
  );
  press('Cancel');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday ON 18:00' }),
  ).toBeDefined();
  press('Monday ON 18:00');
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Schedule hour' })
      .props.onValueChange(19),
  );
  press('Done');
  expect(p.onSave).not.toHaveBeenCalled();
  press('Save schedule');
  expect(p.onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      enabled: true,
      days: expect.arrayContaining([
        expect.objectContaining({ enabled: true, onMinute: 1140 }),
      ]),
    }),
    { bootId: p.response.bootId, revision: p.response.revision },
  );
});
test('a remote revision preserves the draft and original save base until explicit discard, while runtime stays fresh', () => {
  const p = fixture();
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Monday enabled' })
      .props.onValueChange(true),
  );
  const saveDraft = rendered.root.findByProps({
    accessibilityLabel: 'Save schedule',
  }).props.onPress;
  const response = {
    ...p.response,
    revision: p.response.revision + 1,
    schedule: {
      ...p.response.schedule,
      days: p.response.schedule.days.map((d, i) =>
        i === 1 ? { ...d, enabled: true } : d,
      ),
    },
    runtime: {
      ...p.response.runtime,
      effectiveOn: false,
      clock: { ...p.response.runtime.clock, syncAgeSeconds: 30 },
    },
  };
  act(() => rendered.update(<ScheduleScreen {...p} response={response} />));
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday enabled' }).props
      .value,
  ).toBe(true);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Tuesday enabled' }).props
      .value,
  ).toBe(false);
  const text = rendered.root
    .findAllByType(Text)
    .map(node => React.Children.toArray(node.props.children).join(''));
  expect(text).toContain('Effective output: OFF');
  expect(text).toContainEqual(expect.stringContaining('sync age 30 seconds'));
  expect(JSON.stringify(rendered.toJSON())).toContain('Schedule changed');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Save schedule' }).props
      .disabled,
  ).toBe(true);
  press('Save schedule');
  expect(p.onSave).not.toHaveBeenCalled();
  press('Reload schedule');
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday enabled' }).props
      .value,
  ).toBe(true);
  act(() => {
    saveDraft();
  });
  expect(p.onSave.mock.calls[0][1]).toEqual({
    bootId: p.response.bootId,
    revision: p.response.revision,
  });
  press('Discard draft and load saved schedule');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday enabled' }).props
      .value,
  ).toBe(false);
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Tuesday enabled' }).props
      .value,
  ).toBe(true);
  press('Save schedule');
  expect(p.onSave.mock.calls.at(-1)?.[1]).toEqual({
    bootId: response.bootId,
    revision: response.revision,
  });
});
test('disconnect and reboot preserve an unfinished time picker and draft instead of silently rebasing', () => {
  const p = fixture();
  press('Monday ON 18:00');
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Schedule hour' })
      .props.onValueChange(19),
  );
  act(() =>
    rendered.update(
      <ScheduleScreen {...p} connected={false} response={null} />,
    ),
  );
  act(() => rendered.update(<ScheduleScreen {...p} />));
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Schedule hour' }).props
      .value,
  ).toBe(19);
  const response = { ...p.response, bootId: 'fedcba9876543210' };
  act(() => rendered.update(<ScheduleScreen {...p} response={response} />));
  expect(JSON.stringify(rendered.toJSON())).toContain('Schedule changed');
  press('Done');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday ON 19:00' }),
  ).toBeDefined();
  press('Save schedule');
  expect(p.onSave).not.toHaveBeenCalled();
  press('Discard draft and load saved schedule');
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday ON 18:00' }),
  ).toBeDefined();
});
test('pristine editors follow saved revisions and an own successful Save acknowledgement settles the draft', async () => {
  const p = fixture();
  const response = { ...p.response, revision: p.response.revision + 1 };
  act(() => rendered.update(<ScheduleScreen {...p} response={response} />));
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Monday enabled' })
      .props.onValueChange(true),
  );
  const saved = {
    ...response,
    revision: response.revision + 1,
    schedule: {
      ...response.schedule,
      days: response.schedule.days.map((d, i) =>
        i === 0 ? { ...d, enabled: true } : d,
      ),
    },
  };
  p.onSave.mockImplementation(async () => {
    rendered.update(<ScheduleScreen {...p} response={saved} />);
    return saved;
  });
  await act(async () => press('Save schedule'));
  expect(p.onSave.mock.calls[0][1]).toEqual({
    bootId: response.bootId,
    revision: response.revision,
  });
  expect(JSON.stringify(rendered.toJSON())).not.toContain('Schedule changed');
  const remote = {
    ...saved,
    revision: saved.revision + 1,
    schedule: {
      ...saved.schedule,
      days: saved.schedule.days.map((d, i) =>
        i === 0 ? { ...d, enabled: false } : d,
      ),
    },
  };
  act(() => rendered.update(<ScheduleScreen {...p} response={remote} />));
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday enabled' }).props
      .value,
  ).toBe(false);
});
test('runtime refresh and phone travel preserve local edits and saved zone until explicit change', () => {
  const p = fixture();
  act(() =>
    rendered.root
      .findByProps({ accessibilityLabel: 'Monday enabled' })
      .props.onValueChange(true),
  );
  act(() =>
    rendered.update(
      <ScheduleScreen
        {...p}
        response={{
          ...p.response,
          runtime: { ...p.response.runtime, effectiveOn: false },
        }}
      />,
    ),
  );
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Monday enabled' }).props
      .value,
  ).toBe(true);
  expect(phoneTimezone).not.toHaveBeenCalled();
  jest.mocked(phoneTimezone).mockImplementation(() => {
    throw new Error('Timezone export unavailable');
  });
  press('Use phone timezone');
  expect(
    rendered.root.findByProps({ accessibilityRole: 'alert' }).props.children,
  ).toBe('Timezone export unavailable');
  press('Save schedule');
  expect(p.onSave.mock.calls[0][0].timezone.id).toBe('Etc/UTC');
});
test('unsynced override expiry is unknown, not falsely reported as no future boundary', () => {
  const p = fixture();
  const response = {
    ...p.response,
    runtime: {
      ...p.response.runtime,
      overrideActive: true,
      overrideOn: true,
      clock: {
        synced: false,
        utcSeconds: null,
        syncAgeSeconds: null,
        source: 'none',
      },
    },
  };
  act(() => rendered.update(<ScheduleScreen {...p} response={response} />));
  const content = JSON.stringify(rendered.toJSON());
  expect(content).toContain('awaiting clock sync');
  expect(content).not.toContain('no future boundary');
});
test('unsupported and offline controllers cannot send edits and route users to Updates', () => {
  const p = fixture();
  act(() =>
    rendered.update(
      <ScheduleScreen {...p} supported={false} connected={false} />,
    ),
  );
  expect(
    rendered.root.findByProps({ accessibilityLabel: 'Save schedule' }).props
      .disabled,
  ).toBe(true);
  press('Save schedule');
  expect(p.onSave).not.toHaveBeenCalled();
  press('Open Updates');
  expect(p.onUpdates).toHaveBeenCalledTimes(1);
  expect(rendered.root.findAllByType(Modal)).toHaveLength(0);
});
