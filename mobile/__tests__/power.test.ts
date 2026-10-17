import {
  powerInputs,
  powerEstimate,
  proposedPower,
  sliderCount,
} from '../src/power';
import { status } from '../src/model';
import { healthFixture, powerFixture } from '../testFixtures/releases';

test('accepts legacy status but rejects partial or inconsistent power profiles', () => {
  expect(status(healthFixture()).power).toBeUndefined();
  expect(status({ ...healthFixture(), power: powerFixture() }).power).toEqual(
    powerFixture(),
  );
  for (const power of [
    null,
    {},
    { ...powerFixture(), supplyWatts: true },
    { ...powerFixture(), budgetMa: 12000 },
    { ...powerFixture(), ready: false },
    { ...powerFixture(), recovery: 'invalid_record' },
    { ...powerFixture(), ledMilliWatts: 0 },
    { ...powerFixture(), volts: 12 },
    { ...powerFixture(), revision: 0 },
    { ...powerFixture(), headroomPercent: 100 },
  ]) {
    expect(() => status({ ...healthFixture(), power })).toThrow();
  }
  expect(
    status({
      ...healthFixture(),
      power: {
        ...powerFixture(),
        ready: false,
        recovery: 'invalid_record',
        budgetMa: 0,
      },
    }).power?.ready,
  ).toBe(false);
});
test('power text parsing is exact, bounded and accepts a decimal comma', () => {
  expect(powerInputs('60', '0.3')).toEqual({
    supplyWatts: 60,
    ledMilliWatts: 300,
  });
  expect(powerInputs('2000', '10')).toEqual({
    supplyWatts: 2000,
    ledMilliWatts: 10000,
  });
  expect(powerInputs('1', '0,01')).toEqual({
    supplyWatts: 1,
    ledMilliWatts: 10,
  });
  expect(powerInputs('20', '.301').ledMilliWatts).toBe(301);
  for (const supply of ['', '0', '2001', '-1', '1.5', '1e2', '60 W']) {
    expect(() => powerInputs(supply, '0.3')).toThrow();
  }
  for (const led of [
    '',
    '0',
    '0.009',
    '10.001',
    '0.3001',
    '-1',
    'NaN',
    'Infinity',
    '1e-1',
    '0,3.0',
    '0.3 W',
  ]) {
    expect(() => powerInputs('60', led)).toThrow();
  }
});
test('full-white warnings match the 80% budget and retain the compiled current ceiling', () => {
  const profile = proposedPower(powerFixture(), {
    supplyWatts: 20,
    ledMilliWatts: 300,
  });
  expect(profile.budgetMa).toBe(3200);
  expect(powerEstimate(200, 25, profile)).toMatchObject({
    requestedMilliWatts: 16000,
    budgetMilliWatts: 16000,
    exceedsBudget: false,
  });
  expect(powerEstimate(200, 26, profile).exceedsBudget).toBe(true);
  expect(powerEstimate(200, 100, profile).exceedsSupply).toBe(true);
  expect(powerEstimate(200, 100, powerFixture()).budgetMilliWatts).toBe(45000);
  expect(powerEstimate(200, 100, powerFixture()).requestedMilliWatts).toBe(
    61000,
  );
  expect(
    powerEstimate(200, 100, { ...profile, ledMilliWatts: 600 })
      .requestedMilliWatts,
  ).toBe(121000);
});
test('warns when even standby cannot fit and estimates an off/zero-brightness string conservatively', () => {
  const tiny = proposedPower(powerFixture(), {
    supplyWatts: 1,
    ledMilliWatts: 300,
  });
  expect(powerEstimate(1000, 0, tiny)).toMatchObject({
    requestedMilliWatts: 5000,
    standbyExceedsBudget: true,
    exceedsBudget: true,
  });
  expect(powerEstimate(160, 0, tiny).standbyExceedsBudget).toBe(false);
  expect(powerEstimate(161, 0, tiny).standbyExceedsBudget).toBe(true);
});
test('count slider clamps and quantizes explicit user movements only', () => {
  expect(sliderCount(1)).toBe(25);
  expect(sliderCount(38)).toBe(50);
  expect(sliderCount(333)).toBe(325);
  expect(sliderCount(1100)).toBe(1000);
  for (let count = 25; count <= 1000; count += 25)
    expect(sliderCount(count)).toBe(count);
});
