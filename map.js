// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoia2V6MDE1IiwiYSI6ImNtN2NhamozZTBuMzYya3E4am5vMDByYmYifQ.LQ8JE1MQZwQ4BUwx5XzpjA';

// Global helper functions

// Format minutes as a time string (HH:MM AM/PM)
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Convert a Date object to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips by a given timeFilter (in minutes)
// Returns trips that started or ended within 60 minutes of the selected time.
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips // If no filter is applied, return all trips
    : trips.filter(trip => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
    });
}

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);


// Compute station traffic (arrivals, departures, total trips) using trips data
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  // Compute arrivals
  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  // Update each station with computed values
  return stations.map(station => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Global variables for filtering
let globalTrips = [];
let globalStations = [];
let globalCircles;
let globalRadiusScale;
let timeFilter = -1;

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// Select the SVG element inside the #map container
const svg = d3.select('#map').select('svg');

// Set up the map and UI once the map loads
map.on('load', () => {
  // Add bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'blue',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'cambridge.geojson'
  });
  map.addLayer({
    id: 'bike-lanes2',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'blue',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Load stations first, then trips
  loadBikeStations();

  // Set up the slider UI
  const timeSlider = document.getElementById('timeSlider');
  const selectedTime = document.getElementById('timeDisplay');
  const anyTimeLabel = document.getElementById('anyTime');

  // Update the time display and trigger filtering
  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  // Listen for slider changes
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});

// Load station data, then call loadTripData to update traffic and draw circles
function loadBikeStations() {
  const jsonurl = 'bluebikes.json';
  const csvurl = 'bluebikes-traffic-2024-03.csv';

  // Load stations
  d3.json(jsonurl).then(jsonData => {
    console.log('Loaded JSON Data:', jsonData);

    // Initialize stations with default traffic values
    let stations = jsonData.data.stations.map(station => ({
      ...station,
      arrivals: 0,
      departures: 0,
      totalTraffic: 0
    }));
    globalStations = stations; // Save for filtering

    // Function to get pixel coordinates
    function getCoords(station) {
      const point = new mapboxgl.LngLat(+station.lon, +station.lat);
      const { x, y } = map.project(point);
      return { cx: x, cy: y };
    }

    // Append circles to the SVG for each station
    let circles = svg.selectAll('circle')
      .data(stations, d => d.short_name)
      .enter()
      .append('circle')
      .attr('r', 5)
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .style('pointer-events', 'auto')
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic)) 
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });
      
    globalCircles = circles; // Save for filtering

    // Update circle positions on map events
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }
    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // Load trip data and update station traffic
    loadTripData(csvurl, stations, circles);
  }).catch(error => {
    console.error('Error loading JSON:', error);
  });
}

// Load trip data with date conversion and update station traffic
function loadTripData(csvurl, stations, circles) {
  d3.csv(csvurl, trip => {
    // Convert date strings to Date objects immediately
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    trip.is_member = trip.is_member === "TRUE";
    return trip;
  })
  .then(csvData => {
    console.log('Loaded Trip Data:', csvData);
    globalTrips = csvData; // Save trips globally for filtering

    // Compute station traffic using all trips
    const updatedStations = computeStationTraffic(stations, csvData);

    // Create a scale based on totalTraffic and save globally
    globalRadiusScale = d3.scaleSqrt()
      .domain([0, d3.max(updatedStations, d => d.totalTraffic)])
      .range([0, 25]);

    // Update circles with computed traffic
    circles.attr('r', d => globalRadiusScale(d.totalTraffic));
    circles.select("title")
      .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
  })
  .catch(error => {
    console.error('Error loading CSV:', error);
  });
}

// Update the scatterplot based on the selected time filter
function updateScatterPlot(timeFilter) {
  // Filter trips based on the time filter value
  const filteredTrips = filterTripsbyTime(globalTrips, timeFilter);

  // Recompute station traffic using the filtered trips
  const filteredStations = computeStationTraffic(globalStations, filteredTrips);

  // Adjust the radius scale range depending on whether filtering is applied
  if (timeFilter === -1) {
    globalRadiusScale.range([0, 25]);
  } else {
    globalRadiusScale.range([3, 50]);
  }

  // Update the circles using the filtered station data
  globalCircles
    .data(filteredStations, d => d.short_name)
    .join('circle')
    .attr('r', d => globalRadiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );
    
}
