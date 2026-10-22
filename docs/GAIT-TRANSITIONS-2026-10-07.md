# Footfall synchronization

The live character already derives animation speed from rendered travel
distance. Its steady-speed contact tests did not exercise blended clip phase.
Walk/run clips contain one stride cycle; the firing variants contain two.
Advancing all actions with the target clip's time scale made their legs drift
out of phase during a crossfade. A real-asset regression reproduced a 0.028
cycle difference on the first 30 Hz walk-to-run frame.

Locomotion actions now sample one shared footfall phase. Distance advances
that phase using the active clip's measured stance speed and stride extension.
Each action converts the phase into its own duration/cycle count. A two-cycle
clock preserves both halves of firing clips. Idle/airborne actions retain their
own timing; respawn resets the gait phase.

`tools/gait_transition_check.mjs` exercises walk, run, sprint, firing, slowing
and stopping at 30/60/144 Hz. Existing distance/contact checks still measure
actual feet against world movement. These checks establish synchronization,
not an exact recreation of ev.io's animation curves or a guarantee of matching
subjective game feel. Movement speed, body size and passive bot behavior are
unchanged in this patch.
