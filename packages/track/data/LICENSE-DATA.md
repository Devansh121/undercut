# Track data licence

The track files in this folder (`*.json`) are databases derived from OpenStreetMap and from the
Copernicus WorldDEM-30 elevation model, combined with authored estimates (widths, banking, kerbs,
run-off kinds, barrier types and offsets, pit-lane widths, limit lines, boxes and grid slots). They
are not covered by the repository's MIT licence.

## Licence of the track files

The track files are made available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (ODbL). Any rights in
individual contents of the databases are licensed under the
[Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).

If you publicly use, adapt or redistribute a track file, you must attribute it as below, keep it
open under the ODbL, and keep the Copernicus notices with it.

## OpenStreetMap

© OpenStreetMap contributors. The circuit centrelines, pit lanes, mapped gravel and sand areas and
mapped barriers come from OpenStreetMap. That data is available under the Open Database License,
see https://www.openstreetmap.org/copyright.

## Copernicus WorldDEM-30

The heights are produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights
reserved.

The organisations in charge of the Copernicus programme by law or by delegation do not incur any
liability for any use of the Copernicus WorldDEM-30.

This credit does not suggest that the Copernicus programme, the European Union, ESA, DLR or Airbus
endorse this project. Anyone who redistributes the heights in these files is bound by the same
obligations of the Licence for the use of the Copernicus WorldDEM-30.

## Provenance

Each file records its sources in its `source` field: the OpenStreetMap relation and pit-lane way,
the Overpass queries with the time they were fetched and the OpenStreetMap database timestamp, the
sha256 of every raw input, the Copernicus tile, the elevation filter, the length scale factor and
the pipeline version. `tools/track-pipeline/` rebuilds a file byte for byte from those inputs.
