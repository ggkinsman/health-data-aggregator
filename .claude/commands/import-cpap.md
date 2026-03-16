---
allowed-tools: Bash, Read
description: Import CPAP data from OSCAR, rebuild daily summaries, and show what's new
---

# CPAP Data Import

Import CPAP session data from OSCAR's backup STR.edf, then rebuild daily summaries so everything is up to date.

**Workflow:** Upload SD card to OSCAR first, then run this command. OSCAR is the single source of truth for CPAP data.

## Steps

Run these sequentially:

### 1. Check OSCAR data is available and fresh

```bash
ls -la ~/Documents/OSCAR_Data/Profiles/ggkinsman/ResMed_23252139106/Backup/STR.edf 2>/dev/null || echo "NOT_FOUND"
```

If the file is **NOT_FOUND** or the modification date is older than expected, stop and walk the user through updating OSCAR:

> I can't find fresh OSCAR data. Before I can import, you need to:
> 1. Insert your ResMed SD card
> 2. Open OSCAR
> 3. OSCAR should auto-detect the card and import — if not, use File → Import from SD card
> 4. Wait for import to finish, then run `/import-cpap` again

Do NOT proceed past this step if the file is missing.

### 2. Check what we have before importing

```bash
sqlite3 data/health.db "SELECT MAX(day) as last_night, COUNT(*) as total_nights FROM cpap_sessions;"
```

Save the `last_night` value — you'll use it in step 5 to show what's new.

### 3. Run the CPAP import

```bash
npx tsx scripts/import-cpap.ts
```

### 4. Rebuild daily summaries for the last 14 days

```bash
npx tsx scripts/build-summaries.ts --days 14
```

### 5. Show what's new

Query the new nights (everything after `last_night` from step 2) and present a summary table:

```bash
sqlite3 -header -column data/health.db "
  SELECT day,
         printf('%.1f', usage_minutes/60.0) as hours,
         printf('%.1f', ahi) as ahi,
         printf('%.1f', leak_95) as 'leak_95 L/min',
         printf('%.1f', mask_pressure_50) as 'pressure_50'
  FROM cpap_sessions
  WHERE day > '<last_night from step 1>'
  ORDER BY day;
"
```

If no new nights were added, let the user know ("No new nights found — OSCAR data may not have been updated since last import").

### 6. Quick summary

Tell the user:
- How many new nights were imported
- Date range of new data
- Any nights with AHI > 10 or leak_95 > 24 (ResMed's "large leak" threshold) — flag these as worth reviewing in OSCAR
