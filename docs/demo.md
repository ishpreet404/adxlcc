# Demo script

Works with zero hardware (simulator) or with the real node in the loop.

1. **Start** `npm start` (server + 2 simulated nodes, scenario *patrol*). Open the dashboard. Point out the map: nodes with radar beams, probe A/B on their baseline, the walker's ground-truth dot (purple) — and that the estimated crosshair follows it once a node senses it.
2. **Telemetry column**: battery %, voltage, RSSI bars, packet rate, power mode LIVE/ECO, edge state, heap, temperature, sensor health.
3. **Ground probes**: dual oscilloscope shows footsteps as damped spikes; probe cards show x/y/z, RMS, peak, STA/LTA; TDOA lag and correlation tell which probe heard the wave first.
4. **Radar scope**: moving-target blip with distance and relative bearing; energy meters.
5. **Trigger an intrusion**: SITE SETUP → *WALKER* (or *VEHICLE*) with the real node selected. Watch: state IDLE → SUSPECT → EVENT, fusion probability climbs past the amber/red thresholds, the frame flashes, the siren sounds, an alert card appears with the evidence terms and the *ESTIMATED POSITION*; INCIDENTS keeps the trail.
6. **Explainability**: FUSION panel — each evidence term's logit contribution; edge RF vs server RF agreement; spectrum with the footstep (2–20 Hz) vs engine (20–45 Hz) bands.
7. **Robustness**: switch the scenario to *wind* — probes get busy, ML says ENVIRONMENT, radar clear → probability capped, no alarm. Switch to *vehicle* — VEHICLE class, different spectrum.
8. **Battery story**: on the real node press ECO; packets drop to one heartbeat a minute, radar duty-cycled; stamp next to a spike and it wakes itself, alarms, and goes back to sleep 20 s later.
9. **Threat Intel**: run a breach check (unchanged feature).
10. **Retraining loop** (optional): NODE DETAIL → REC 30 s with label HUMAN while walking, then `python ml/train.py --real ml/data` and reflash.

## v2.1 additions to the script

11. **Zones**: SETUP → draw a *restricted* box around the "server room" and an *allowed* strip on the driveway. Run the *vehicle* scenario: no alarm on the driveway. Send a WALKER into the restricted box: CRITICAL immediately.
12. **Kinematics & hand-off**: *runner* scenario — the track shows 🏃, speed and heading, a red +5 s arrow and "ETA 12s → Sim East Fence"; the event log shows PREARM waking that node's radar.
13. **Triangulation**: place two simulated nodes so their beams overlap; when both range the walker the target gets a green ring and "TRIANGULATED ±0.5 m".
14. **Tamper**: lift/tilt the real node (or SETUP → TAMPER on a sim node): purple TAMPER alert, faster siren, node badge on the map, fires even when DISARMED.
15. **Loiter**: *loiter* scenario — the walker stops 3 m in front of Sim North Gate; after 15 s a LOITER alert appears.
16. **Arming**: switch to TEST, walk again: alerts are flagged TEST, no siren; DISARMED: only "DETECTION_DISARMED" events. Set the nightly schedule.
17. **Notifications**: put a Telegram bot token in `server/.env`; SETUP → TEST sends a message; every real alert then reaches the phone with position and zone.
18. **Replay & export**: INCIDENTS → ▶ REPLAY scrubs the intrusion; EXPORT CSV for the report. The activity charts show when the site is busiest.
19. **Wall mode**: press `W` on the big screen.
20. **Listen**: NODE telemetry → LISTEN TO PROBE A while someone walks past the spike.
