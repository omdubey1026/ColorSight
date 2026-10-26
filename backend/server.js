const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();

// --------------------------------------
// BASIC CONFIGURATION
// --------------------------------------

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

const allowedOrigins = [
"http://localhost:5173",
"https://frontend-one-tau-18.vercel.app",
];

// Add FRONTEND_URL from Render environment variables if configured.
if (process.env.FRONTEND_URL) {
const frontendUrl = process.env.FRONTEND_URL.replace(//+$/, "");

if (!allowedOrigins.includes(frontendUrl)) {
allowedOrigins.push(frontendUrl);
}
}

app.use(
cors({
origin: (origin, callback) => {
// Allow requests without an Origin header, such as server-to-server
// requests and command-line health checks.
if (!origin || allowedOrigins.includes(origin)) {
return callback(null, true);
}

```
  console.warn("CORS blocked origin:", origin);
  return callback(new Error("Origin not allowed by CORS"));
},
```

})
);

app.use(express.json({ limit: "1mb" }));

// --------------------------------------
// MONGODB SCHEMA
// --------------------------------------

const analysisSchema = new mongoose.Schema(
{
colors: [
{
name: {
type: String,
required: true,
},
hex: {
type: String,
required: true,
},
rgb: {
type: String,
default: "",
},
percentage: {
type: Number,
default: 0,
},
},
],

```
objects: [
  {
    name: {
      type: String,
      required: true,
    },
    confidence: {
      type: Number,
      default: 0,
    },
    color: {
      type: String,
      default: "",
    },
  },
],

analyzedAt: {
  type: Date,
  default: Date.now,
},
```

},
{
timestamps: true,
}
);

const Analysis = mongoose.model("Analysis", analysisSchema);

// --------------------------------------
// HEALTH CHECK
// --------------------------------------

app.get("/api/health", (req, res) => {
res.status(200).json({
success: true,
message: "ColorSight backend is running!",
database:
mongoose.connection.readyState === 1 ? "connected" : "disconnected",
environment: process.env.NODE_ENV || "development",
timestamp: new Date().toISOString(),
});
});

// --------------------------------------
// SAVE COLOR ANALYSIS
// --------------------------------------

app.post("/api/analyze", async (req, res) => {
try {
const { colors, objects } = req.body;

```
if (!Array.isArray(colors)) {
  return res.status(400).json({
    success: false,
    message: "Colors must be provided as an array.",
  });
}

if (mongoose.connection.readyState !== 1) {
  return res.status(503).json({
    success: false,
    message: "Database is not connected. Please try again later.",
  });
}

const analysis = await Analysis.create({
  colors: colors.map((color) => ({
    name: String(color.name || "Unknown"),
    hex: String(color.hex || "#000000"),
    rgb: String(color.rgb || ""),
    percentage: Number(color.percentage) || 0,
  })),

  objects: Array.isArray(objects)
    ? objects.map((object) => ({
        name: String(object.name || "Unknown"),
        confidence: Number(object.confidence) || 0,
        color: String(object.color || ""),
      }))
    : [],
});

return res.status(201).json({
  success: true,
  message: "Color analysis saved successfully.",
  analysisId: analysis._id,
  analyzedAt: analysis.analyzedAt,
});
```

} catch (error) {
console.error("Analysis save error:", error.message);

```
return res.status(500).json({
  success: false,
  message: "Failed to save color analysis.",
});
```

}
});

// --------------------------------------
// GET ANALYSIS HISTORY
// --------------------------------------

app.get("/api/history", async (req, res) => {
try {
if (mongoose.connection.readyState !== 1) {
return res.status(503).json({
success: false,
message: "Database is not connected.",
});
}

```
const history = await Analysis.find()
  .sort({ analyzedAt: -1 })
  .limit(50)
  .lean();

return res.status(200).json({
  success: true,
  count: history.length,
  history,
});
```

} catch (error) {
console.error("History fetch error:", error.message);

```
return res.status(500).json({
  success: false,
  message: "Failed to fetch analysis history.",
});
```

}
});

// --------------------------------------
// ROOT ROUTE
// --------------------------------------

app.get("/", (req, res) => {
res.status(200).json({
success: true,
message: "Welcome to ColorSight API!",
endpoints: [
"GET /api/health",
"POST /api/analyze",
"GET /api/history",
],
});
});

// --------------------------------------
// 404 HANDLER
// --------------------------------------

app.use((req, res) => {
res.status(404).json({
success: false,
message: "API route not found.",
});
});

// --------------------------------------
// ERROR HANDLER
// --------------------------------------

app.use((error, req, res, next) => {
if (error.message === "Origin not allowed by CORS") {
return res.status(403).json({
success: false,
message: "This origin is not allowed to access the API.",
});
}

console.error("Server error:", error.message);

return res.status(500).json({
success: false,
message: "Internal server error.",
});
});

// --------------------------------------
// START SERVER & CONNECT DATABASE
// --------------------------------------

async function startServer() {
app.listen(PORT, "0.0.0.0", () => {
console.log("----------------------------------");
console.log("ColorSight Backend Started!");
console.log(`Server running on port: ${PORT}`);
console.log("Health URL: /api/health");
console.log("History URL: /api/history");
console.log("----------------------------------");
});

if (!MONGODB_URI) {
console.error(
"MongoDB connection failed: MONGODB_URI is missing from environment variables."
);
return;
}

try {
await mongoose.connect(MONGODB_URI, {
serverSelectionTimeoutMS: 15000,
});

```
console.log("MongoDB connected successfully!");
console.log(`Database: ${mongoose.connection.name}`);
```

} catch (error) {
console.error("MongoDB connection failed:", error.message);
}
}

startServer();
