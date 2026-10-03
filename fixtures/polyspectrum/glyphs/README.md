# «Поли-Спектр.NET» glyph templates

Data for template-based reading of the sheet (`src/core/pagemeta`): digits, lead labels, species letters and footer fragments cut from the fixtures `fixtures/polyspectrum/*.jpg`. There is no OCR engine: a glyph from the sheet is compared with these bitmaps by normalized correlation and accepted by the "nearest template with a margin" rule (correlation ≥ 0.85, lead over the best candidate with a different text ≥ 0.05).

## Files

- `glyphs.json`: template sets. Each glyph has `text`, `width`, `height`, `dy` (offset of the glyph top from the top of the font line; used for «.» and «:», which sit lower than digits), `preview` (`.#` rows at threshold 128, for the eye) and `data`: soft ink row by row, `0` when brightness ≥ `inkThreshold` (170), otherwise `(170 − brightness)·255/170`. This way grid dots (brightness 180–235) do not take part in the comparison, while letter anti-aliasing is preserved. Digit sets have `pairAbove`: a glyph wider than this many px is a merged pair, and `matchGlyphs` resolves it by trying pairs of templates (HR digits: 9).
- `provenance.json`: provenance, one record per template in `glyphs.json` order: the fixture, the sheet rectangle (top-left corner and size, px) and the component threshold `boxThreshold` at which the rectangle was found (130 for bold fonts, 170 for small and regular). The test `test/pagemeta.test.ts` re-cuts each template at these coordinates and compares byte by byte.

## Sets

| Set | What | Font |
|---|---|---|
| `hrDigits` | digits 0–9 of the instantaneous HR row above lead I | bold, 10 px |
| `rrDigits` | digits 0–9 of the RR row in ms (variant B) | bold, 9 px |
| `timeDigits` | digits 0–9 and «:» of the time marks above the frame | small, 7 px |
| `textDigits` | digits 0–9, «.», «:» of the header date/time and footer numbers | regular, 8–9 px |
| `leadLabelsA`, `leadLabelsB` | whole labels I, II, III, aVR, aVL, aVF, per variant (rendered differently between variants) | bold |
| `species` | species letters «с» (U+0441) and «к» (U+043A) after «ЭКГ» in the header | regular |
| `header` | the «ЭКГ» fragment, the anchor for the species letter | regular |
| `footer` | the fragments «мм/с», «мм/мВ», «ЧСС:», anchors for calibration and footer HR | regular |

Digits are shared between variants A and B, but each font has its own set (point sizes differ; the small font of variant B is 1 px larger). A character may have several templates: text on the sheets is printed with different subpixel phases (the stem of «1» in one column or smeared over two), and a single template gives a correlation of 0.64–0.80 on a foreign phase; the script selects instances dissimilar to those already selected (correlation in both directions < 0.93), up to 16 per character. The regular-font dot «.» is 1×1 px and its correlation is undefined; punctuation is handled structurally during reading (date format, "mm:ss"), not by template.

## Rebuilding

```
node --import ./scripts/ts-hooks.mjs scripts/build-glyphs.ts
```

The script reads `expected.json`, segments the zones with the same functions as sheet reading (`src/core/pagemeta/zones.ts`), and matches word glyphs to the expected text in two passes: first clean words (glyph count equals text length), then merged ones, whose known text is aligned using the composition of already selected templates (otherwise a sheet on which all words are merged would be left without its own print phase: the footer «50» on A sheets, the variant B time marks). Empty crops are discarded. The result is deterministic: a repeated run does not change the files (verified by md5). `scripts/ts-hooks.mjs` is a resolve hook that completes extensionless relative imports to `.ts` for the built-in type stripping of Node ≥ 23.6.
