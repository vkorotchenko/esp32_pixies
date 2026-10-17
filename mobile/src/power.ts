import { Config, PowerConfig, PowerStatus } from './model';

export const DEFAULT_LIGHTS: Config = {
  ledCount: 200,
  on: true,
  brightness: 25,
  speed: 50,
  intensity: 50,
  density: 50,
  effect: 'twinkle',
  paletteId: 'builtin:light-blue',
  customPalettes: [],
};

export function sliderCount(value: number): number {
  return Math.max(25, Math.min(1000, Math.round(value / 25) * 25));
}
export function powerInputs(supply: string, led: string): PowerConfig {
  if (
    !/^\d{1,4}$/.test(supply) ||
    Number(supply) < 1 ||
    Number(supply) > 2000
  ) {
    throw new Error('Supply wattage must be a whole number from 1 to 2000 W.');
  }
  const text = led.replace(',', '.');
  if (!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(text)) {
    throw new Error(
      'LED power must be 0.01 to 10 W, with at most three decimal places.',
    );
  }
  const ledMilliWatts = Math.round(Number(text) * 1000);
  if (ledMilliWatts < 10 || ledMilliWatts > 10000) {
    throw new Error(
      'LED power must be 0.01 to 10 W per LED at full brightness.',
    );
  }
  return { supplyWatts: Number(supply), ledMilliWatts };
}
export function powerEstimate(
  count: number,
  brightness: number,
  profile: PowerStatus,
) {
  const standbyMilliWatts = count * profile.volts;
  const requestedMilliWatts =
    standbyMilliWatts +
    Math.ceil((count * profile.ledMilliWatts * brightness) / 100);
  const budgetMilliWatts = profile.budgetMa * profile.volts;
  return {
    requestedMilliWatts,
    budgetMilliWatts,
    exceedsBudget: requestedMilliWatts > budgetMilliWatts,
    exceedsSupply: requestedMilliWatts > profile.supplyWatts * 1000,
    standbyExceedsBudget: standbyMilliWatts > budgetMilliWatts,
  };
}
export function proposedPower(
  profile: PowerStatus,
  config: PowerConfig,
): PowerStatus {
  return {
    ...profile,
    ...config,
    ready: true,
    recovery: 'none',
    budgetMa: Math.min(
      profile.maximumMa,
      Math.floor(
        (config.supplyWatts * 1000 * (100 - profile.headroomPercent)) /
          (100 * profile.volts),
      ),
    ),
  };
}
