# Use cases (missions)

The same hardware (an ESP32-S3 sentry node with two ground-coupled ADXL345 seismic probes,
an LD2420 radar, a WS2812 ring and a buzzer) is deployed for very different jobs. A **mission
profile** decides how detections are interpreted and titled, how severe they are, and whether
the node sounds its siren or raises a silent alarm. Switch it from the dashboard
(**Mission** page), from the OLED base station (**Mission → SELECT**), or with
`POST /api/system/profile {"id": "nuclear"}`.

| Mission | Replaces / solves | Looks for | Response |
|---|---|---|---|
| **Nuclear Exclusion Zone** | Human guards standing in a radiation hazard area | Wildlife vs people by gait; vehicles | Audible siren from MEDIUM (scares wildlife off); any person is CRITICAL |
| **Border & Tunnel Watch** | Patrols and cameras that cannot see underground | Rhythmic, stationary subsurface impacts with nothing on the surface radar | **Silent** alarm, logged, phone notification |
| **Jewelry Store After-Hours** | Break-ins through a shared wall or the vault | Drilling / cutting, hammer impacts, structural vibration, people in the showroom | Audible siren (15 s) from HIGH |
| General Perimeter (default) | Fence-line patrols | People and vehicles crossing | Audible siren from HIGH |

## How each mission decides

All rules run on the server for every packet (`server/src/services/profiles.js`), on top of the
fusion engine, using the 15 seismic features the edge ML already computes plus the radar.

**Nuclear: wildlife or person?** A gait score counts four bipedal cues: at least ~300 ms between
impacts, low-band energy ≥ 0.21, dominant impact frequency ≤ 11.8 Hz, and cadence regularity
≥ 0.4. Three or more = a person. The decision is a majority vote over the node's last five step
windows, so a single half-step does not flip it. Small animals step faster (~170–290 ms) with
lighter, higher-pitched (12–16 Hz) impacts. A person in the zone is always **CRITICAL**; wildlife
is MEDIUM (HIGH within 2 m), and both trigger the siren.

**Border: tunnelling.** Fusion deliberately never alerts on seismic evidence alone, so this
mission adds its own path: impulsive impacts (crest factor ≥ 3.5), rhythmic (0.4–3 s apart,
cadence ≥ 0.3), low-frequency, with **no surface target on the radar**, sustained for four or more
windows, from a **stationary** source (the probe A/B loudness ratio stays steady; a walker's
changes). That raises *Possible tunnelling activity* (HIGH, CRITICAL after ten windows), silently.

**Jewelry store: drilling.** Continuous vibration (crest factor < 3.2) with high-frequency content
(≥ 15 Hz dominant or centroid ≥ 18 Hz, high-band ratio ≥ 0.4), at least 4× the ambient noise floor,
sustained for three windows = *Drilling or cutting on wall/vault* (CRITICAL). A sharp impact
(≥ 0.25 g, crest ≥ 5) = *Forced-entry impact*. Strong vibration with nobody on the showroom radar
= *Vibration on wall/vault*. A radar target after hours = *Intruder in showroom* (CRITICAL).

Each mission alert gets its own kind (`WILDLIFE`, `SUBSURFACE`, `DRILLING`, `IMPACT`,
`VIBRATION`), so the fusion path and the mission path merge into one alert per event, and the
alert carries `interpretation.detail` — the human-readable reason ("Rhythmic impacts every ~630 ms
for 135 windows, source stationary, nothing on the surface radar").

> **Calibration note.** Thresholds were set from the simulator's physically synthesized gaits and
> signals and from bench readings. Before an operational deployment, record labelled windows on
> site (**Settings → Record**, written to `ml/data/`) and re-tune.

## Demo without hardware (simulator)

Turn on **Settings → Include simulated demo nodes**, then pick a mission and its scenario:

| Mission | Scenario (Settings → Simulator, or `POST /api/system/sim/scenario`) | Expected alert |
|---|---|---|
| Nuclear | `wildlife` — an animal wandering past two nodes | *Wildlife in exclusion zone* (MEDIUM) |
| Nuclear | `patrol` — a person walking a loop | *Unauthorized person in hazard zone* (CRITICAL) |
| Border | `tunnel` — hidden digger under Sim North Gate | *Possible tunnelling activity* (CRITICAL, silent) |
| Jewelry | `drilling` — drill on the wall by Sim East Fence | *Drilling or cutting on wall/vault* (CRITICAL) |

The simulator synthesizes the waveforms (footfalls, strikes, a 38 Hz drill) and runs them through
the same feature extraction, ML and mission rules as real packets — nothing is faked downstream.

## Demo with the real node

Put the node on the floor/wall with both probes touching it, arm the site, then:

- **Nuclear**: walk past the radar (person, CRITICAL); tap the floor quickly and lightly with your
  fingers while staying out of the radar's view (animal-like footfalls).
- **Border**: stay out of the radar's view and knock rhythmically on the floor next to the probes
  about every 0.6 s for ~5 s (stationary digging) → silent *Possible tunnelling activity*.
- **Jewelry store**: press a running electric toothbrush, phone on vibrate, or a drill against the
  surface the probes touch → *Drilling or cutting*; a sharp knock → *Forced-entry impact*.
- **Any mission**: tilt or knock the node → *Sensor tampering*, and (when armed, audible mission)
  the node's buzzer and ring sound for the mission's siren time.

## Response: the node's siren

When an alert is created on a real node, the site is **ARMED** and the mission is audible, the
server queues a `deter` downlink; the node receives it in the reply to its next uplink (≈1 s when
active) and sounds the buzzer (4 beeps/s) with the ring strobing. The border mission never sounds
it (silent alarm, logged as `SILENT_ALARM`). Operators can also sound it manually: **Sound alarm**
on an alert or node in the dashboard, or **Nodes → SELECT** on the base station.
