# QuantumCloud Offline Research Baseline Report

Generated: 2026-11-25T21:58:44.292Z | **Research Only — No Live Execution / No Auto-Promotion**

## 1. Verified Dataset Coverage & Integrity
| Series | Archives | Checksums OK | Units | Bars | First UTC | Last UTC | Gaps | Dupes |
|---|---:|---|---|---:|---|---|---:|---:|
| spot:BTCUSDT:1h | 60 | true | milliseconds,microseconds | 43810 | 2021-01-01T00:00:00.000Z | 2025-12-31T23:00:00.000Z | 7 | 0 |
| spot:ETHUSDT:1h | 60 | true | milliseconds,microseconds | 43810 | 2021-01-01T00:00:00.000Z | 2025-12-31T23:00:00.000Z | 7 | 0 |
| futures_um:BTCUSDT:1h | 60 | true | milliseconds | 43824 | 2021-01-01T00:00:00.000Z | 2025-12-31T23:00:00.000Z | 0 | 0 |
| futures_um:ETHUSDT:1h | 60 | true | milliseconds | 43824 | 2021-01-01T00:00:00.000Z | 2025-12-31T23:00:00.000Z | 0 | 0 |

## 2. Faithful Master Logic v1.5 vs Prototype Adapters
| Series | Adapter | Mode | Trades | Net % | Exp $ | PF | MaxDD % | Exp% | Turn | Fees $ | WF OOS Avg % |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| spot:BTCUSDT:1h | faithful_master_v15 | burst | 3420 | -100.00 | -2.92 | 0.16 | 100.00 | 11.60 | 12902.38 | 4780.93 | -52.20 |
| spot:BTCUSDT:1h | prototype_sma_range | burst | 6226 | -100.00 | -1.61 | 0.21 | 100.00 | 27.77 | 13755.91 | 4386.21 | n/a |
| spot:BTCUSDT:1h | faithful_master_v15 | scalper | 3724 | -100.00 | -2.69 | 0.04 | 100.00 | 8.01 | 24052.07 | 4875.75 | -75.00 |
| spot:BTCUSDT:1h | prototype_sma_range | scalper | 21409 | -100.00 | -0.47 | 0.16 | 100.00 | 56.25 | 86126.95 | 4787.14 | n/a |
| spot:BTCUSDT:1h | faithful_master_v15 | trend | 1706 | -93.82 | -5.50 | 0.57 | 94.17 | 20.99 | 2191.08 | 4669.66 | -8.13 |
| spot:BTCUSDT:1h | prototype_sma_range | trend | 18185 | -100.00 | -0.55 | 0.56 | 100.00 | 124.91 | 47499.83 | 6229.84 | n/a |
| spot:ETHUSDT:1h | faithful_master_v15 | burst | 3844 | -100.00 | -2.60 | 0.17 | 100.00 | 5.14 | 18107.94 | 4879.13 | -54.74 |
| spot:ETHUSDT:1h | prototype_sma_range | burst | 6416 | -100.00 | -1.56 | 0.22 | 100.00 | 14.16 | 14448.21 | 4422.12 | n/a |
| spot:ETHUSDT:1h | faithful_master_v15 | scalper | 3935 | -100.00 | -2.54 | 0.05 | 100.00 | 2.49 | 33826.94 | 5005.69 | -74.73 |
| spot:ETHUSDT:1h | prototype_sma_range | scalper | 26037 | -100.00 | -0.38 | 0.11 | 100.00 | 38.92 | 86975.06 | 4217.60 | n/a |
| spot:ETHUSDT:1h | faithful_master_v15 | trend | 2313 | -94.08 | -4.07 | 0.63 | 94.54 | 13.88 | 3134.54 | 5603.40 | -13.33 |
| spot:ETHUSDT:1h | prototype_sma_range | trend | 24156 | -100.00 | -0.41 | 0.58 | 100.00 | 102.41 | 48448.96 | 6540.26 | n/a |
| futures_um:BTCUSDT:1h | faithful_master_v15 | burst | 3417 | -100.00 | -2.93 | 0.17 | 100.00 | 10.83 | 10162.69 | 4899.65 | -54.50 |
| futures_um:BTCUSDT:1h | prototype_sma_range | burst | 5934 | -100.00 | -1.69 | 0.22 | 100.00 | 25.29 | 13250.88 | 4431.31 | n/a |
| futures_um:BTCUSDT:1h | faithful_master_v15 | scalper | 3691 | -100.00 | -2.71 | 0.04 | 100.00 | 6.34 | 18267.42 | 4875.35 | -75.56 |
| futures_um:BTCUSDT:1h | prototype_sma_range | scalper | 21374 | -100.00 | -0.47 | 0.15 | 100.00 | 53.65 | 85508.42 | 4658.16 | n/a |
| futures_um:BTCUSDT:1h | faithful_master_v15 | trend | 1721 | -85.86 | -4.99 | 0.69 | 86.52 | 19.61 | 1966.37 | 6130.18 | -8.30 |
| futures_um:BTCUSDT:1h | prototype_sma_range | trend | 18425 | -100.00 | -0.54 | 0.57 | 100.00 | 123.63 | 47760.95 | 6434.39 | n/a |
| futures_um:ETHUSDT:1h | faithful_master_v15 | burst | 3682 | -100.00 | -2.72 | 0.14 | 100.00 | 5.06 | 15688.47 | 4503.45 | -53.51 |
| futures_um:ETHUSDT:1h | prototype_sma_range | burst | 6107 | -100.00 | -1.64 | 0.20 | 100.00 | 11.99 | 13762.39 | 4312.04 | n/a |
| futures_um:ETHUSDT:1h | faithful_master_v15 | scalper | 3774 | -100.00 | -2.65 | 0.04 | 100.00 | 2.30 | 28699.54 | 4913.03 | -72.36 |
| futures_um:ETHUSDT:1h | prototype_sma_range | scalper | 26108 | -100.00 | -0.38 | 0.11 | 100.00 | 36.29 | 87266.83 | 4145.49 | n/a |
| futures_um:ETHUSDT:1h | faithful_master_v15 | trend | 2211 | -92.88 | -4.20 | 0.61 | 93.32 | 12.92 | 2866.06 | 5186.16 | -13.15 |
| futures_um:ETHUSDT:1h | prototype_sma_range | trend | 24611 | -100.00 | -0.41 | 0.56 | 100.00 | 99.89 | 48870.19 | 6245.95 | n/a |

## 3. Robustness Sensitivity (spot:BTCUSDT:1h — Faithful Trend)
| Scenario | Net % | MaxDD % | Trades | PF |
|---|---:|---:|---:|---:|
| baseline | -93.82 | 94.17 | 1706 | 0.57 |
| 2x_fees | -98.89 | 98.95 | 1706 | 0.42 |
| 2x_slippage | -96.47 | 96.66 | 1718 | 0.50 |
| 2x_spread | -95.00 | 95.28 | 1715 | 0.54 |
| latency_2bars | -92.34 | 92.76 | 1625 | 0.57 |
| optimistic_tp_first | -92.39 | 92.81 | 1706 | 0.62 |

## 4. Guarded Variant Experiment (spot:BTCUSDT:1h — 60/20/20 Train/Val/Test)
- Selected params (by validation only): `{"stopPct":2.5,"tpMultiplier":3}`
- Train: -21.47% | Validation: 13.90% | **Untouched Test**: -28.88% (maxDD 29.40%, 134 trades)
- Multiple testing: Evaluated 4 parameter sets on train/validation; test set untouched until final evaluation (Bonferroni alpha=0.0125).

## 5. Combined Equal-Weight Spot Faithful Portfolio
- Combined Net Return: -100.00% | Combined MaxDD: 100.00%
