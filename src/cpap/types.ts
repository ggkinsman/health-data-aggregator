/**
 * One night of CPAP therapy summary data, parsed from ResMed STR.edf.
 * Sourced from the SD card; populated nightly by the machine.
 */
export interface CPAPSession {
  day: string;              // YYYY-MM-DD
  usage_minutes: number;
  ahi: number;
  oai: number;
  cai: number;
  hi: number;
  uai: number;
  rin: number;
  mask_pressure_50: number;
  mask_pressure_95: number;
  resp_rate_50: number;
  tidal_vol_50: number;
  min_vent_50: number;
  csr_minutes: number;
  mask_events: number;
}
