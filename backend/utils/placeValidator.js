const CITIES_AND_KEYWORDS = new Set([
  // Maharashtrian cities & towns (close to Pune)
  "pune", "mumbai", "talegaon", "lonavala", "pimpri", "chinchwad", "khadki", "wadgaon", "kanhe", "kamshet", "malavli",
  "karjat", "panvel", "navi mumbai", "thane", "kalyan", "dombivli", "vasai", "virar", "nashik", "nagpur", "aurangabad",
  "sambhajinagar", "kolhapur", "solapur", "amravati", "nanded", "jalgaon", "akola", "sangli", "satara", "chandrapur",
  "parbhani", "yavatmal", "dhule", "nandurbar", "wardha", "gondia", "gadchiroli", "bhandara", "buldhana", "washim",
  "hingoli", "latur", "osmanabad", "dharashiv", "ratnagiri", "sindhudurg", "raigad", "alibag",
  "khed", "manchar", "chakan", "shirur", "baramati", "indapur", "junner", "bhor", "velhe", "mulshi", "maval",
  "ambegaon", "haveli", "daund", "saswad", "jejuri", "hadapsar", "hinjewadi", "baner", "wakad", "ravet", "nigdi",
  "akurdi", "bhosari", "sangvi", "aundh", "kothrud", "karvenagar", "warje", "sinhagad", "katraj", "dhankawadi",
  "bibwewadi", "kondhwa", "kharadi", "wagholi", "yerwada", "vishrantwadi", "camp", "swargate", "deccan", "shivajinagar",
  "koregaon", "kalyani", "pimple", "saudagar", "nilakh", "gurav",
  
  // Other major Indian cities
  "delhi", "bangalore", "bengaluru", "hyderabad", "ahmedabad", "chennai", "kolkata", "surat", "jaipur", "lucknow",
  "kanpur", "indore", "bhopal", "patna", "vadodara", "ghaziabad", "ludhiana", "agra", "faridabad", "meerut", "rajkot",
  "varanasi", "srinagar", "amritsar", "allahabad", "prayagraj", "ranchi", "howrah", "coimbatore", "jabalpur", "gwalior",
  "vijayawada", "jodhpur", "madurai", "raipur", "kota", "guwahati", "chandigarh", "hubli", "dharwad", "bareilly",
  "moradabad", "mysore", "mysuru", "gurgaon", "gurugram", "aligarh", "jalandhar", "tiruchirappalli", "bhubaneswar",
  "salem", "warangal", "guntur", "noida", "kochi", "cochin", "dehradun", "jamnagar", "ujjain", "belgaum", "belagavi",
  "mangalore", "mangaluru", "udaipur", "shimla", "tirupati", "nellore", "kurnool", "secunderabad", "karimnagar",
  "trivandrum", "thiruvananthapuram", "kozhikode", "thrissur", "malappuram", "kannur", "kollam", "palakkad", "alappuzha",
  "visakhapatnam", "vizag",
  
  // Indian States & UTs
  "maharashtra", "gujarat", "goa", "karnataka", "kerala", "tamil nadu", "andhra pradesh", "telangana", "rajasthan",
  "madhya pradesh", "chhattisgarh", "odisha", "west bengal", "bihar", "jharkhand", "uttar pradesh", "uttarakhand",
  "haryana", "punjab", "himachal pradesh", "jammu", "kashmir", "ladakh", "delhi", "ncr", "assam", "meghalaya",
  "arunachal", "nagaland", "manipur", "mizoram", "tripura", "sikkim",
  
  // Common place/destination keywords
  "home", "house", "village", "town", "city", "hostel", "room", "flat", "apartment", "apt", "block", "sector",
  "nagar", "colony", "society", "villa", "residency", "chowk", "road", "street", "st", "lane", "galli", "path",
  "airport", "station", "railway", "junction", "jn", "bus", "stand", "stop", "depot", "terminal", "term", "port",
  "temple", "church", "mosque", "hospital", "clinic", "college", "university", "campus", "office", "market",
  "shop", "mall", "hotel", "resort", "restaurant", "parent", "parents", "native", "relative", "relatives",
  "uncle", "aunt", "grandmother", "grandfather", "friend", "friends"
]);

const isValidPlace = (val) => {
  const trimmed = String(val || '').trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 100) return false;
  const letterCount = (trimmed.match(/[a-z]/g) || []).length;
  if (letterCount < 2) return false;
  if (!/^[a-z0-9\s,.'\-\/()]+$/.test(trimmed)) return false;
  const tokens = trimmed.split(/[^a-z0-9]+/);
  return tokens.some(token => CITIES_AND_KEYWORDS.has(token));
};

const VALID_PLACE_TYPES = new Set([
  // Geographic / Administrative regions
  'country', 'state', 'region', 'province', 'state_district', 'county', 'district', 
  'city', 'city_district', 'municipality', 'town', 'village', 'hamlet', 'suburb', 
  'neighbourhood', 'quarter', 'locality', 'croft', 'isolated_dwelling', 'island', 
  'archipelago', 'city_block', 'administrative', 'borough', 'subdistrict', 'civil_parish',
  
  // Major transport hubs / places where students travel
  'aeroway', 'aerodrome', 'airport', 'bus_station', 'bus_stop', 'station', 'ferry_terminal',
  
  // Educational/Medical/Institutional complexes
  'university', 'college', 'school', 'hospital', 'clinic',
  
  // Residential/accommodation areas
  'residential', 'housing_estate', 'hotel', 'hostel'
]);

const isValidResult = (r) => {
  // Exclude waterways (e.g. streams, canals, rivers)
  if (r.class === 'waterway') return false;
  
  // Exclude pure postcodes
  if (r.type === 'postcode' || r.addresstype === 'postcode') return false;
  
  // Check if addresstype, type, or class is in our whitelist
  if (VALID_PLACE_TYPES.has(r.addresstype) || 
      VALID_PLACE_TYPES.has(r.type) || 
      VALID_PLACE_TYPES.has(r.class)) {
    return true;
  }
  
  // Match boundary administrative divisions
  if (r.class === 'boundary' && r.type === 'administrative') {
    return true;
  }
  
  // Match general places that are not postcodes
  if (r.class === 'place' && r.type !== 'postcode') {
    return true;
  }
  
  // Match railway stations/halts/stops
  if (r.class === 'railway' && (r.type === 'station' || r.type === 'halt' || r.type === 'stop')) {
    return true;
  }

  // Match highway bus stops or platforms
  if (r.class === 'highway' && (r.type === 'bus_stop' || r.type === 'platform')) {
    return true;
  }

  return false;
};

const validatePlaceGeo = async (placeName) => {
  const name = String(placeName || '').trim();
  if (name.length < 3 || name.length > 150) return false;

  // 1. Check local dictionary first (fast path & offline fallback)
  if (isValidPlace(name)) {
    return true;
  }

  // 2. Query OSM Nominatim API for global cities, towns, villages, states, and countries
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&addressdetails=1&limit=5`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HEIMDALL-Hostel-Management-System/2.0 (student-gatepass-validation)'
      }
    });
    
    if (!res.ok) {
      console.warn(`Nominatim API geocoder returned status ${res.status}. Falling back to local validation result.`);
      return isValidPlace(name);
    }
    
    const data = await res.json();
    if (data && data.length > 0) {
      // Check if at least one result in the top 5 represents a valid geographic/place destination
      return data.some(r => isValidResult(r));
    }
    return false;
  } catch (err) {
    console.error('Error during Nominatim geocoding validation:', err.message);
    // On network failure/timeout, fallback to the local dictionary check so the app remains offline-resilient
    return isValidPlace(name);
  }
};

module.exports = {
  isValidPlace,
  validatePlaceGeo
};
