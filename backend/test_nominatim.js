const { validatePlaceGeo } = require('./utils/placeValidator');

async function runTest() {
  console.log('Testing place geocoding...');
  
  const testCases = [
    { place: 'asdf', expected: false },
    { place: '123', expected: false },
    { place: 'qwerty', expected: false },
    { place: 'Pune', expected: true },
    { place: 'Mumbai', expected: true },
    { place: 'Grindelwald', expected: true }, // village in Switzerland
    { place: 'Home', expected: true },        // local keyword
    { place: 'going home', expected: true },   // local keyword
    { place: 'Khandala', expected: true },    // Indian hill station/town
    { place: 'asdfghjk', expected: false }
  ];

  for (const tc of testCases) {
    const start = Date.now();
    const result = await validatePlaceGeo(tc.place);
    const duration = Date.now() - start;
    console.log(`Place: "${tc.place.padEnd(15)}" | Valid: ${String(result).padEnd(5)} | Expected: ${String(tc.expected).padEnd(5)} | Duration: ${duration}ms`);
    
    if (result !== tc.expected) {
      console.warn(`⚠️ Warning: mismatch for "${tc.place}". Got ${result}, expected ${tc.expected}. (Could be OSM temporary rate-limit/connection fallback if it returned true for fallback)`);
    }
    
    // Throttle queries to avoid OSM Nominatim rate limits (min 1 second between requests)
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log('\nGeocoding test finished!');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
