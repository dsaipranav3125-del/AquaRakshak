import json
from pathlib import Path

nb = {
  "cells": [
    {
      "cell_type": "markdown",
      "metadata": {},
      "source": [
        "# AquaRakshak Calibration and Accuracy\\n",
        "Use this notebook to calibrate risk thresholds and produce judge-ready accuracy metrics."
      ]
    },
    {
      "cell_type": "code",
      "execution_count": None,
      "metadata": {},
      "outputs": [],
      "source": [
        "import pandas as pd\\n",
        "import numpy as np\\n",
        "from sklearn.metrics import classification_report, confusion_matrix, precision_recall_fscore_support\\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": None,
      "metadata": {},
      "outputs": [],
      "source": [
        "# Replace with your actual file path\\n",
        "csv_path = 'your_dataset.csv'\\n",
        "df = pd.read_csv(csv_path)\\n",
        "df.head()"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": None,
      "metadata": {},
      "outputs": [],
      "source": [
        "# Expected columns: ph, turbidity, tds, waterLevel, flowRate, label\\n",
        "# label in {'contamination','leakage','shortage','safe'}\\n",
        "def score_row(r):\\n",
        "    ph = r['ph']; turb = r['turbidity']; tds = r['tds']; wl = r['waterLevel']; fr = r['flowRate']\\n",
        "    ph_s = 0 if 6.5 <= ph <= 8.5 else min(1, (6.5-ph)/3 if ph<6.5 else (ph-8.5)/3)\\n",
        "    turb_s = 0 if turb <= 5 else min(1, (turb-5)/20)\\n",
        "    tds_s = 0 if tds <= 500 else min(1, (tds-500)/1500)\\n",
        "    cont = min(1, 0.4*ph_s + 0.35*turb_s + 0.25*tds_s)\\n",
        "    short = 0 if wl >= 20 else min(1, (20-wl)/20)\\n",
        "    leak = 0 if fr >= 1 else min(1, (1-fr)/1)\\n",
        "    scores = {'contamination':cont, 'shortage':short, 'leakage':leak}\\n",
        "    top = max(scores, key=scores.get)\\n",
        "    if scores[top] < 0.62: return 'safe'\\n",
        "    return top\\n",
        "\\n",
        "df['predicted'] = df.apply(score_row, axis=1)\\n",
        "df[['label','predicted']].head()"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": None,
      "metadata": {},
      "outputs": [],
      "source": [
        "labels = sorted(df['label'].dropna().unique())\\n",
        "print('Labels:', labels)\\n",
        "print('\\nConfusion Matrix')\\n",
        "print(confusion_matrix(df['label'], df['predicted'], labels=labels))\\n",
        "print('\\nClassification Report')\\n",
        "print(classification_report(df['label'], df['predicted'], labels=labels, zero_division=0))"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": None,
      "metadata": {},
      "outputs": [],
      "source": [
        "# Compact judge-ready KPI table\\n",
        "p, r, f, s = precision_recall_fscore_support(df['label'], df['predicted'], labels=labels, zero_division=0)\\n",
        "kpi = pd.DataFrame({'label':labels, 'precision':p, 'recall':r, 'f1':f, 'support':s})\\n",
        "kpi"
      ]
    }
  ],
  "metadata": {
    "kernelspec": {
      "display_name": "Python 3",
      "language": "python",
      "name": "python3"
    },
    "language_info": {
      "name": "python",
      "version": "3"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 5
}

Path('analysis/calibration_and_accuracy.ipynb').write_text(json.dumps(nb, indent=2), encoding='utf-8')
print('Notebook created at analysis/calibration_and_accuracy.ipynb')
