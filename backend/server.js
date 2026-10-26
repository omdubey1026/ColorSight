const dns = require("dns");

// Fix DNS resolution for MongoDB Atlas SRV records
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;

// ========================================
// MIDDLEWARE
// ========================================

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json({ limit: "12mb" }));

// ========================================
// MONGODB SCHEMA
// ========================================

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

    objects: [
      {
        name: {
          type: String,
          default: "Unknown object",
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
  },
  {
    timestamps: true,
  }
);

const Analysis = mongoose.model("Analysis", analysisSchema);

// ========================================
// MONGODB CONNECTION
// ========================================

async function connectMongoDB() {
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    console.error(
      "MongoDB connection failed: MONGODB_URI is missing from .env"
    );
    return;
  }

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log("MongoDB connected successfully!");
    console.log("Database:", mongoose.connection.name);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
}

// ========================================
// HOME ROUTE
// ========================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to ColorSight API!",
    status: "Server is running",
  });
});

// ========================================
// HEALTH CHECK ROUTE
// ========================================

app.get("/api/health", (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;

  res.status(200).json({
    success: true,
    message: "ColorSight backend is healthy.",
    server: "running",
    database: databaseConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ========================================
// PROJECT INFORMATION ROUTE
// ========================================

app.get("/api/info", (req, res) => {
  res.json({
    project: "ColorSight",
    description: "AI-Based Color-Blind Assistive Tool",
    features: [
      "Image color analysis",
      "Color identification",
      "Object detection",
      "Voice assistance",
      "MongoDB analysis history",
    ],
    status: "Development",
  });
});

// ========================================
// COLOR ANALYSIS API
// ========================================

app.post("/api/analyze", async (req, res) => {
  try {
    const { colors, objects = [] } = req.body;

    // Validate colors
    if (!Array.isArray(colors) || colors.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of detected colors.",
      });
    }

    // Keep only valid color objects
    const validColors = colors.filter(
      (color) =>
        color &&
        typeof color.name === "string" &&
        typeof color.hex === "string"
    );

    if (validColors.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid colors were provided.",
      });
    }

    // Validate optional object detections
    const validObjects = Array.isArray(objects)
      ? objects
          .filter(
            (object) =>
              object &&
              typeof object.name === "string"
          )
          .map((object) => ({
            name: object.name,
            confidence: Number(object.confidence) || 0,
            color:
              typeof object.color === "string"
                ? object.color
                : "",
          }))
      : [];

    const analyzedAt = new Date();

    const responseData = {
      success: true,
      message: "Color analysis completed successfully.",
      totalColors: validColors.length,
      totalObjects: validObjects.length,
      colors: validColors,
      objects: validObjects,
      analyzedAt: analyzedAt.toISOString(),
    };

    // Save analysis when MongoDB is connected
    if (mongoose.connection.readyState === 1) {
      const analysis = new Analysis({
        colors: validColors,
        objects: validObjects,
        analyzedAt,
      });

      await analysis.save();

      console.log("Analysis saved to MongoDB:", analysis._id);

      return res.status(200).json({
        ...responseData,
        savedToDatabase: true,
        analysisId: analysis._id,
      });
    }

    // Analysis can still be returned if the database is unavailable
    console.warn(
      "MongoDB is disconnected. Analysis was not saved to history."
    );

    return res.status(200).json({
      ...responseData,
      savedToDatabase: false,
      warning: "MongoDB is disconnected. Analysis was not saved.",
    });
  } catch (error) {
    console.error("Analysis API error:", error.message);

    return res.status(500).json({
      success: false,
      message: "An error occurred while processing the analysis.",
    });
  }
});

// ========================================
// ANALYSIS HISTORY API
// ========================================

app.get("/api/history", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "MongoDB is not connected. History is unavailable.",
      });
    }

    const history = await Analysis.find()
      .sort({ analyzedAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      success: true,
      total: history.length,
      history,
    });
  } catch (error) {
    console.error("History API error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve analysis history.",
    });
  }
});

// ========================================
// HANDLE UNKNOWN ROUTES
// ========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found.",
  });
});

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {
  console.log("----------------------------------");
  console.log("ColorSight Backend Started!");
  console.log(`Server URL: http://localhost:${PORT}`);
  console.log(`Health URL: http://localhost:${PORT}/api/health`);
  console.log(`History URL: http://localhost:${PORT}/api/history`);
  console.log("----------------------------------");

  connectMongoDB();
});

// ========================================
// HANDLE MONGODB DISCONNECTION
// ========================================

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected.");
});

mongoose.connection.on("error", (error) => {
  console.error("MongoDB error:", error.message);
});