export * from './types';
export { PRESETS, getPreset, listPresets } from './presets';
export { runBacktest } from './run-backtest';
export type { BacktestResult, BacktestTrade } from './run-backtest';
export {
  ZERO_COSTS,
  CRYPTO_PERP_COSTS,
  FX_COSTS,
  METALS_COSTS,
  FIXED_LEGACY_GEOMETRY,
  LIVE_GEOMETRY,
  costModelFor,
} from './backtest-options';
export type { BacktestOptions, CostModel, Geometry } from './backtest-options';
