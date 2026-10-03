# «Поли-Спектр.NET» fixtures

Ten real sheets: exports of the «Поли-Спектр.NET» program (Neurosoft), forwarded via Telegram as a "photo" (1280 px wide, JPEG). They are stored in the repository under neutral names; the expected values are in `expected.json`, and the test loader is `test/fixtures.ts`.

The previous `AGENTS.md` rule "do not commit source ECGs" was withdrawn by the owner's decision at the 2026-10-01 briefing: this data does not reveal who it is about. The originals `photo_2026-02-06_*.jpg` in the repository root are not tracked by git; byte-identical copies of them are stored here.

## Mapping to source files

Names: `a-NN` is variant A (1280×905, header «Поли-Спектр.NET (v.6.0.10.0)»), `b-NN` is variant B (1280×883, header «Поли-Спектр.NET © Нейрософт», with a row of RR intervals in ms at the bottom). Order within a variant follows the time in the source file name.

| Fixture | Source file | Size | MD5 | Note |
|---|---|---|---|---|
| `a-01.jpg` | `photo_2026-02-06_17-55-23.jpg` | 1280×905 | `806f5673f9913f49764f96c33b26bd10` | duplicates: `17-56-04`, `17-56-27` (same MD5) |
| `a-02.jpg` | `photo_2026-02-06_17-56-08.jpg` | 1280×905 | `f18fee787a533b8e81cade36ca7fac7e` | |
| `a-03.jpg` | `photo_2026-02-06_17-56-10.jpg` | 1280×905 | `fe33ba31933870ba6fb0686d874bd937` | |
| `a-04.jpg` | `photo_2026-02-06_17-56-15.jpg` | 1280×905 | `15581dbec4a4e7ba50b6511620727ff8` | |
| `a-05.jpg` | `photo_2026-02-06_17-56-18.jpg` | 1280×905 | `3841d710307514aa97c8af436a7bdac0` | |
| `a-06.jpg` | `photo_2026-02-06_17-56-20.jpg` | 1280×905 | `3622143ea65ec4351ab39335aa10ea2b` | the hardest sheet |
| `a-07.jpg` | `photo_2026-02-06_17-56-25.jpg` | 1280×905 | `8d4eb4d2fc3590e07351f807106e7757` | |
| `a-08.jpg` | `photo_2026-02-06_17-56-30.jpg` | 1280×905 | `861f3ab1fcc6e494c77b232646a40e25` | |
| `b-01.jpg` | `photo_2026-02-06_17-56-13.jpg` | 1280×883 | `79c59200fa3a89a7db216c35ca848771` | |
| `b-02.jpg` | `photo_2026-02-06_17-56-22.jpg` | 1280×883 | `ac529b1c5aa900e9d1768e314f1bc871` | |

Not included:

- `photo_2026-02-06_17-56-04.jpg`, `photo_2026-02-06_17-56-27.jpg`: byte-identical duplicates of `a-01` (MD5 matches).
- `photo_2026-02-06_17-37-25.jpg` (1050×764): a results table with a conclusion, not an ECG sheet; according to the owner it is not relevant to the task.

## How the values were verified

The orchestrator's transcription (`fixtures-expected.json` in the run folder) was re-checked by the task 01 implementer against the full-size images and against 3× crops of the header, time marks, HR row, footer and RR row. All values (header date, species letter, time marks, HR row, RR in ms, footer HR) matched. Added from observation:

- The variant B footer does not contain «~50Гц»: `50 мм/с; 10 мм/мВ; фильтр изолинии; 35Гц; ЧСС: N уд./мин` (in variant A it includes «~50Гц»). The footer line is recorded for each sheet.
- The product line on the right of the header (`headerProduct`) is recorded for each sheet; it is a reliable variant marker.
- The species letter in `expected.json` is Cyrillic («с» U+0441, «к» U+043A), as in the contracts' `SpeciesLetter`.

Share of white pixels (brightness ≥ 236, above the grid's upper bound of 235 per spike-results.md): 76.5–78.9 % across the ten sheets; with a threshold of ≥ 240 it is 73.2–75.5 %, with ≥ 245 it is 66.6–68.7 %. The test threshold "> 70 %" was chosen with a white threshold of 236.

## HR digits and beats (for story 29)

Measured on lead I ink (centers of columns with dark pixels in the HR row strip; R peaks by the topmost ink point):

- `a-01`: 12 digits, R peaks at x = 111, 202, 291, 379, 467, 555, 645, 760, 862, 959, 1054, 1148, and a complex at the right frame (≈1236, clipped). The digit centers (156, 247, 335, 423, 511, 600, 702, 813, 911, 1007, 1101) coincide with the midpoints of the intervals between neighboring peaks to within ≤ 2 px; the 12th digit (1192) is the interval to the clipped complex. In total, 13 complexes for 12 digits.
- `a-02`: 21 digits. The first visible R at x = 123, 179, 235, 290, 346, 401, 458, 515, 571; digits 2–9 (150, 206, 262, 317, 372, 429, 485, 543) are the midpoints of these intervals (≤ 2 px). **The first digit (center 104, left edge ≈ 94) is to the left of the first visible complex**: its interval starts before the start of the trace (x ≈ 86); the beat is not visible on the sheet.

Conclusion: the rule "the k-th digit is above the midpoint of the k-th interval between visible beats" holds for `a-01`, but the count "number of beats = number of digits + 1" does not hold on `a-02`: a digit may belong to a beat beyond the left edge of the sheet. Digits must be matched to beats by the digits' x positions, not by their count. Hypothesis (not verified): the device prints a digit if the interval midpoint falls within the curve area, and shifts it right so it does not go past the edge.

## What will appear here later

- `glyphs/`: glyph templates (HR digits, lead labels) and their provenance; added by the format profile task.
