# Contributing to Procedural Istanbul

Thank you for your interest. This project has two halves, a 3D client in JavaScript and a transport model in Python, and you can contribute to either without knowing the other. Türkçe katkılar da memnuniyetle karşılanır: issue ve PR'ları Türkçe ya da İngilizce açabilirsiniz.

## Getting set up

| You want to work on | You need | Start with |
|---|---|---|
| The 3D client (`src/`) | Node.js 20+ | `npm install`, then either compile the city (see the [README](README.md#quick-start)) or copy the published tiles: `cp -r docs/app/tiles docs/app/textures public/` and `npm run dev` |
| The transport model (`tools/od`, `tools/sumo`) | Python 3.10+ and [uv](https://docs.astral.sh/uv/) | `npm run test:od` (no data needed), then `npm run reproduce` (the reference estimate from the committed snapshot) |
| Documentation and the site (`docs/`) | a browser | `npx serve docs` |

Large data (OSM extracts, İBB downloads, SUMO networks, estimates) lives under `data/` and is not committed: every file there can be rebuilt with the commands in the READMEs. The one exception is `data/snapshot/koridor`, the frozen inputs of the reference estimate. On a corporate network with a TLS proxy, set `UV_NATIVE_TLS=1` and run Marp with `npx --offline`.

## Before you open a pull request

```bash
npm test          # 3D data pipeline
npm run test:od   # inverse O-D estimator (34 checks on a synthetic city)
npm run build     # the client still bundles
npm run reproduce # if you touched tools/od or tools/sumo: the reference estimate still comes out the same
```

If you change the method on purpose and the reference numbers move, run `npm run reproduce -- --update` and say in the pull request which numbers moved and why.

If you changed the client and want the published site to show it, rebuild it with `npm run build:site`, which writes `docs/app`.

## Conventions

- **Honest numbers.** This project reports what does not work as clearly as what does. A result goes into a README with its date, its inputs and the command that produced it. A value that is illustrative, not computed from data, is labelled so in the UI.
- **Assumptions in one place.** Model parameters live in the `ASSUMPTIONS` dictionaries (`tools/od/corridor.py`, `tools/od/anchors.py`) and are written into every estimate's `summary.json`.
- **Comments say why, not what.** Follow the style of the surrounding code: short, plain sentences on intent and on the trap being avoided.
- **Commits** say what changed and why in a short subject line, with details in the body. Turkish or English are both fine.
- **UTF-8 everywhere**, including Python file writes (`encoding="utf-8"`): Windows defaults to another code page.

## Good first tasks

| Task | Area | Why it matters |
|---|---|---|
| Export a SUMO run's vehicle trajectories and replay them in the browser instead of the random cars | client + SUMO | the moving cars would show the model, not a visual effect |
| Separate the "warned drivers re-route more often" effect from the information itself in `tools/sumo/shadow.py` (add a policy that only re-routes more often), and run several seeds | SUMO | the shadow simulation's recommendation is currently confounded |
| Use the 2012 household survey's mode shares per zone in `tools/od/anchors.py` instead of the fixed 1:1 boardings-to-car ratio, and remove transfer boardings | Python | turns the İstanbulkart anchor from a rough plausibility check into a real one |
| Add a test for `tools/od/sensor_audit.py` with a synthetic one-direction counter | Python | keeps the sensor audit honest |
| Show a second time of day in the panels: export a 17:00 estimate (`counts_202410_d5_h17.csv` exists) and let the clock switch between them | Python + client | the panels show one snapshot today |

Open an issue before a large change, so we can agree on the approach first.

## Reporting problems

Use the issue templates: **bug** (what you did, what you expected, what happened, browser and OS), **data question** (a number that looks wrong, with where you saw it), or **feature**. For the 3D client, the browser console output and the URL you used help a lot.
