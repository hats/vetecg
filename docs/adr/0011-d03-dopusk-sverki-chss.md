# 0011. D03: the tolerance for checking against printed HR depends on sheet resolution

## Context

The plan assumed a ±3 bpm tolerance when comparing the found intervals with the HR values printed by the device above the beats. The plan refined the beat time from lead II. The rule matching digits to intervals was supposed to live in the format profile.

## Decision

Task 06 proved something else in code.

- **The tolerance** equals max(3 bpm, 2 columns · ∂HR/∂px).
- **The beat time** `Beat.tMs` is the consensus of apexes across reliable leads.
- **HR and RR for measurements** (MEAS-01) are taken from `perLead.II.tMs` when II is reliable. Otherwise the consensus is used, with the note «по всем отведениям» ("across all leads").

## Why

- **±3 bpm** is rejected as unattainable at this resolution. At 1280 px and HR 360, one column is worth about 10 bpm. On `17-56-08` post-ectopic beats differ from the device by 1.4–1.8 px.
- **Beat time from II only** is rejected: the apex consensus is 0.7 px more accurate than II alone.
- **Consensus for all measurements** is rejected: the requirement to measure from lead II remains. The consensus is used only as a fallback when II is unreliable.

## Consequences

- At high HR, i.e. precisely in cats, the self-check against printed digits becomes looser. It will let a discrepancy of a couple of pixels through.
- One beat carries two times: `tMs` for detection and self-check, and `perLead.II.tMs` for measurements. They must not be confused.
- The rule matching digits to intervals is for now a constant in the beats module, not in the format profile. This is debt: a second format with a different digit layout will require changing the beats code.
