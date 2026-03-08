$path = 'G:\Hackathon IARE\data\water_data_clean.csv'
$rows = Import-Csv -Path $path

function Predict($r) {
  $ph=[double]$r.ph
  $t=[double]$r.turbidity
  $tds=[double]$r.tds
  $wl=[double]$r.waterLevel
  $fr=[double]$r.flowRate
  $ec=[double]$r.ecoliCount
  $chl=[double]$r.residualChlorine

  if (($ph -lt 6.5) -or ($ph -gt 8.5) -or ($t -gt 5) -or ($tds -gt 500) -or ($ec -gt 10) -or ($chl -lt 0.2)) {
    return 'contamination'
  }
  if ($wl -lt 20) { return 'shortage' }
  if ($fr -lt 1) { return 'leakage' }
  return 'safe'
}

$labels = @('safe','contamination','shortage','leakage')
$matrix = @{}
foreach ($a in $labels) { $matrix[$a] = @{}; foreach($p in $labels){ $matrix[$a][$p]=0 } }

$correct=0
foreach ($r in $rows) {
  $actual = ($r.label + '').Trim().ToLower()
  $pred = Predict $r
  if (-not $matrix.ContainsKey($actual)) { continue }
  $matrix[$actual][$pred] += 1
  if ($actual -eq $pred) { $correct += 1 }
}

$total = $rows.Count
$acc = [math]::Round((100.0*$correct/$total),2)

$out = @()
$out += '# AquaRakshak Dataset Results (Calibrated Rule Model)'
$out += ''
$out += '- Dataset: `data/water_data_clean.csv`'
$out += ('- Rows: {0}' -f $total)
$out += '- Model: calibrated deterministic rule set using pH, turbidity, TDS, residual chlorine, E.coli, water level, and flow rate'
$out += ('- Overall accuracy: **{0}%** ({1}/{2})' -f $acc,$correct,$total)
$out += ''
$out += '## Label Distribution'
foreach ($l in $labels) {
  $c = ($rows | Where-Object { ($_.label+'').Trim().ToLower() -eq $l }).Count
  $pct = [math]::Round((100.0*$c/$total),2)
  $out += ('- {0}: {1} ({2}%)' -f $l,$c,$pct)
}
$out += ''
$out += '## Confusion Matrix (Actual x Predicted)'
$out += '| Actual \\ Predicted | safe | contamination | shortage | leakage |'
$out += '|---|---:|---:|---:|---:|'
foreach ($a in $labels) {
  $out += ('| {0} | {1} | {2} | {3} | {4} |' -f $a,$matrix[$a]['safe'],$matrix[$a]['contamination'],$matrix[$a]['shortage'],$matrix[$a]['leakage'])
}

$report = 'G:\Hackathon IARE\analysis\results_summary.md'
$out -join "`n" | Set-Content -Path $report
Write-Output "REPORT=$report"
Write-Output "ACCURACY=$acc"
