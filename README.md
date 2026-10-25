# Slop New York

A New York City simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore Manhattan on foot, by car, by bicycle, or by helicopter.

[Try it live](https://mrdoob.github.io/slop-newyork/)

## Ciudad Obregón

`obregon.html` runs the same engine on Ciudad Obregón, Sonora, built from OpenStreetMap. Its import map swaps New York's city modules for the ones in `js/obregon/`: the geography, configuration, ground, buildings, landmarks, street furniture, surroundings, map and scenic cameras. Traffic, pedestrians, controls, lighting and materials are shared.

To rebuild `js/obregon/geodata.js` from the OpenStreetMap extracts in `tools/data/obregon/`:

```sh
node tools/build-obregon.mjs
```

To refresh an extract, run `tools/overpass.sh tools/data/obregon/osm_roads.json tools/data/obregon/q_roads.overpassql`. The same command works for `buildings`, `areas` and `pois`.

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Third-party data and dependencies retain their respective licenses.
