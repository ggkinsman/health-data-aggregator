# Health Data Aggregator Research

Research findings on Apple Health data export and Oura Ring API access.

## Table of Contents

1. [Apple Health Data Export](#apple-health-data-export)
2. [Oura Ring API](#oura-ring-api)
3. [Implementation Recommendations](#implementation-recommendations)

---

## Apple Health Data Export

### Architecture Overview

HealthKit is Apple's framework for health and fitness data, introduced in iOS 8. Key architectural constraints:

- **No Backend API**: Apple Health requires a native iOS app - there is no remote API access
- **On-Device Only**: All HealthKit data stays on the iPhone, accessible only through native apps with user permission
- **User Consent Required**: Explicit permission needed for each data type

### Data Export Methods

#### Method 1: Manual Export (Built-in)

Users can export their health data directly from the Health app:

1. Open Health app on iPhone
2. Tap profile icon (top-right)
3. Scroll to bottom → "Export All Health Data"
4. Confirm and wait for ZIP file generation

**Output Format**: ZIP file containing `export.xml`

#### Method 2: Programmatic Access via HealthKit

Requires a native iOS app with proper entitlements:

```swift
// Setup in Xcode:
// 1. Enable HealthKit capability in Signing & Capabilities
// 2. Add usage descriptions to Info.plist:
//    - NSHealthShareUsageDescription
//    - NSHealthUpdateUsageDescription
```

**Query Types**:

| Query Type | Use Case | Example |
|------------|----------|---------|
| `HKSampleQuery` | Raw samples with full metadata | Recent heart rate readings |
| `HKStatisticsQuery` | Single aggregated value | Total steps today |
| `HKStatisticsCollectionQuery` | Time-series breakdowns | Hourly step counts for charts |

**Data Type Categories**:
- **Cumulative**: Steps, calories burned (sum over time)
- **Discrete**: Heart rate, UV exposure (average, min, max)

#### Method 3: Third-Party Export Apps

Apps like "Apple Health Export" can:
- Configure automated exports to HTTP endpoints
- Export as JSON or CSV
- Schedule periodic syncs to REST APIs

### XML Export Format

The `export.xml` file structure:

```xml
<HealthData locale="en_US">
  <ExportDate value="2024-01-15 10:30:00 -0500"/>
  <Me HKCharacteristicTypeIdentifierBiologicalSex="..." />
  <Record type="HKQuantityTypeIdentifierHeartRate"
          sourceName="Apple Watch"
          unit="count/min"
          value="72"
          startDate="2024-01-15 08:00:00 -0500"
          endDate="2024-01-15 08:00:00 -0500"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" ... />
</HealthData>
```

**Parsing Considerations**:
- Files can be very large (1-2+ GB)
- Use streaming parser (`iterparse` in Python) for memory efficiency
- Workout routes stored as separate `.gpx` files

### Available Data Types

| Category | Types |
|----------|-------|
| Activity | Steps, distance, flights climbed, active energy |
| Heart | Heart rate, resting HR, HRV, walking HR average |
| Sleep | Sleep analysis (in bed, asleep, awake, REM, deep, core) |
| Body | Weight, height, BMI, body fat percentage |
| Vitals | Blood pressure, respiratory rate, oxygen saturation |
| Nutrition | Calories, macros, water intake |

### Privacy & App Store Requirements

- App Store review required for HealthKit apps
- Third-party apps cannot use health data for advertising/marketing
- Users can revoke access at any time
- Apps should provide clear data deletion options

### Python Libraries for Parsing

- [`apple-health-parser`](https://github.com/alxdrcirilo/apple-health-parser) - Parse, analyze, and plot HealthKit data
- [`apple-health-extractor`](https://pypi.org/project/apple-health-extractor/) - Extract data from XML exports

---

## Oura Ring API

### API Overview

- **Version**: API v2 (released January 2022, v1 deprecated January 2024)
- **Base URL**: `https://api.ouraring.com/v2/usercollection/`
- **Documentation**: https://cloud.ouraring.com/v2/docs

### Authentication

#### OAuth2 (Recommended)

OAuth2 is the recommended authentication method:

```
Authorization Flow:
1. generateAuthUrl(scopes, state) → User authorization URL
2. exchangeCodeForToken(code) → Access + refresh tokens
3. refreshAccessToken(refreshToken) → New access token
4. revokeAccessToken(accessToken) → Revoke access
```

#### Personal Access Tokens (Deprecated)

> **Warning**: Personal Access Tokens will be deprecated by end of 2025.

Usage (while still available):
```bash
# Header method
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.ouraring.com/v2/usercollection/daily_sleep"

# URL parameter method
curl "https://api.ouraring.com/v2/usercollection/daily_sleep?access_token=YOUR_TOKEN"
```

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/daily_readiness` | Daily readiness scores and contributors |
| `/daily_sleep` | Daily sleep scores and contributors |
| `/daily_activity` | Daily activity scores and metrics |
| `/sleep` | Detailed sleep session data |
| `/heart_rate` | Daytime heart rate measurements |
| `/workout` | Workout data and heart rate |
| `/session` | Session/meditation data |
| `/tag` | User-created tags |
| `/personal_info` | User profile information |

### Response Formats

**Daily Readiness**:
```json
{
  "data": [{
    "id": "...",
    "day": "2024-01-15",
    "score": 85,
    "temperature_deviation": 0.2,
    "contributors": {
      "activity_balance": 90,
      "body_temperature": 85,
      "hrv_balance": 80,
      "previous_day_activity": 88,
      "previous_night": 92,
      "recovery_index": 78,
      "resting_heart_rate": 82,
      "sleep_balance": 88
    }
  }]
}
```

**Daily Sleep**:
```json
{
  "data": [{
    "id": "...",
    "day": "2024-01-15",
    "score": 88,
    "contributors": {
      "deep_sleep": 90,
      "efficiency": 85,
      "latency": 92,
      "rem_sleep": 78,
      "restfulness": 88,
      "timing": 95,
      "total_sleep": 82
    }
  }]
}
```

**Sleep Session (Detailed)**:
```json
{
  "data": [{
    "id": "...",
    "day": "2024-01-15",
    "bedtime_start": "2024-01-14T23:30:00+00:00",
    "bedtime_end": "2024-01-15T07:15:00+00:00",
    "average_heart_rate": 52,
    "average_hrv": 45,
    "average_breath": 14.5,
    "deep_sleep_duration": 5400,
    "rem_sleep_duration": 6300,
    "light_sleep_duration": 10800,
    "awake_time": 1800,
    "efficiency": 92,
    "heart_rate": {
      "interval": 300,
      "items": [52, 51, 50, 49, ...],
      "timestamp": "2024-01-14T23:30:00+00:00"
    },
    "hrv": {
      "interval": 300,
      "items": [45, 48, 52, 44, ...],
      "timestamp": "2024-01-14T23:30:00+00:00"
    }
  }]
}
```

### Query Parameters

| Parameter | Format | Description |
|-----------|--------|-------------|
| `start_date` | YYYY-MM-DD | Earliest date for data (default: 1 day before end_date) |
| `end_date` | YYYY-MM-DD | Latest date for data (default: today) |

### Rate Limits

- **Limit**: 5,000 requests per 5-minute period
- **Error**: HTTP 429 when exceeded
- Contact Oura for higher limits if needed

### Important Restrictions

> **Membership Required**: Gen3 and Oura Ring 4 users without active Oura Membership cannot access their data through the API.

### Available Libraries

- **TypeScript/JavaScript**: [`@pinta365/oura-api`](https://jsr.io/@pinta365/oura-api)
- **Python**: [`oura-ring`](https://pypi.org/project/oura-ring/)

---

## Implementation Recommendations

### For Apple Health Data

1. **iOS Companion App Approach**:
   - Build minimal iOS app for HealthKit permissions and data sync
   - Sync to backend server via REST API
   - Provides real-time access to user health data

2. **Manual Export Approach**:
   - Accept user-uploaded `export.xml` files
   - Parse with streaming XML parser
   - Good for one-time analysis or periodic syncs

3. **Third-Party App Integration**:
   - Use apps like "Apple Health Export" for automated syncs
   - Configure webhook endpoints to receive data
   - Less development effort but adds dependency

### For Oura API

1. **Migrate to OAuth2 Now**:
   - Personal Access Tokens deprecated by end of 2025
   - Implement full OAuth2 flow with token refresh

2. **Use Webhooks for Real-Time Updates**:
   - Subscribe to webhooks for near real-time data
   - Reduces polling and API calls

3. **Sandbox Development**:
   - Use Oura's sandbox environment for testing
   - Sample data available without real ring

4. **Handle Membership Requirement**:
   - Check for API access errors related to membership
   - Inform users about Oura membership requirement

### Data Synchronization Strategy

```
┌─────────────────┐     ┌─────────────────┐
│   Apple Health  │     │    Oura Ring    │
│   (iOS Device)  │     │     (Cloud)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ HealthKit API         │ REST API v2
         │ (native app)          │ (OAuth2)
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│           Backend Server                │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ Apple Health│  │   Oura Data     │  │
│  │   Ingester  │  │   Ingester      │  │
│  └──────┬──────┘  └────────┬────────┘  │
│         │                  │           │
│         ▼                  ▼           │
│  ┌─────────────────────────────────┐   │
│  │     Unified Health Data Store   │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Common Data Mapping

| Metric | Apple Health Type | Oura Endpoint |
|--------|-------------------|---------------|
| Sleep Score | N/A (calculate from analysis) | `/daily_sleep` → `score` |
| Sleep Duration | `HKCategoryTypeIdentifierSleepAnalysis` | `/sleep` → durations |
| Heart Rate | `HKQuantityTypeIdentifierHeartRate` | `/heart_rate`, `/sleep` |
| HRV | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | `/sleep` → `hrv` |
| Steps | `HKQuantityTypeIdentifierStepCount` | `/daily_activity` |
| Active Calories | `HKQuantityTypeIdentifierActiveEnergyBurned` | `/daily_activity` |
| Resting HR | `HKQuantityTypeIdentifierRestingHeartRate` | `/daily_readiness` |

---

## Sources

### Apple Health / HealthKit
- [HealthKit | Apple Developer Documentation](https://developer.apple.com/documentation/healthkit)
- [Authorizing access to health data | Apple Developer](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Reading data from HealthKit | Apple Developer](https://developer.apple.com/documentation/healthkit/reading-data-from-healthkit)
- [How to Export Your Apple Health Data (2025 Full Guide)](https://applehealthdata.com/export-apple-health-data/)
- [What You Can (and Can't) Do With Apple HealthKit Data](https://www.themomentum.ai/blog/what-you-can-and-cant-do-with-apple-healthkit-data)
- [HealthKit Basics in Swift | Medium](https://medium.com/ibtech/healthkit-basics-in-swift-30ea6ce27a78)
- [Using Sleep Analysis in HealthKit with Swift | AppCoda](https://www.appcoda.com/sleep-analysis-healthkit/)
- [Parsing Apple Health Data | GitHub Gist](https://gist.github.com/hoffa/936db2bb85e134709cd263dd358ca309)
- [apple-health-parser | GitHub](https://github.com/alxdrcirilo/apple-health-parser)

### Oura Ring API
- [Oura API Documentation (2.0)](https://cloud.ouraring.com/v2/docs)
- [The Oura API | Oura Help](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API)
- [@pinta365/oura-api | JSR](https://jsr.io/@pinta365/oura-api)
- [oura-ring | PyPI](https://pypi.org/project/oura-ring/)
- [Oura API TypeScript Library | GitHub](https://github.com/Pinta365/oura_api)
- [oura-ring Python Tools | GitHub](https://github.com/hedgertronic/oura-ring)

---

*Last Updated: January 2026*
