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

/**
 * A CPAP device settings period — captures when pressure ranges
 * or modes were changed. Sourced from OSCAR's "Changes to Device Settings" report.
 */
export interface CPAPDeviceSettings {
  start_date: string;       // YYYY-MM-DD — first night with these settings
  end_date: string;         // YYYY-MM-DD — last night with these settings
  days: number;
  device: string;           // e.g. "AirSense 11 AutoSet"
  serial: string;
  mode: string;             // e.g. "APAP"
  pressure_min: number;     // cmH2O
  pressure_max: number;     // cmH2O
  epr: string;              // e.g. "Off", "1", "2", "3"
}
