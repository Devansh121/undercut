"""Hard points of the car, in metres, in the Blender build frame.

Build frame: +X forward, +Y left, +Z up, origin on the ground under the centre of the wheelbase.
The glTF exporter maps this to +X forward, +Y up, +Z right, which is the body frame in AGENTS.md.

Where each number comes from is in tools/car/DIMENSIONS.md. Every assert at the bottom runs on
every build, so a change that breaks a proportion fails the build instead of reaching a render.
"""

# --- axles and wheels --------------------------------------------------------------------------
WHEELBASE = 3.600
X_FRONT_AXLE = WHEELBASE / 2
X_REAR_AXLE = -WHEELBASE / 2
TRACK_FRONT = 1.620  # wheel centre to wheel centre
TRACK_REAR = 1.550
TYRE_RADIUS = 0.360  # 720 mm diameter, unloaded
TYRE_WIDTH_FRONT = 0.360
TYRE_WIDTH_REAR = 0.445
RIM_BEAD_RADIUS = 0.2286  # 18 in bead seat
RIM_LIP_RADIUS = 0.2453  # 490.6 mm outer lip diameter
RIM_WIDTH_FRONT = 0.3353
RIM_WIDTH_REAR = 0.4293
WHEEL_Z = TYRE_RADIUS  # axle height at rest, unloaded tyre on the ground

# --- envelope -----------------------------------------------------------------------------------
OVERALL_WIDTH = 2.000
X_NOSE_TIP = 3.000
X_TAIL = -2.600  # rear wing trailing edge
OVERALL_LENGTH = X_NOSE_TIP - X_TAIL
ROLL_HOOP_TOP = 0.950

# --- floor and ride height ---------------------------------------------------------------------
PLANK_BOTTOM = 0.030  # static ride height at the skid, flat (no rake)
PLANK_THICK = 0.010
Z_REF = PLANK_BOTTOM + PLANK_THICK  # reference plane: underside of the floor
FLOOR_THICK = 0.012
Z_FLOOR_TOP = Z_REF + FLOOR_THICK
PLANK_HALF_WIDTH = 0.150
X_PLANK_FRONT, X_PLANK_REAR = 1.10, -1.15
X_FLOOR_FRONT = 1.30  # floor leading edge and fences, just behind the front tyres
X_FLOOR_BODY_START = 0.95  # floor reaches full width here
X_FLOOR_FULL_END = -1.05  # floor starts to narrow ahead of the rear tyres
FLOOR_HALF_WIDTH = 0.975
X_DIFFUSER_START = -1.20
X_DIFFUSER_EXIT = -2.10
Z_DIFFUSER_EXIT = 0.330  # diffuser roof height at the exit
DIFFUSER_HALF_WIDTH = 0.50

# --- chassis, cockpit, driver ------------------------------------------------------------------
X_BULKHEAD = 1.75  # front bulkhead of the survival cell
CHASSIS_HALF_WIDTH = 0.420  # at the cockpit, over the side impact structures
Z_CHASSIS_TOP_COCKPIT = 0.700  # cockpit rim height at the sides
X_COCKPIT_FRONT = 0.82
X_COCKPIT_REAR = -0.02
COCKPIT_HALF_WIDTH = 0.255
HELMET_CENTRE = (0.18, 0.0, 0.775)
HELMET_RADII = (0.150, 0.118, 0.138)  # half length, half width, half height
STEERING_WHEEL_CENTRE = (0.53, 0.0, 0.640)
STEERING_COLUMN_PITCH_DEG = 18.0  # column axis rises towards the driver by this angle

# --- halo --------------------------------------------------------------------------------------
X_HALO_PYLON_BASE = 0.98
Z_HALO_PYLON_BASE = 0.665
X_HALO_FRONT = 0.82
Z_HALO_TOP = 0.835
HALO_HALF_WIDTH_REAR = 0.330
X_HALO_REAR = 0.03
Z_HALO_REAR_MOUNT = 0.705

# --- sidepods and engine cover -----------------------------------------------------------------
X_SIDEPOD_INLET = 0.70
SIDEPOD_HALF_WIDTH = 0.740
Z_SIDEPOD_INLET_TOP = 0.620
Z_SIDEPOD_INLET_BOTTOM = 0.360
X_SIDEPOD_END = -1.45
X_ROLL_HOOP = -0.10
AIRBOX_HALF_WIDTH = 0.105

# --- front wing --------------------------------------------------------------------------------
FRONT_WING_HALF_SPAN = 0.985  # outer face of the endplate
X_FRONT_WING_LE = 2.985  # main plane leading edge at the centre
Z_FRONT_WING_MAIN = 0.085  # main plane lowest point
Z_FRONT_WING_TOP = 0.330  # endplate top

# --- rear wing and rear end --------------------------------------------------------------------
REAR_WING_HALF_SPAN = 0.530  # outer face of the endplate
X_REAR_WING_LE = -2.05
Z_REAR_WING_TOP = 0.960
Z_REAR_WING_MAIN_LE = 0.780
X_BEAM_WING = -2.18
Z_BEAM_WING = 0.330
X_CRASH_TIP = -2.53
Z_CRASH_CENTRE = 0.330
DRS_OPEN_DEG = 22.0  # flap rotation about its trailing-edge hinge; opens the slot by about 85 mm

# --- suspension pick-up points (left side; mirror for right) ----------------------------------
# (x, y, z). Inboard points sit on the chassis or gearbox, outboard points inside the wheel.
FRONT_LOWER_FRONT_IN = (2.02, 0.130, 0.215)
FRONT_LOWER_REAR_IN = (1.48, 0.170, 0.200)
FRONT_LOWER_OUT = (1.80, 0.680, 0.185)
FRONT_UPPER_FRONT_IN = (1.98, 0.165, 0.470)
FRONT_UPPER_REAR_IN = (1.55, 0.210, 0.520)
FRONT_UPPER_OUT = (1.775, 0.660, 0.530)
FRONT_TRACK_ROD_IN = (1.66, 0.165, 0.390)
FRONT_TRACK_ROD_OUT = (1.68, 0.680, 0.405)
FRONT_PUSHROD_OUT = (1.79, 0.665, 0.215)
FRONT_PUSHROD_IN = (1.66, 0.200, 0.560)

REAR_LOWER_FRONT_IN = (-1.42, 0.200, 0.180)
REAR_LOWER_REAR_IN = (-1.95, 0.130, 0.190)
REAR_LOWER_OUT = (-1.80, 0.585, 0.175)
REAR_UPPER_FRONT_IN = (-1.55, 0.160, 0.430)
REAR_UPPER_REAR_IN = (-2.00, 0.120, 0.440)
REAR_UPPER_OUT = (-1.82, 0.560, 0.545)
REAR_TOE_LINK_IN = (-2.02, 0.120, 0.330)
REAR_TOE_LINK_OUT = (-2.00, 0.575, 0.350)
REAR_PULLROD_OUT = (-1.79, 0.560, 0.520)
REAR_PULLROD_IN = (-1.70, 0.150, 0.170)
KINGPIN_INCLINATION_DEG = 0.0  # the steer node rotates about +Z through the wheel centre


def _check():
    w_front = TRACK_FRONT / 2 + TYRE_WIDTH_FRONT / 2
    w_rear = TRACK_REAR / 2 + TYRE_WIDTH_REAR / 2
    assert w_front <= OVERALL_WIDTH / 2 + 1e-6, w_front
    assert w_rear <= OVERALL_WIDTH / 2 + 1e-6, w_rear
    assert FRONT_WING_HALF_SPAN <= OVERALL_WIDTH / 2
    assert 5.5 <= OVERALL_LENGTH <= 5.7, OVERALL_LENGTH
    assert 2 * TYRE_RADIUS <= 0.725
    assert X_COCKPIT_REAR > X_REAR_AXLE + 1.4, "cockpit must sit well forward of the rear axle"
    assert X_ROLL_HOOP < X_COCKPIT_REAR
    assert REAR_WING_HALF_SPAN < TRACK_REAR / 2 - TYRE_WIDTH_REAR / 2 + 0.01
    for p in (FRONT_LOWER_OUT, FRONT_UPPER_OUT, FRONT_PUSHROD_OUT, FRONT_TRACK_ROD_OUT):
        assert p[1] < TRACK_FRONT / 2 - TYRE_WIDTH_FRONT / 2 + 0.06, p  # inside the wheel
    for p in (REAR_LOWER_OUT, REAR_UPPER_OUT, REAR_PULLROD_OUT, REAR_TOE_LINK_OUT):
        assert p[1] < TRACK_REAR / 2 - TYRE_WIDTH_REAR / 2 + 0.06, p


_check()
