[out:json][timeout:180];
(
 nwr["amenity"~"place_of_worship|university|college|hospital|townhall|school|marketplace|fuel|bus_station"](27.43,-110.02,27.54,-109.87);
 nwr["tourism"](27.43,-110.02,27.54,-109.87);
 nwr["historic"](27.43,-110.02,27.54,-109.87);
 nwr["shop"="mall"](27.43,-110.02,27.54,-109.87);
 nwr["leisure"="stadium"](27.43,-110.02,27.54,-109.87);
 node["place"](27.43,-110.02,27.54,-109.87);
 node["highway"="traffic_signals"](27.43,-110.02,27.54,-109.87);
);
out center;
