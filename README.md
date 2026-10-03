# VetECG

A browser app that turns ECG printouts of dogs and cats into numbers and a draft report. It takes JPEG exports from the
«Поли-Спектр.NET» electrocardiograph software (Neurosoft Poly-Spectrum.NET) and:

- digitizes the six limb leads (I, II, III, aVR, aVL, aVF) into millivolt signals at 500 Hz;
- reads the printed text on the sheet: date, species letter, instantaneous heart rate row, time labels, calibration and
  heart rate from the footer;
- detects beats, delineates P/QRS/T and measures intervals, amplitudes, ST and the electrical axis;
- classifies the rhythm and compares the measurements with species- and size-specific reference ranges (each range
  cites its source);
- composes a measurement table and conclusion text;
- lets the user correct the result on the sheet overlay: lead separators, baselines, lead labels, markers, calibration.

Everything runs locally in the browser — no server, no uploads, no neural networks. The recognition core is plain
TypeScript (no OpenCV) and also runs in Node, which is how it is tested.

The user interface and the generated conclusion are in Russian: the app is built for Russian-speaking veterinarians.

> **Not a medical device.** VetECG is a research and convenience tool. Its measurements and text are a draft that a
> veterinarian must check against the original recording. It is not certified for diagnosis and comes with no warranty
> (see [LICENSE](LICENSE)).

## Supported input

JPEG exports of «Поли-Спектр.NET» sheets, 1280 px wide, in two layouts (1280×905 and 1280×883), six leads per sheet.
Several sheets of one recording can be loaded together; the app orders them, finds duplicates and overlaps, and warns
when sheets seem to belong to different animals. Other devices and print formats are not supported yet: the format is
described as data in `src/core/profile/polyspectrum.ts`, which is the place to start for a new one.

## Getting started

Requires Node.js ≥ 23.6.

```sh
npm install
npm run dev          # Vite dev server; add ?debug=1 to the URL for debug overlay layers
npm test             # all tests (Vitest)
npx tsc --noEmit     # type check
npm run build        # type check + production build into dist/
```

## Project layout

```
src/types/contracts.ts   shared types and constants between modules
src/core/                single-sheet recognition: layout, ink mask, lead traces, text reading, digitizing
src/analysis/            filtering, beats, measurements, rhythm, norms, conclusion; case/ — multi-sheet analysis
src/app/                 UI: state store, web workers, file loading, Konva overlay, results
test/                    Vitest tests; synthetic/ — generators of synthetic sheets and signals
fixtures/polyspectrum/   real sample sheets + expected readings + glyph templates
docs/                    architecture decision records (adr/) and generated reference docs (in Russian)
scripts/                 glyph template builder and a TypeScript loader hook for Node
```

Recognition of one sheet is `analyzePage` (`src/core/page`); analysis of a whole case, including user edits, is
`analyzeCase` (`src/analysis/case`). Both are pure functions over a grayscale image and are the two seams the tests
exercise.

## Test fixtures

`fixtures/polyspectrum/` holds ten real sheets used for regression tests. In the published repository the pet names and
owner surnames in the sheet headers are masked. The sheets are included for testing the software only; the license of the
code does not grant rights to the recordings, and «Поли-Спектр.NET» / Neurosoft are trademarks of their owners.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a network service, you
must offer its source code to its users.
