# 0010. D02: 4th-order Butterworth filter instead of 2nd-order

## Context

The plan assumed a 0.5 Hz high-pass and a low-pass of 40 Hz for dogs and 60 Hz for cats on a 2nd-order, two-pass Butterworth filter. The acceptance criteria: residual drift no more than 0.02 mV (SIGNAL-02), R amplitude drops by no more than 3 % (SIGNAL-01).

## Decision

Task 06 showed that 2nd order fails, so a 4th-order Butterworth is used, also two-pass. The cutoff frequencies are unchanged.

## Why

- **2nd order** is rejected based on measurement: residual drift 0.057 mV against a tolerance of 0.02, R attenuation of 4–6 % against a tolerance of 3 %. 4th order gives a residual of 0.008 mV and R attenuation of 0.4–2.3 %; both criteria are met.
- **A single-pass filter** is still rejected: a single-pass IIR shifts peaks, which corrupts intervals. Two-pass filtering keeps zero phase delay.

## Consequences

- The SIGNAL-01 and SIGNAL-02 acceptance figures are achieved only with 4th order. Going back to 2nd order will fail them again.
- A fallback branch remains: if the filter is unstable at the given sampling rate, it is skipped with the note «фильтр отключён» ("filter disabled").
- With 4th order the R attenuation is up to 2.3 % against a 3 % tolerance. Any increase in order or shift of cutoff frequencies must be re-checked against this criterion.
