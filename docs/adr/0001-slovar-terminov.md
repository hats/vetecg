# 0001. Project glossary

## Context

The VetECG 2 specification gives everyday words (sheet, case, trace, baseline, confidence) narrow meanings, and the requirements rest on these distinctions. Without a shared glossary, one word starts to mean different things in conversation, in a ticket and in the UI.

## Decision

Term meanings are set by the specification glossary, and project documentation and discussions use these words only in those meanings. The distinctions the requirements rest on:

- **sheet ≠ recording ≠ case.** A sheet is one «Поли-Спектр.NET» export (≈5–6 s). A recording is a continuous registration of one animal, which the device cuts into sheets. A case is what is analyzed together: the sheets plus species, size, calibration, drugs and minutes.
- **ink → run → trace → signal.** These are distinct stages. A trace is a polyline in pixels; it may have any number of points in one column. A signal is a trace converted to mV over time.
- **baseline** is the 0 mV level of a lead on the sheet. It is determined by the trace. It is not a grid line and not the expected position from the profile: the expected position is only an anchor.
- **confidence** is a number 0..1 together with a list of reasons, at three levels: lead, beat, measurement. Below the threshold a value is called "unreliable".
- **precision ceiling** is the cost of 1 px in mV and ms at the sheet's actual px/mm; precision is no better than ±2 px.
- **format profile** is the sheet layout of a specific program. **Species profile** is the species-specific windows and thresholds for a dog or a cat. These are two different objects.

## Why

- "Recording" and "case" cannot be merged. A case can include sheets of another animal if the veterinarian pressed «Анализировать вместе всё равно» ("Analyze together anyway"). Besides, a case has settings that a recording does not.
- A trace cannot be called a signal. A trace has several points per column, segments clipped by the device and interpolated segments. A signal has a uniform 500 Hz grid and physical units. Mixing them leads to amplitudes being taken from a polyline that contains invented segments.
- The baseline cannot be identified with a 5 mm grid row. On variant B sheets the baselines do not fall on those rows.
- Generic words such as "image", "scan" or "quality" are rejected. "Scan" refers to a format out of scope (IMAGE-05). With a single "quality" the previous app showed a green "good" while the numbers were wrong.

## Consequences

- "Profile" without qualification is ambiguous, so always write "format profile" or "species profile".
- A new format or device must be described in these same terms. If it needs a new concept, the glossary is extended first.
- Reports and tickets where a sheet is called an "image" and a trace a "signal" read ambiguously. Such places must be fixed, not interpreted.
