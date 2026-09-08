# Location Colour Buckets

How an employee's `country` becomes a card colour on the
[Headcount Dashboard](../domains/headcount-dashboard/index.md). Established by
spec [003-headcount-dashboard](../../features/003-headcount-dashboard/spec.md)
and extended by spec
[007-contractor-management](../../features/007-contractor-management/spec.md).

## The Mapping

Defined once, as `COUNTRY_BUCKETS` in `public/chart-logic.js` — not inlined at
call sites.

| Raw `country` value | Bucket |
| --- | --- |
| `United Kingdom` | blue |
| `United States of America` | blue |
| `India` | red |
| *anything else* | green |

The keys are the raw strings the WorkDay export produces. The reference export
yields `United Kingdom` (26), `India` (13), `United States of America` (3), and
`Netherlands` (1) — 29 blue, 13 red, 1 green.

An unrecognised or newly-appearing country falls through to green by default, so
it never crashes or renders colourless. The trade-off: a differently-spelled US
or UK value (`USA`, `UK`) would silently render green rather than fail. Worth a
glance at the legend after a first import from a new export.

`country` is stored as the raw source value in the database (see
[data-schema.md](data-schema.md)) — the bucketing is presentation logic and
lives in the presentation layer.

For a contractor, engagement type overrides this country mapping: its card and
position-matrix count are always purple, while its raw country remains visible
as text.

## Colour Values

| Bucket | Background | Text | Contrast |
| --- | --- | --- | --- |
| blue | `#d6e4f7` | `#1a1a1a` | 13.5:1 |
| red | `#f7d6d6` | `#1a1a1a` | 12.9:1 |
| green | `#d9f0dc` | `#1a1a1a` | 14.5:1 |
| purple (contractor) | `#e8def8` | `#1a1a1a` | high contrast |

The hex values are fixed rather than left to the implementer so the contrast
requirement is checkable; each background has dark text above the WCAG 4.5:1
minimum for body text.

## Colour Is Never the Only Signal

Every card also displays its raw `country` value as text, and the screen carries
a legend naming each bucket. This matters specifically here: red and green are
the pair most affected by common colour-vision deficiency, and they are the two
buckets a reader is most likely to need to tell apart.
