# 0004. The «Поли-Спектр.NET» format profile is a separate unit of data

## Context

The input is «Поли-Спектр.NET» JPEG exports forwarded via Telegram, 1280 px wide (≈4.2 px/mm). The exports have two header variants, with sheet heights of 905 and 883 px. There are no other devices, scans or photos among the samples (Q5).

## Decision

Recognition is built around the format profile. The profile is data, not tracer code. It holds the frame proportions, zones separately for each variant, glyph templates (JSON with bitmaps cut from the fixtures, with their source recorded), thresholds and layout constants. The constants serve as expectations and checks; they do not replace measurement.

- The sheet variant is determined by the bottom row of RR digits inside the frame and confirmed by the sheet height.
- A glyph is read as the nearest template with a margin: normalized correlation at least 0.85 and a lead over the second candidate of at least 0.05.
- Text is read component by component, from compact components in the profile zones.

## Why

- **Universal recognition of any format** by a cascade of methods (IMAGE-05) is rejected by answer Q5. There are no samples of other formats; only «Поли-Спектр.NET» is guaranteed. The profile mechanism is kept as groundwork.
- **Layout constants directly in the tracer** are rejected: a second format would then require changing the tracer, and story 81 forbids that.
- **Constants instead of measurement** are rejected. The grid is measured anew on every sheet. Variant B baselines do not lie on the 5 mm rows, so expected baselines are used only as a search anchor.
- **Cutting out text zones entirely** is rejected: in `17-56-22` the lead I curve enters the HR digit strip and would be lost if the zone were cut out.
- **A single absolute correlation threshold** for glyphs is rejected: it does not separate the 6/8 pair. The "best with a margin" rule reads all 479 fixture glyphs without errors.

## Consequences

- A sheet of any other format is rejected with «формат не распознан: ожидается экспорт Поли-Спектр.NET» ("format not recognized: a Poly-Spectrum.NET export is expected").
- The templates are cut from 10 fixtures. If another version of the program has a different font or layout, the templates and zones will have to be captured again.
- A glyph wider than 9 px is treated as a merged pair and read by trying pairs of templates. If reading fails, "?" is set and the number is skipped.
- The rule matching printed HR values to intervals is meant to live in the profile, but for now it is a constant in the beats module. This is acknowledged debt (see 0011).
- The "one animal" rule (Jaccard distance over the header below 0.3) is verified only on synthetic data: there is no multi-sheet recording among the fixtures.
