# Racing-line data licence

The racing-line files in this folder (`*.line.json`) are computed by `tools/ai/build.mjs` from the
circuit databases in `packages/track/data/`: each is a lateral offset and a speed at every sample
along a circuit's centreline, with its braking, throttle and deployment zones. Because they are
derived from those databases, they are offered under the same terms, not the repository's MIT
licence.

The envelope files (`*.envelope.json`) hold only the car's grip and speed limits, contain no
circuit data, and are under the repository's MIT licence.

## Licence of the racing-line files

The racing-line files are made available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). Any rights in
individual contents of the databases are licensed under the
[Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).

If you publicly use, adapt or redistribute a racing-line file, you must attribute it as below, keep
it open under the ODbL, and keep the Copernicus notices with it.

## OpenStreetMap

© OpenStreetMap contributors. The circuit centrelines the lines are measured along come from
OpenStreetMap. That data is available under the Open Database License, see
https://www.openstreetmap.org/copyright.

## Copernicus WorldDEM-30

The circuit heights are produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all
rights reserved.

The organisations in charge of the Copernicus programme by law or by delegation do not incur any
liability for any use of the Copernicus WorldDEM-30.
