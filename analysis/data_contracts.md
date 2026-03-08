# Data Contracts

## SensorReading
- `sourceId` string
- `location` object: `{ village, district? }`
- `timestamp` datetime
- `ph` number
- `turbidity` number
- `tds` number
- `waterLevel` number
- `flowRate` number
- `risk` object: `{ topRiskType, topScore, shouldAlert, components }`

## RiskAlert
- `alertId` uuid
- `riskType` enum: `contamination|leakage|shortage`
- `score` number (0 to 1)
- `status` enum: `open|assigned|resolved`
- `linkedReadingId` string
- `location` object

## CommunityReport
- `reportId` uuid
- `category` string
- `description` string
- `severity` enum: `low|medium|high`
- `status` enum: `open|assigned|resolved`
- `reporterId` string
- `location` object

## WorkOrder
- `workOrderId` uuid
- `reportOrAlertId` string
- `issueType` enum: `alert|report`
- `assignee` string
- `eta` string
- `status` enum
- `resolutionNote` string
