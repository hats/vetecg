# 0009. D01: tracing without searching alternatives; the lead anchor is the label

## Context

The plan assumed a global condition for tracing: if more than 3 % of the ink is not explained by traces, the program tries alternatives at branch points ("turn back toward its own baseline" or "pass straight through"). The plan confirmed the lead anchor by the mode of ink y in the first columns near the label, and smoothed the baseline after the search.

## Decision

Task 04 proved something else in code.

- **There is no search over alternatives.** If less than 97 % of the ink is explained, confidence is lowered with the reason `unexplained_ink`.
- **The lead anchor** is the label on the left (±8 px in y from the glyph center) together with the expected baseline from the profile.
- **The baseline** is determined from the trace after the fact as the median of modes over 1 s windows, without extra smoothing.
- **A polyline segment across a clipped region** is not a signal: digitization does not sample it.

## Why

- **Searching alternatives** is rejected as unnecessary: on all 10 sheets run-based tracing explains at least 99.9 % of the ink, so there is nothing to search. Writing a complex mechanism for a case that does not occur in any fixture means adding untestable code.
- **The ink mode of the first columns as an anchor** is rejected based on measurement on 10 sheets: it is worse than the label.
- **Smoothing the baseline on top of the median of modes** turned out to be unnecessary.

## Consequences

- On an unfamiliar sheet where the ink is not explained, the program will not look for another path. It will honestly lower confidence, and the veterinarian will have to edit the markup (lead separator, labels).
- Three or more leads in one component is a documented limitation: separate DPs without coordination. The fixtures have no such case; the regression does not cover it.
- Whoever wants to bring back the search must first find a sheet on which less than 97 % is explained. Without such a sheet there is nothing to test the mechanism on.
