import { useEffect, useState } from "react";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";
import "./App.css";

const API_URL = "https://colorsight-backend.onrender.com";

let modelPromise = null;

const loadObjectModel = async () => {
  if (!modelPromise) {
    modelPromise = cocoSsd.load().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }

  return modelPromise;
};

function App() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState("");
  const [results, setResults] = useState([]);
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState("Not loaded");
  const [error, setError] = useState("");
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [analysisTime, setAnalysisTime] = useState("");

  // History dashboard states.
  const [currentPage, setCurrentPage] = useState("home");
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Check backend connection.
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const response = await fetch(`${API_URL}/api/health`);

        if (!response.ok) {
          throw new Error("Backend unavailable");
        }

        const data = await response.json();

        setBackendStatus(data.success ? "Connected" : "Disconnected");
      } catch {
        setBackendStatus("Disconnected");
      }
    };

    checkBackend();
  }, []);

  // Fetch previous analyses from MongoDB through the backend.
  const fetchHistory = async () => {
    setLoadingHistory(true);
    setHistoryError("");

    try {
      const response = await fetch(`${API_URL}/api/history`);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to load analysis history."
        );
      }

      const records = Array.isArray(data.history)
        ? data.history
        : Array.isArray(data.analyses)
          ? data.analyses
          : Array.isArray(data.data)
            ? data.data
            : [];

      setHistory(records);
      setHistoryLoaded(true);
    } catch (err) {
      setHistoryError(
        `${err.message} Please check that the backend and MongoDB are running.`
      );
    } finally {
      setLoadingHistory(false);
    }
  };

  // Open the history page and load saved records.
  const openHistory = () => {
    setCurrentPage("history");
    fetchHistory();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Return to the main analyzer.
  const openHome = () => {
    setCurrentPage("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Upload and preview an image.
  const handleUpload = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setError("");
    setResults([]);
    setObjects([]);
    setAnalysisTime("");
    setPreview("");

    if (!file.type.startsWith("image/")) {
      setImage(null);
      setError("Please upload a valid image file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setImage(null);
      setError("Image size must be less than 10 MB.");
      return;
    }

    setImage(file);

    const reader = new FileReader();

    reader.onload = () => {
      setPreview(reader.result);
    };

    reader.onerror = () => {
      setError("Unable to read this image. Please try another one.");
    };

    reader.readAsDataURL(file);
  };

  // Convert RGB to HEX.
  const rgbToHex = (r, g, b) => {
    return (
      "#" +
      [r, g, b]
        .map((value) =>
          Math.round(value).toString(16).padStart(2, "0")
        )
        .join("")
        .toUpperCase()
    );
  };

  // Find an approximate color name.
  const getColorName = (r, g, b) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    if (max - min < 18) {
      if (max < 45) return "Black";
      if (min > 220) return "White";
      return "Gray";
    }

    const colors = [
      { name: "Red", rgb: [255, 0, 0] },
      { name: "Green", rgb: [0, 128, 0] },
      { name: "Blue", rgb: [0, 0, 255] },
      { name: "Yellow", rgb: [255, 255, 0] },
      { name: "Orange", rgb: [255, 165, 0] },
      { name: "Purple", rgb: [128, 0, 128] },
      { name: "Pink", rgb: [255, 192, 203] },
      { name: "Brown", rgb: [139, 69, 19] },
      { name: "Cyan", rgb: [0, 255, 255] },
      { name: "Magenta", rgb: [255, 0, 255] },
      { name: "Dark Green", rgb: [0, 100, 0] },
      { name: "Navy Blue", rgb: [0, 0, 128] },
    ];

    let closest = colors[0];
    let smallestDistance = Infinity;

    for (const color of colors) {
      const [cr, cg, cb] = color.rgb;

      const distance =
        2 * (r - cr) ** 2 +
        4 * (g - cg) ** 2 +
        3 * (b - cb) ** 2;

      if (distance < smallestDistance) {
        smallestDistance = distance;
        closest = color;
      }
    }

    return closest.name;
  };

  // Load an image element from its data URL.
  const loadImageElement = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to load the image."));

      img.src = src;
    });
  };

  // Estimate the average color inside an AI-detected object region.
  const getObjectColor = (img, bbox) => {
    try {
      const [x, y, width, height] = bbox;

      const left = Math.max(0, Math.floor(x));
      const top = Math.max(0, Math.floor(y));

      const right = Math.min(
        img.naturalWidth,
        Math.ceil(x + width)
      );

      const bottom = Math.min(
        img.naturalHeight,
        Math.ceil(y + height)
      );

      const cropWidth = right - left;
      const cropHeight = bottom - top;

      if (cropWidth <= 0 || cropHeight <= 0) {
        return null;
      }

      const canvas = document.createElement("canvas");

      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!context) return null;

      canvas.width = 50;
      canvas.height = 50;

      context.drawImage(
        img,
        left,
        top,
        cropWidth,
        cropHeight,
        0,
        0,
        50,
        50
      );

      const pixels = context.getImageData(0, 0, 50, 50).data;

      let totalR = 0;
      let totalG = 0;
      let totalB = 0;
      let count = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;

        totalR += pixels[i];
        totalG += pixels[i + 1];
        totalB += pixels[i + 2];
        count++;
      }

      if (!count) return null;

      const r = Math.round(totalR / count);
      const g = Math.round(totalG / count);
      const b = Math.round(totalB / count);

      return {
        name: getColorName(r, g, b),
        hex: rgbToHex(r, g, b),
        rgb: `RGB(${r}, ${g}, ${b})`,
      };
    } catch {
      return null;
    }
  };

  // Detect objects with the COCO-SSD AI model.
  const detectObjects = async (img) => {
    setModelStatus("Loading AI model...");

    const model = await loadObjectModel();

    setModelStatus("Detecting objects...");

    const predictions = await model.detect(img);

    const detectedObjects = predictions
      .filter((prediction) => prediction.score >= 0.35)
      .map((prediction, index) => {
        const objectColor = getObjectColor(img, prediction.bbox);

        return {
          id: `${prediction.class}-${index}`,
          name: prediction.class,
          confidence: Number(
            (prediction.score * 100).toFixed(1)
          ),
          bbox: prediction.bbox,
          color: objectColor,
        };
      });

    setObjects(detectedObjects);
    setModelStatus("Ready");

    return detectedObjects;
  };

  // Analyze image colors and run AI object detection.
  const analyzeImage = async () => {
    if (!preview) {
      setError("Please upload an image first.");
      return;
    }

    setLoading(true);
    setError("");
    setResults([]);
    setObjects([]);
    setAnalysisTime("");

    try {
      const img = await loadImageElement(preview);

      // Part 1: Sample image colors.
      const canvas = document.createElement("canvas");

      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!context) {
        throw new Error("Your browser does not support image analysis.");
      }

      const size = 150;

      canvas.width = size;
      canvas.height = size;

      context.drawImage(img, 0, 0, size, size);

      const pixelData = context.getImageData(
        0,
        0,
        size,
        size
      ).data;

      const buckets = {};

      for (let i = 0; i < pixelData.length; i += 4) {
        const r = pixelData[i];
        const g = pixelData[i + 1];
        const b = pixelData[i + 2];
        const alpha = pixelData[i + 3];

        if (alpha < 128) continue;

        const qr = Math.min(255, Math.round(r / 32) * 32);
        const qg = Math.min(255, Math.round(g / 32) * 32);
        const qb = Math.min(255, Math.round(b / 32) * 32);

        const key = `${qr},${qg},${qb}`;

        if (!buckets[key]) {
          buckets[key] = {
            r: 0,
            g: 0,
            b: 0,
            count: 0,
          };
        }

        buckets[key].r += r;
        buckets[key].g += g;
        buckets[key].b += b;
        buckets[key].count++;
      }

      const totalPixels = Object.values(buckets).reduce(
        (sum, bucket) => sum + bucket.count,
        0
      );

      if (totalPixels === 0) {
        throw new Error("No visible pixels were found in this image.");
      }

      const detectedColors = Object.values(buckets)
        .map((bucket) => {
          const r = Math.round(bucket.r / bucket.count);
          const g = Math.round(bucket.g / bucket.count);
          const b = Math.round(bucket.b / bucket.count);

          return {
            name: getColorName(r, g, b),
            hex: rgbToHex(r, g, b),
            rgb: `RGB(${r}, ${g}, ${b})`,
            percentage: Number(
              ((bucket.count / totalPixels) * 100).toFixed(1)
            ),
            count: bucket.count,
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      // Part 2: AI object recognition.
      let objectDetectionError = "";
      let detectedObjects = [];

      try {
        detectedObjects = await detectObjects(img);
      } catch (aiError) {
        console.error("AI object detection failed:", aiError);

        setObjects([]);
        setModelStatus("Unavailable");

        objectDetectionError =
          "Color analysis completed, but AI object detection failed. " +
          "Check your internet connection and try again.";
      }

      // Part 3: Save analysis results through the backend.
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          colors: detectedColors,
          objects: detectedObjects.map((object) => ({
            name: object.name,
            confidence: object.confidence,
            color: object.color,
          })),
          fileName: image?.name || "uploaded-image",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Backend analysis request failed."
        );
      }

      setResults(
        (data.colors || detectedColors).map((color) => ({
          ...color,
          percentage: Number(color.percentage),
        }))
      );

      setAnalysisTime(
        new Date(data.analyzedAt || Date.now()).toLocaleString()
      );

      setBackendStatus("Connected");

      // Refresh history if it has already been opened.
      if (historyLoaded) {
        fetchHistory();
      }

      if (objectDetectionError) {
        setError(objectDetectionError);
      }
    } catch (err) {
      setError(
        `${err.message} Check that the backend is running on port 5000.`
      );
    } finally {
      setLoading(false);
    }
  };

  // Speak text using browser speech synthesis.
  const speakResult = (text) => {
    if (!("speechSynthesis" in window)) {
      setError("Speech output is not supported by this browser.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = "en-IN";
    utterance.rate = 0.9;

    window.speechSynthesis.speak(utterance);
  };

  // Read all detected colors.
  const speakAllColors = () => {
    if (results.length === 0) return;

    const description = results
      .slice(0, 5)
      .map(
        (color, index) =>
          `Color ${index + 1} is ${color.name}, covering approximately ${color.percentage} percent of the sampled image.`
      )
      .join(" ");

    speakResult(description);
  };

  // Read the AI object descriptions.
  const speakAllObjects = () => {
    if (objects.length === 0) return;

    const description = objects
      .map((object) => {
        const colorText = object.color
          ? ` The approximate color in its detected region is ${object.color.name}.`
          : "";

        return (
          `${object.name}, detected with ${object.confidence} percent confidence.` +
          colorText
        );
      })
      .join(" ");

    speakResult(description);
  };

  // Speak the details of a saved analysis.
  const speakHistoryRecord = (record) => {
    const colorText = (record.colors || [])
      .slice(0, 5)
      .map((color) => `${color.name}, ${color.percentage || 0} percent`)
      .join(". ");

    const objectText = (record.objects || [])
      .map((object) => object.name)
      .join(", ");

    const description = [
      "Saved ColorSight analysis.",
      colorText ? `Detected colors: ${colorText}.` : "",
      objectText ? `Detected objects: ${objectText}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    speakResult(description);
  };

  // Format saved analysis date.
  const formatDate = (dateValue) => {
    if (!dateValue) return "Date unavailable";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "Date unavailable";
    }

    return date.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="app">
      {/* Navigation */}
      <nav className="navbar">
        <button
          className="logo"
          onClick={openHome}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span className="logo-icon">◉</span>
          ColorSight
        </button>

        <div className="nav-links">
          <button
            type="button"
            onClick={openHome}
            style={navLinkStyle(currentPage === "home")}
          >
            Home
          </button>

          <button
            type="button"
            onClick={() => {
              openHome();
              setTimeout(() => {
                document
                  .getElementById("analyzer")
                  ?.scrollIntoView({ behavior: "smooth" });
              }, 100);
            }}
            style={navLinkStyle(false)}
          >
            Color Analyzer
          </button>

          <button
            type="button"
            onClick={openHistory}
            style={navLinkStyle(currentPage === "history")}
          >
            History
          </button>

          <button
            type="button"
            onClick={() => {
              openHome();
              setTimeout(() => {
                document
                  .getElementById("about")
                  ?.scrollIntoView({ behavior: "smooth" });
              }, 100);
            }}
            style={navLinkStyle(false)}
          >
            About
          </button>
        </div>

        <button
          type="button"
          className="nav-button"
          onClick={() => {
            openHome();
            setTimeout(() => {
              document
                .getElementById("analyzer")
                ?.scrollIntoView({ behavior: "smooth" });
            }, 100);
          }}
          style={{ cursor: "pointer", border: "none" }}
        >
          Try it now ↗
        </button>
      </nav>

      {/* Backend status */}
      <div
        style={{
          textAlign: "center",
          padding: "9px",
          fontSize: "14px",
          background:
            backendStatus === "Connected" ? "#f0fdf4" : "#fff7ed",
          color:
            backendStatus === "Connected" ? "#166534" : "#9a3412",
        }}
        role="status"
        aria-live="polite"
      >
        Backend Status: {backendStatus}
      </div>

      {/* History dashboard */}
      {currentPage === "history" ? (
        <main
          style={{
            minHeight: "75vh",
            padding: "55px 7% 80px",
            background:
              "radial-gradient(ellipse at 90% 0%, #efedff 0, transparent 40%), #fbfaff",
          }}
        >
          <div
            style={{
              maxWidth: "1200px",
              margin: "0 auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "20px",
                marginBottom: "35px",
              }}
            >
              <div>
                <span className="eyebrow">YOUR SAVED RESULTS</span>

                <h1
                  style={{
                    fontSize: "clamp(32px, 5vw, 48px)",
                    margin: "12px 0",
                    color: "#22213b",
                  }}
                >
                  Analysis History
                </h1>

                <p
                  style={{
                    color: "#6e6d82",
                    maxWidth: "600px",
                    lineHeight: 1.7,
                    margin: 0,
                  }}
                >
                  View your previously analyzed images, detected colors,
                  AI-recognized objects and saved analysis times.
                </p>
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={openHome}
                >
                  ← Back to Analyzer
                </button>

                <button
                  type="button"
                  className="button primary"
                  onClick={fetchHistory}
                  disabled={loadingHistory}
                >
                  {loadingHistory ? "Refreshing..." : "↻ Refresh History"}
                </button>
              </div>
            </div>

            {/* Summary cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "18px",
                marginBottom: "30px",
              }}
            >
              <HistoryStat
                icon="📋"
                label="Total Analyses"
                value={history.length}
              />

              <HistoryStat
                icon="🎨"
                label="Color Groups"
                value={history.reduce(
                  (total, record) =>
                    total + (record.colors?.length || 0),
                  0
                )}
              />

              <HistoryStat
                icon="🤖"
                label="Detected Objects"
                value={history.reduce(
                  (total, record) =>
                    total + (record.objects?.length || 0),
                  0
                )}
              />
            </div>

            {historyError && (
              <div
                role="alert"
                style={{
                  background: "#fff1f2",
                  color: "#be123c",
                  padding: "18px",
                  borderRadius: "14px",
                  marginBottom: "24px",
                  lineHeight: 1.6,
                }}
              >
                <strong>Unable to load history</strong>
                <p style={{ marginBottom: 0 }}>{historyError}</p>

                <p style={{ marginBottom: 0, fontSize: "13px" }}>
                  Make sure the backend is running and the GET /api/history
                  endpoint returns saved records.
                </p>
              </div>
            )}

            {loadingHistory && history.length === 0 ? (
              <div style={historyEmptyStyle}>
                <div style={{ fontSize: "42px" }}>⏳</div>
                <h3>Loading your history...</h3>
                <p>Fetching saved analyses from the database.</p>
              </div>
            ) : history.length === 0 && !historyError ? (
              <div style={historyEmptyStyle}>
                <div style={{ fontSize: "48px" }}>📂</div>
                <h2>No saved analyses yet</h2>
                <p style={{ maxWidth: "500px", lineHeight: 1.7 }}>
                  Analyze an image first. Once the backend saves the result
                  to MongoDB, it will appear here.
                </p>

                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    openHome();
                    setTimeout(() => {
                      document
                        .getElementById("analyzer")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }, 100);
                  }}
                >
                  Analyze Your First Image →
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "22px" }}>
                {history.map((record, index) => (
                  <article
                    key={record._id || record.id || index}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e9e7f5",
                      borderRadius: "20px",
                      padding: "25px",
                      boxShadow: "0 8px 28px rgba(38, 31, 90, 0.05)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: "16px",
                        borderBottom: "1px solid #f0eff7",
                        paddingBottom: "18px",
                        marginBottom: "22px",
                      }}
                    >
                      <div>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 800,
                            letterSpacing: "1px",
                            color: "#7772f5",
                          }}
                        >
                          ANALYSIS #{history.length - index}
                        </span>

                        <h3
                          style={{
                            fontSize: "21px",
                            margin: "8px 0",
                            color: "#22213b",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {record.fileName || "Image Analysis"}
                        </h3>

                        <p
                          style={{
                            margin: 0,
                            color: "#77758b",
                            fontSize: "13px",
                          }}
                        >
                          🕒 {formatDate(record.analyzedAt || record.createdAt)}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="voice-button"
                        onClick={() => speakHistoryRecord(record)}
                        disabled={
                          !(record.colors?.length || record.objects?.length)
                        }
                      >
                        🔊 Listen to Results
                      </button>
                    </div>

                    {/* Saved colors */}
                    <div style={{ marginBottom: "25px" }}>
                      <h4
                        style={{
                          fontSize: "16px",
                          color: "#383650",
                          marginBottom: "15px",
                        }}
                      >
                        🎨 Detected Colors ({record.colors?.length || 0})
                      </h4>

                      {record.colors?.length ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(220px, 1fr))",
                            gap: "12px",
                          }}
                        >
                          {record.colors.map((color, colorIndex) => (
                            <div
                              key={`${color.hex || color.name}-${colorIndex}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                border: "1px solid #eeedf6",
                                borderRadius: "13px",
                                padding: "12px",
                                minWidth: 0,
                              }}
                            >
                              <div
                                style={{
                                  width: "42px",
                                  height: "42px",
                                  borderRadius: "10px",
                                  flexShrink: 0,
                                  background: color.hex || "#e5e7eb",
                                  border: "1px solid #e5e7eb",
                                }}
                                aria-label={`Color ${color.name}`}
                              />

                              <div style={{ minWidth: 0, flex: 1 }}>
                                <strong
                                  style={{
                                    display: "block",
                                    color: "#302e49",
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {color.name || "Unknown color"}
                                </strong>

                                <p
                                  style={{
                                    margin: "4px 0",
                                    fontSize: "12px",
                                    color: "#77758b",
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {color.hex || "HEX unavailable"}
                                </p>

                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: "12px",
                                    color: "#77758b",
                                  }}
                                >
                                  {color.rgb || "RGB unavailable"}
                                  {" · "}
                                  {Number(color.percentage || 0)}%
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: "#77758b", fontSize: "14px" }}>
                          No color details were saved for this analysis.
                        </p>
                      )}
                    </div>

                    {/* Saved objects */}
                    <div>
                      <h4
                        style={{
                          fontSize: "16px",
                          color: "#383650",
                          marginBottom: "15px",
                        }}
                      >
                        🤖 Detected Objects ({record.objects?.length || 0})
                      </h4>

                      {record.objects?.length ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "10px",
                          }}
                        >
                          {record.objects.map((object, objectIndex) => (
                            <div
                              key={`${object.name}-${objectIndex}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "9px",
                                padding: "11px 14px",
                                borderRadius: "12px",
                                background: "#f6f5ff",
                                border: "1px solid #e7e5ff",
                              }}
                            >
                              {object.color?.hex && (
                                <span
                                  style={{
                                    display: "inline-block",
                                    width: "19px",
                                    height: "19px",
                                    borderRadius: "6px",
                                    background: object.color.hex,
                                    border: "1px solid #ddd",
                                  }}
                                />
                              )}

                              <div>
                                <strong
                                  style={{
                                    textTransform: "capitalize",
                                    color: "#393653",
                                    fontSize: "14px",
                                  }}
                                >
                                  {object.name || "Unknown object"}
                                </strong>

                                <div
                                  style={{
                                    color: "#77758b",
                                    fontSize: "12px",
                                    marginTop: "3px",
                                  }}
                                >
                                  Confidence: {Number(object.confidence || 0)}%
                                  {object.color?.name
                                    ? ` · ${object.color.name}`
                                    : ""}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: "#77758b", fontSize: "14px" }}>
                          No object details were saved for this analysis.
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </main>
      ) : (
        /* Main ColorSight application */
        <main>
          <section className="hero" id="home">
            <div className="hero-content">
              <span className="eyebrow">
                ● ACCESSIBILITY MEETS TECHNOLOGY
              </span>

              <h1>
                See the world
                <br />
                in <span>every color.</span>
              </h1>

              <p>
                ColorSight helps people understand the colors around
                them through AI-powered object recognition, accessible
                color analysis and voice assistance.
              </p>

              <div className="hero-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    document
                      .getElementById("analyzer")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Analyze an Image ↗
                </button>

                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    document
                      .getElementById("about")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Learn more
                </button>
              </div>

              <div className="hero-note">
                <span>✓</span> Designed with accessibility in mind
              </div>
            </div>

            <div
              className="hero-art"
              aria-label="Color spectrum illustration"
            >
              <div className="color-orbit orbit-one"></div>
              <div className="color-orbit orbit-two"></div>
              <div className="color-orbit orbit-three"></div>

              <div className="color-core">
                <span>Color</span>
                <strong>∞</strong>
                <span>For everyone</span>
              </div>

              <span className="floating-dot dot-one"></span>
              <span className="floating-dot dot-two"></span>
              <span className="floating-dot dot-three"></span>
            </div>
          </section>

          <section className="analyzer section" id="analyzer">
            <div className="section-heading">
              <span className="eyebrow">YOUR COLOR ASSISTANT</span>

              <h2>Discover colors and objects in your image</h2>

              <p>
                Upload a photo to identify prominent colors, recognize
                common objects and listen to an accessible description.
              </p>
            </div>

            <div className="workspace">
              {/* Upload panel */}
              <div className="panel upload-panel">
                <div className="panel-title">
                  <div>
                    <span className="step-label">STEP 01</span>
                    <h3>Upload an image</h3>
                  </div>

                  <span className="panel-icon">↑</span>
                </div>

                <label className="upload-area">
                  {preview ? (
                    <img
                      src={preview}
                      alt="Uploaded preview"
                      className="preview"
                    />
                  ) : (
                    <>
                      <div className="upload-icon">↑</div>
                      <strong>Drop your image here</strong>
                      <span>or click to browse your files</span>
                      <small>PNG, JPG, WEBP · Maximum 10 MB</small>
                    </>
                  )}

                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUpload}
                    hidden
                  />
                </label>

                {image && (
                  <p className="file-name">
                    Selected: {image.name}
                  </p>
                )}

                <button
                  className="button primary analyze-button"
                  onClick={analyzeImage}
                  disabled={!preview || loading}
                >
                  {loading ? "Analyzing image with AI..." : "Analyze Image →"}
                </button>

                <p
                  style={{
                    fontSize: "13px",
                    color: "#64748b",
                    marginTop: "12px",
                  }}
                  role="status"
                  aria-live="polite"
                >
                  AI Model: {modelStatus}
                </p>

                {error && (
                  <p className="error-message" role="alert">
                    {error}
                  </p>
                )}
              </div>

              {/* Color results */}
              <div className="panel result-panel">
                <div className="panel-title">
                  <div>
                    <span className="step-label">STEP 02</span>
                    <h3>Color analysis</h3>
                  </div>

                  <span className="panel-icon">✳</span>
                </div>

                {results.length === 0 ? (
                  <div className="empty-results">
                    <div className="empty-icon">◉</div>
                    <h4>Your results will appear here</h4>
                    <p>
                      Upload an image and select Analyze Image to discover
                      its prominent colors and objects.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="result-summary">
                      <strong>
                        {results.length} color groups detected
                      </strong>

                      <button
                        className="voice-button"
                        onClick={speakAllColors}
                      >
                        🔊 Read colors
                      </button>
                    </div>

                    <div className="color-results">
                      {results.map((color, index) => (
                        <div
                          className="color-result"
                          key={`${color.hex}-${index}`}
                        >
                          <div
                            className="color-swatch"
                            style={{ backgroundColor: color.hex }}
                          />

                          <div className="color-info">
                            <strong>{color.name}</strong>

                            <span>
                              {color.hex} · {color.rgb}
                            </span>

                            <div className="percentage-track">
                              <div
                                className="percentage-fill"
                                style={{
                                  width: `${color.percentage}%`,
                                  backgroundColor: color.hex,
                                }}
                              />
                            </div>
                          </div>

                          <div className="color-percentage">
                            {color.percentage}%
                          </div>

                          <button
                            className="speak-single"
                            title={`Speak ${color.name}`}
                            aria-label={`Speak ${color.name}`}
                            onClick={() =>
                              speakResult(
                                `The detected color is ${color.name}. Its hexadecimal code is ${color.hex}.`
                              )
                            }
                          >
                            🔊
                          </button>
                        </div>
                      ))}
                    </div>

                    {analysisTime && (
                      <p className="analysis-note">
                        Analysis saved at: {analysisTime}
                      </p>
                    )}

                    <p className="analysis-note">
                      Color names are approximate matches. Percentages
                      represent sampled image pixels, not a clinical
                      color-blindness assessment.
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* AI Object Recognition Results */}
            <div
              className="panel"
              style={{ marginTop: "24px", padding: "24px" }}
            >
              <div className="panel-title">
                <div>
                  <span className="step-label">STEP 03</span>
                  <h3>AI Object Recognition</h3>
                </div>

                <span className="panel-icon">✧</span>
              </div>

              {objects.length === 0 ? (
                <div className="empty-results">
                  <div className="empty-icon">✧</div>
                  <h4>AI object results will appear here</h4>
                  <p>
                    Analyze an image to identify supported objects
                    and estimate the color in each detected region.
                  </p>
                </div>
              ) : (
                <>
                  <div className="result-summary">
                    <strong>
                      {objects.length} object
                      {objects.length === 1 ? "" : "s"} detected
                    </strong>

                    <button
                      className="voice-button"
                      onClick={speakAllObjects}
                    >
                      🔊 Read object descriptions
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "14px",
                      marginTop: "18px",
                    }}
                  >
                    {objects.map((object) => (
                      <article
                        key={object.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "14px",
                          padding: "18px",
                          background: "#ffffff",
                        }}
                      >
                        <h4
                          style={{
                            textTransform: "capitalize",
                            margin: "0 0 8px",
                            fontSize: "18px",
                          }}
                        >
                          {object.name}
                        </h4>

                        <p
                          style={{
                            margin: "0 0 12px",
                            color: "#64748b",
                            fontSize: "14px",
                          }}
                        >
                          AI confidence: {object.confidence}%
                        </p>

                        <div
                          style={{
                            height: "7px",
                            background: "#e2e8f0",
                            borderRadius: "10px",
                            overflow: "hidden",
                            marginBottom: "14px",
                          }}
                        >
                          <div
                            style={{
                              width: `${object.confidence}%`,
                              height: "100%",
                              background: "#16a34a",
                              borderRadius: "10px",
                            }}
                          />
                        </div>

                        {object.color ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                          >
                            <span
                              aria-label={`Approximate region color: ${object.color.name}`}
                              style={{
                                display: "inline-block",
                                width: "28px",
                                height: "28px",
                                flexShrink: 0,
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                background: object.color.hex,
                              }}
                            />

                            <div>
                              <strong>{object.color.name}</strong>

                              <p
                                style={{
                                  margin: "3px 0 0",
                                  fontSize: "12px",
                                  color: "#64748b",
                                }}
                              >
                                {object.color.hex} · {object.color.rgb}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p>Region color unavailable.</p>
                        )}
                      </article>
                    ))}
                  </div>

                  <p className="analysis-note">
                    AI confidence is a model score, not a guarantee.
                    Region colors are approximate averages and may include
                    background pixels. Objects that are small, obscured or
                    outside the model's supported classes may not be detected.
                  </p>
                </>
              )}
            </div>
          </section>

          {/* About */}
          <section className="about section" id="about">
            <div className="section-heading">
              <span className="eyebrow">WHY COLORSIGHT?</span>

              <h2>Technology for a more colorful world</h2>

              <p>
                A student project exploring ways technology can make
                visual information more accessible.
              </p>
            </div>

            <div className="features">
              <article className="feature-card">
                <div className="feature-icon">◉</div>
                <h3>Color identification</h3>
                <p>
                  Detect prominent color groups in an uploaded image
                  and display approximate color names and HEX codes.
                </p>
              </article>

              <article className="feature-card">
                <div className="feature-icon">✧</div>
                <h3>AI object recognition</h3>
                <p>
                  Use an in-browser machine-learning model to identify
                  supported objects and estimate colors in their regions.
                </p>
              </article>

              <article className="feature-card">
                <div className="feature-icon">🔊</div>
                <h3>Voice assistance</h3>
                <p>
                  Listen to detected color and object descriptions
                  using your browser's built-in speech synthesis.
                </p>
              </article>
            </div>
          </section>
        </main>
      )}

      {/* Footer */}
      <footer>
        <button
          className="logo"
          onClick={openHome}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span className="logo-icon">◉</span>
          ColorSight
        </button>

        <p>Making color information more accessible to everyone.</p>

        <span>Final Year B.Tech Project</span>
      </footer>
    </div>
  );
}

// Navigation styles.
function navLinkStyle(active) {
  return {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    font: "inherit",
    fontWeight: active ? 700 : 500,
    color: active ? "#7772f5" : "#6e6d82",
    padding: "8px 4px",
  };
}

// History summary card.
function HistoryStat({ icon, label, value }) {
  return (
    <article
      style={{
        background: "#ffffff",
        border: "1px solid #e9e7f5",
        borderRadius: "18px",
        padding: "23px",
        boxShadow: "0 8px 28px rgba(38, 31, 90, 0.04)",
      }}
    >
      <div style={{ fontSize: "27px", marginBottom: "12px" }}>
        {icon}
      </div>

      <div
        style={{
          color: "#77758b",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        {label}
      </div>

      <div
        style={{
          color: "#272541",
          fontSize: "32px",
          fontWeight: 800,
          marginTop: "5px",
        }}
      >
        {value}
      </div>
    </article>
  );
}

const historyEmptyStyle = {
  background: "#ffffff",
  border: "1px dashed #d8d5ef",
  borderRadius: "22px",
  padding: "55px 20px",
  textAlign: "center",
  color: "#6e6d82",
};

export default App;