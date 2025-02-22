// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoia2V6MDE1IiwiYSI6ImNtN2NhamozZTBuMzYya3E4am5vMDByYmYifQ.LQ8JE1MQZwQ4BUwx5XzpjA';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

// Load bike lanes
map.on('load', () => {
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
});

const svg = d3.select('#map').select('svg');

function loadBikeStations() {
    const jsonurl = 'bluebikes.json';
    const csvurl = 'bluebikes-traffic-2024-03.csv';

    // Load stations first
    d3.json(jsonurl).then(jsonData => {
        console.log('Loaded JSON Data:', jsonData);

        let stations = jsonData.data.stations.map(station => ({
            ...station,
            arrivals: 0, // Initialize arrivals
            departures: 0, // Initialize departures
            totalTraffic: 0 // Initialize total traffic
        }));

        // Function to get pixel coordinates
        function getCoords(station) {
            const point = new mapboxgl.LngLat(+station.lon, +station.lat);
            const { x, y } = map.project(point);
            return { cx: x, cy: y };
        }

        // Append circles to the SVG for each station
        let circles = svg.selectAll('circle')
            .data(stations)
            .enter()
            .append('circle')
            .attr('r', 5)
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.8);

        // Function to update circle positions
        function updatePositions() {
            circles
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy);
        }

        // Initial update and event listeners for dynamic positioning
        updatePositions();
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        // Now load trip data and update stations
        loadTripData(csvurl, stations, circles);

    }).catch(error => {
        console.error('Error loading JSON:', error);
    });
}

// Function to load trip data and update stations
function loadTripData(csvurl, stations, circles) {
    d3.csv(csvurl).then(csvData => {
        console.log('Loaded Trip Data:', csvData);

        let trips = csvData.map(d => ({
            ride_id: d.ride_id,
            bike_type: d.bike_type,
            started_at: new Date(d.started_at),
            ended_at: new Date(d.ended_at),
            start_station_id: d.start_station_id,
            end_station_id: d.end_station_id,
            is_member: d.is_member === "TRUE"
        }));

        // Compute departures and arrivals
        const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
        const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

        // Update station data with trip counts
        stations.forEach(station => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.arrivals + station.departures;
        });

        console.log('Updated Stations with Traffic:', stations);

        // Update circle colors based on total traffic
        circles
            .attr('fill', d => d.totalTraffic > 1000 ? 'red' : d.totalTraffic > 500 ? 'orange' : 'green');

    }).catch(error => {
        console.error('Error loading CSV:', error);
    });
}
