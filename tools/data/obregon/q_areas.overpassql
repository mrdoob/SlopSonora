[out:json][timeout:180];
(
 way["leisure"~"park|stadium|pitch|sports_centre|garden"](27.43,-110.02,27.54,-109.87);
 way["landuse"](27.43,-110.02,27.54,-109.87);
 way["natural"~"water|wood|scrub|grassland"](27.43,-110.02,27.54,-109.87);
 relation["natural"="water"](27.43,-110.02,27.54,-109.87);
 way["waterway"](27.43,-110.02,27.54,-109.87);
 way["water"](27.43,-110.02,27.54,-109.87);
 relation["landuse"](27.43,-110.02,27.54,-109.87);
 relation["boundary"="administrative"]["name"~"Obreg"];
);
out geom;
