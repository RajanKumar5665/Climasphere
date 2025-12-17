import express from "express";
import axios from "axios";
import cors from "cors";
import cookieParser from "cookie-parser";
import Weather from "./models/weatherModel.js";
import cron from "node-cron";
import connectDB from "./db/index.js";
import { Parser } from "json2csv";
import dotenv from "dotenv";
import userRouter from "./routes/user.routes.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const rawAllowedOrigins = (process.env.CORS_ORIGIN || "").trim();
const allowedOrigins = [
  "http://localhost:5173",
  "https://climasphere-aybkjmltb-rajan-mandals-projects.vercel.app",
  ...rawAllowedOrigins.split(",").map((s) => s.trim()),
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
// Express v5 (path-to-regexp v6) does not accept "*" as a route pattern.
// Use a regex to match all paths for preflight requests.
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.use("/api/weather", userRouter);

const WEATHER_API = "http://api.openweathermap.org/data/2.5/weather";
const POLLUTION_API = "http://api.openweathermap.org/data/2.5/air_pollution";
const API_KEY = process.env.OPENWEATHER_API_KEY;

if (!API_KEY) {
  console.warn(
    "OPENWEATHER_API_KEY is not set. Weather endpoints/cron will fail until it is configured."
  );
}

app.get("/", (req, res) => {
  res.send("API is running successfully");
});

// Get weather by city name
// app.get("/api/weather/:city", async (req, res) => {
//   try {
//     const city = req.params.city;
//     console.log("City", city);

//     const weatherRes = await axios.get(
//       `${WEATHER_API}?q=${city}&appid=${API_KEY}&units=metric`
//     );
//     const { lon, lat } = weatherRes.data.coord;

//     const pollutionRes = await axios.get(
//       `${POLLUTION_API}?lat=${lat}&lon=${lon}&appid=${API_KEY}`
//     );

//     const responseData = {
//       weather: weatherRes.data,
//       pollution: pollutionRes.data,
//     };

//     // Save to DB correctly
//     await Weather.create({
//       cityId: weatherRes.data.id,
//       name: weatherRes.data.name,
//       coord: weatherRes.data.coord,
//       weather: weatherRes.data.weather,
//       mainWeather: weatherRes.data.main,
//       base: weatherRes.data.base,
//       visibility: weatherRes.data.visibility,
//       wind: weatherRes.data.wind,
//       clouds: weatherRes.data.clouds,
//       dt: weatherRes.data.dt,
//       sys: weatherRes.data.sys,
//       timezone: weatherRes.data.timezone,
//       cod: weatherRes.data.cod,
//       pollution: {
//         aqi: pollutionRes.data.list[0].main.aqi,
//         components: pollutionRes.data.list[0].components,
//         dt: pollutionRes.data.list[0].dt,
//       },
//     });
//     res.json(responseData);
//   } catch (error) {
//     console.error("Error fetching city:", error.message);
//     res.status(500).json({ error: "Failed to fetch weather data" });
//   }
// });

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Climasphere/1.0 (contact@climasphere.com)",
    },
  });

  const a = res.data.address || {};

  return {
    country: a.country || "",
    state: a.state || a.state_district || "",
    city: a.city || a.town || a.municipality || a.county || "",
    area: a.suburb || a.neighbourhood || a.village || "",
  };
}

function normalizeIndiaLocation(loc) {
  if (loc.country === "India" && loc.city === loc.state) {
    return {
      ...loc,
      city: loc.state, // Delhi, Chandigarh, etc
    };
  }
  return loc;
}

app.get("/api/weather/:city", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: "Server missing OPENWEATHER_API_KEY" });
    }

    const city = req.params.city;

    const weatherRes = await axios.get(
      `${WEATHER_API}?q=${city}&appid=${API_KEY}&units=metric`
    );

    const { lon, lat } = weatherRes.data.coord;

    const pollutionRes = await axios.get(
      `${POLLUTION_API}?lat=${lat}&lon=${lon}&appid=${API_KEY}`
    );

    // 🔁 Reverse geocode (state detect)
    const geoRes = await axios.get(
      `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${API_KEY}`
    );

    const geo = geoRes.data[0];

    const data = await Weather.create({
      location: {
        country: {
          code: weatherRes.data.sys.country,
          name: geo.country || "India",
        },
        state: {
          name: geo.state || "Unknown",
        },
        city: {
          id: weatherRes.data.id,
          name: weatherRes.data.name,
        },
      },

      coord: weatherRes.data.coord,
      weather: weatherRes.data.weather,
      mainWeather: weatherRes.data.main,
      visibility: weatherRes.data.visibility,
      wind: weatherRes.data.wind,
      clouds: weatherRes.data.clouds,
      base: weatherRes.data.base,
      dt: weatherRes.data.dt,
      timezone: weatherRes.data.timezone,
      sys: weatherRes.data.sys,
      cod: weatherRes.data.cod,

      pollution: {
        aqi: pollutionRes.data.list[0].main.aqi,
        components: pollutionRes.data.list[0].components,
        dt: pollutionRes.data.list[0].dt,
      },
    });

    console.log("Data", data);

    res.json({
      weather: weatherRes.data,
      pollution: pollutionRes.data,
    });
  } catch (err) {
    res.status(500).json({ error: "Weather fetch failed" });
  }
});

app.get("/api/reverse-geocode", async (req, res) => {
  const { lat, lon } = req.query;
  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch location" });
  }
});

// Cron Job: Save India states data every 6 hours
const indianStates = [
  "Delhi",
  "Kolkata",
  "Mumbai",
  "Chennai",
  "Bengaluru",
  "Hyderabad",
  "Ahmedabad",
  "Jaipur",
  "Lucknow",
  "Patna",
  "Bhopal",
  "Ranchi",
  "Guwahati",
  "Bhubaneswar",
  "Chandigarh",
  "Shimla",
  "Dehradun",
  "Panaji",
];

app.get("/api/download-csv", async (req, res) => {
  try {
    const data = await Weather.find().lean();

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    // Nested object flatten readable format for CSV
    const formattedData = data.map((item) => ({
      "City Name": item.name || "",
      Country: item.sys?.country || "",
      Latitude: item.coord?.lat || "",
      Longitude: item.coord?.lon || "",
      "Weather Condition": item.weather?.[0]?.main || "",
      "Weather Description": item.weather?.[0]?.description || "",
      "Temperature (°C)": item.mainWeather?.temp || "",
      "Feels Like (°C)": item.mainWeather?.feels_like || "",
      "Min Temp (°C)": item.mainWeather?.temp_min || "",
      "Max Temp (°C)": item.mainWeather?.temp_max || "",
      "Pressure (hPa)": item.mainWeather?.pressure || "",
      "Humidity (%)": item.mainWeather?.humidity || "",
      "Wind Speed (m/s)": item.wind?.speed || "",
      "Wind Direction (°)": item.wind?.deg || "",
      "Visibility (m)": item.visibility || "",
      "Cloud Coverage (%)": item.clouds?.all || "",
      "Air Quality Index (AQI)": item.pollution?.aqi || "",
      "CO (µg/m³)": item.pollution?.components?.co || "",
      "NO (µg/m³)": item.pollution?.components?.no || "",
      "NO₂ (µg/m³)": item.pollution?.components?.no2 || "",
      "O₃ (µg/m³)": item.pollution?.components?.o3 || "",
      "SO₂ (µg/m³)": item.pollution?.components?.so2 || "",
      "PM2.5 (µg/m³)": item.pollution?.components?.pm2_5 || "",
      "PM10 (µg/m³)": item.pollution?.components?.pm10 || "",
      "NH₃ (µg/m³)": item.pollution?.components?.nh3 || "",
      "Sunrise Time": item.sys?.sunrise || "",
      "Sunset Time": item.sys?.sunset || "",
      "Timezone Offset": item.timezone || "",
      "Station Base": item.base || "",
      "Weather Code": item.cod || "",
      "City ID": item.cityId || "",
      "Record Created At": new Date(item.createdAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }),
    }));

    // CSV fields
    const fields = Object.keys(formattedData[0]);

    const opts = {
      fields,
      quote: "",
      delimiter: ",",
      header: true,
    };

    const parser = new Parser(opts);
    const csv = parser.parse(formattedData);

    res.header("Content-Type", "text/csv");
    res.attachment("weather_data.csv");
    res.send(csv);
  } catch (err) {
    console.error("CSV generation error:", err);
    res.status(500).json({ error: "Error generating CSV" });
  }
});

cron.schedule("0 */12 * * *", async () => {
  console.log("Running 12-hour cron job for Indian states");

  if (!API_KEY) {
    console.warn("Skipping cron job: missing OPENWEATHER_API_KEY");
    return;
  }

  for (const city of indianStates) {
    try {
      const weatherRes = await axios.get(
        `${WEATHER_API}?q=${city}&appid=${API_KEY}&units=metric`
      );
      const { lon, lat } = weatherRes.data.coord;

      const pollutionRes = await axios.get(
        `${POLLUTION_API}?lat=${lat}&lon=${lon}&appid=${API_KEY}`
      );
      await Weather.create({
        cityId: weatherRes.data.id,
        name: weatherRes.data.name,
        coord: weatherRes.data.coord,
        weather: weatherRes.data.weather,
        mainWeather: weatherRes.data.main,
        base: weatherRes.data.base,
        visibility: weatherRes.data.visibility,
        wind: weatherRes.data.wind,
        clouds: weatherRes.data.clouds,
        dt: weatherRes.data.dt,
        sys: weatherRes.data.sys,
        timezone: weatherRes.data.timezone,
        cod: weatherRes.data.cod,
        pollution: {
          aqi: pollutionRes.data.list[0].main.aqi,
          components: pollutionRes.data.list[0].components,
          dt: pollutionRes.data.list[0].dt,
        },
      });
    } catch (err) {
      console.error(`Error saving ${city}:, err.message`);
    }
  }
});

connectDB()
  .then(() => {
    const port = Number(process.env.PORT) || 8000;
    app.listen(port, "0.0.0.0", () => {
      console.log(`⚙️ Server is running at port : ${port}`);
    });
  })
  .catch((err) => {
    console.log("MONGO db connection failed !!! ", err);
  });
