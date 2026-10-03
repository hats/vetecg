# 0006. Regression on real sheets: pure core, two seams, fixtures in the repo

## Context

The "don't hunt bugs" goal (R07) means that an error must be caught by a check on real sheets before the veterinarian sees it. Node has no canvas. Pet names and surnames are visible on the sheets, and a previous rule forbade committing source ECGs.

## Decision

- **The core** is pure functions over `GrayImage` (width, height, `Uint8Array`) without DOM. They work identically in the browser and in Node. In tests images are decoded by `jpeg-js` and `pngjs`.
- **The contract** is checked through two seams: `analyzePage` (one sheet) and `analyzeCase` (a case and edits).
- **Fixtures** are 10 unique sheets, committed uncropped, under neutral names with a mapping table. They come with a hand-transcribed `expected.json`: the row of printed HR values, RR, footer HR, species letter, time marks, date.
- **Ground truth** is the HR and RR values printed by the device.

## Why

- **Tests in the browser or a canvas-based core** are rejected: running real sheets in `vitest` without a browser is only possible with a DOM-free core.
- **A local ignored folder with sheets** (an option in Q7) is rejected: tests must work for anyone who clones the repository (G04).
- **Cropping the header and footer before committing** (the recommendation for Q7) is rejected by the owner: this data does not reveal who it is about. Moreover, the program itself reads the header (species letter, the pet-name fragment for the "one animal" check) and the footer (calibration, HR). Cropped fixtures would not test these functions.
- **Taking all 12 briefing files** is rejected: three of them are byte-identical, and duplicates would double the weight of one sheet in the regression.

## Consequences

- Pet names and surnames stay in git history permanently. They can be removed only by rewriting history. The "Do not commit sensitive ECG source data" rule in `AGENTS.md` is withdrawn by the owner's decision.
- The regression covers 10 sheets from one device. There is no multi-sheet recording among them, so sheet order and "one animal" are tested on synthetic combinations.
- The R/S amplitude check ±0.1 mV is a `todo` with stubs until the veterinarian measures by hand.
- Internal functions may be changed freely as long as the seams hold the contract. Changing the seams themselves breaks the whole regression.
- In Node the time budget is 4 s per sheet.
