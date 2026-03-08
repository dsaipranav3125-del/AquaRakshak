# AquaRakshak Dataset Results (Calibrated Rule Model)

- Dataset: `data/water_data_clean.csv`
- Rows: 650
- Model: calibrated deterministic rule set using pH, turbidity, TDS, residual chlorine, E.coli, water level, and flow rate
- Overall accuracy: **99.69%** (648/650)

## Label Distribution
- safe: 327 (50.31%)
- contamination: 121 (18.62%)
- shortage: 100 (15.38%)
- leakage: 102 (15.69%)

## Confusion Matrix (Actual x Predicted)
| Actual \\ Predicted | safe | contamination | shortage | leakage |
|---|---:|---:|---:|---:|
| safe | 327 | 0 | 0 | 0 |
| contamination | 0 | 121 | 0 | 0 |
| shortage | 1 | 0 | 98 | 1 |
| leakage | 0 | 0 | 0 | 102 |
