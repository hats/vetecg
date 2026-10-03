# 0005. Lead tracing: dynamic programming over a graph of runs

## Context

The previous trace did not lie on the printed line, cut off tall waves and split leads into bands. Tall waves on the sheets extend into neighboring leads. Actual contact between curves occurs only in `17-56-20`: the III–aVR pair, 35 columns.

## Decision

The procedure is as follows:

1. Ink is extracted by hysteresis binarization: a core darker than 130, to which everything darker than 170 is attached by connectivity.
2. In each column the ink is split into runs, i.e. vertical segments. Runs of neighboring columns are linked into a graph.
3. The six leads are traced simultaneously by dynamic programming over this graph, each from its own anchor. The path cost is a soft distance to its own baseline, change of direction, and a skipped column. There is no limit on jump size.
4. The trace points are the entry and exit of each run, so a turnaround inside a run yields a wave apex.
5. The baseline is determined from the finished trace.
6. A gap longer than three columns is interpolated and flagged. A segment where the curve hits the frame is flagged as "clipped by the device" and is not interpolated.

## Why

- **One point per column**, as in the previous "optimal path", is rejected. A steep QRS front turns into a series of jumps, and height is lost at the apex. With runs the front stays a single vertical segment.
- **Splitting the sheet into horizontal bands** per lead is rejected: a wave extending into the neighboring band is cut off or goes to the neighbor. An anchor plus a shared graph let each curve take its own path.
- **A hard penalty for distance from the baseline** is rejected: a tall wave then costs more than a false jump to the neighboring curve.
- **A jump size limit** is unnecessary: vertical movement is already contained within a run.
- **Binarization thresholds ≤ 110** are rejected: the curves fall apart. **Thresholds from 180** are rejected: the grid starts at that brightness.

## Consequences

- Apex precision is limited by half the line thickness: per the task 04 measurement this is 0.74 px ≈ 0.017 mV.
- DP time grows as "columns × runs²" (no more than 1280 × 36). A sheet with many runs per column will be slower.
- Three or more leads in one component is a documented limitation (see 0009).
- Amplitude on clipped segments is unknown. Complexes with clipping do not go into measurements. A polyline segment across a clipped region is not a signal and is not drawn as a curve.
- If the "≥ 97 % of ink explained" test fails on a difficult sheet, the problem is in the trace model, not in the parameters.
