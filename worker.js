const IPINFO_TOKEN = 'YOUR_IPINFO_TOKEN'; // Replace with your ipinfo.io API token
const MY_NAMESPACE = 'YOUR_NAMESPACE'; // Replace with your Cloudflare Workers KV namespace

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || request.headers.get('X-Real-IP') || request.headers.get('Remote-Address');

  // Fetch IP geolocation data
  const geolocationUrl = `https://ipinfo.io/${ip}/geo?token=${IPINFO_TOKEN}`;
  try {
    const response = await fetch(geolocationUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch IP geolocation data: ${response.statusText}`);
    }
    const data = await response.json();
    const country = data.country; // Example: "IN" for India

    // Check if IP is from India
    const isFromIndia = country === 'IN';

    // Implement rate limiting logic based on country
    if (isFromIndia) {
      const rateLimitKey = `${ip}_${getCurrentDate()}`;
      const rateLimitData = await KV.get(rateLimitKey, { type: 'json' }) || { count: 0, timestamp: Date.now() };

      // Check if rate limit exceeded (10 requests per day)
      if (rateLimitData.count >= 10 && isWithinSameDay(rateLimitData.timestamp)) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Maximum 10 requests per day.' }), {
          status: 429, // 429 Too Many Requests status code
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',  // Adjust as needed
          }
        });
      }

      // Increment rate limit count and update KV
      rateLimitData.count++;
      rateLimitData.timestamp = Date.now();
      await KV.put(rateLimitKey, JSON.stringify(rateLimitData), { expirationTtl: 86400 }); // Cache for 24 hours
    }

    // Proceed with fetching data from the API or KV cache
    // Example fetching data from external API or Workers KV
    const cacheKey = `${domain}_${getCurrentDate()}`;
    let cachedData = await KV.get(cacheKey, { type: 'json' });

    if (!cachedData) {
      // Fetch data from external API if not cached
      const apiUrl = `https://tranco-list.eu/api/ranks/domain/${domain}`;
      const apiResponse = await fetch(apiUrl);
      if (!apiResponse.ok) {
        throw new Error(`Failed to fetch data from external API: ${apiResponse.statusText}`);
      }
      cachedData = await apiResponse.json();

      // Store fetched data in Workers KV
      await KV.put(cacheKey, JSON.stringify(cachedData), { expirationTtl: 86400 }); // Cache for 24 hours
    }

    // Return response with fetched data
    return new Response(JSON.stringify(cachedData), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',  // Adjust as needed
      }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Failed to process request.' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',  // Adjust as needed
      }
    });
  }
}

// Function to get current date in YYYY-MM-DD format
function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Function to check if given timestamp is within the same day
function isWithinSameDay(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  return now.getFullYear() === date.getFullYear() &&
         now.getMonth() === date.getMonth() &&
         now.getDate() === date.getDate();
}
