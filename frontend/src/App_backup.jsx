import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000";

function App() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [analysisTime, setAnalysisTime] = useState("");

  // Check whether backend is available.
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

  // Upload and preview image.
  const handleUpload = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setError("");
    setResults([]);
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

  // Convert RGB values into HEX.
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

  // Estimate a readable color name.
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

      // Weighted distance approximates human sensitivity to RGB differences.
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

  // Analyze pixels and send the resulting color data to the backend.
  const analyzeImage = async () => {
    if (!preview) {
      setError("Please upload an image first.");
      return;
    }

    setLoading(true);
    setError("");
    setResults([]);
    setAnalysisTime("");

    try {
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Unable to load the image."));
        img.src = preview;
      });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!context) {
        throw new Error("Your browser does not support image analysis.");
      }

      // Sample a resized copy of the image.
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

        // Group similar shades.
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
        buckets[key].count += 1;
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

      // Send detected colors to the backend.
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          colors: detectedColors,
          fileName: image?.name || "uploaded-image",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Backend analysis request failed.");
      }

      setResults(
        data.colors.map((color) => ({
          ...color,
          percentage: Number(color.percentage),
        }))
      );

      setAnalysisTime(new Date(data.analyzedAt).toLocaleString());
      setBackendStatus("Connected");
    } catch (err) {
      setError(
        `${err.message} Check that the backend is running on port 5000.`
      );
    } finally {
      setLoading(false);
    }
  };

  // Speak a description using the browser's speech synthesis.
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

  return (
    <div className="app">
      <nav className="navbar">
        <a className="logo" href="#home">
          <span className="logo-icon">◉</span>
          ColorSight
        </a>

        <div className="nav-links">
          <a href="#home">Home</a>
          <a href="#analyzer">Color Analyzer</a>
          <a href="#about">About</a>
        </div>

        <a href="#analyzer" className="nav-button">
          Try it now ↗
        </a>
      </nav>

      <div
        style={{
          textAlign: "center",
          padding: "9px",
          fontSize: "14px",
          background: backendStatus === "Connected" ? "#f0fdf4" : "#fff7ed",
          color: backendStatus === "Connected" ? "#166534" : "#9a3412",
        }}
        role="status"
        aria-live="polite"
      >
        Backend Status: {backendStatus}
      </div>

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
              them through accessible color analysis and voice
              assistance.
            </p>

            <div className="hero-actions">
              <a href="#analyzer" className="button primary">
                Analyze an Image ↗
              </a>

              <a href="#about" className="button secondary">
                Learn more
              </a>
            </div>

            <div className="hero-note">
              <span>✓</span> Designed with accessibility in mind
            </div>
          </div>

          <div className="hero-art" aria-label="Color spectrum illustration">
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
            <h2>Discover the colors in your image</h2>
            <p>
              Upload a photo to identify its prominent colors and
              listen to an accessible description.
            </p>
          </div>

          <div className="workspace">
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

              {image && <p className="file-name">Selected: {image.name}</p>}

              <button
                className="button primary analyze-button"
                onClick={analyzeImage}
                disabled={!preview || loading}
              >
                {loading ? "Analyzing colors..." : "Analyze Colors →"}
              </button>

              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
            </div>

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
                    Upload an image and select Analyze Colors to
                    discover its prominent colors.
                  </p>
                </div>
              ) : (
                <>
                  <div className="result-summary">
                    <strong>{results.length} colors detected</strong>
                    <button
                      className="voice-button"
                      onClick={speakAllColors}
                    >
                      🔊 Read all colors
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
                      Backend received the color data at: {analysisTime}
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
        </section>

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
              <div className="feature-icon">🔊</div>
              <h3>Voice assistance</h3>
              <p>
                Listen to detected color names using your browser's
                built-in speech synthesis.
              </p>
            </article>

            <article className="feature-card">
              <div className="feature-icon">◇</div>
              <h3>Accessible interface</h3>
              <p>
                Clear labels, readable results and simple controls
                help make color information easier to explore.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer>
        <a className="logo" href="#home">
          <span className="logo-icon">◉</span>
          ColorSight
        </a>

        <p>Making color information more accessible to everyone.</p>

        <span>Final Year B.Tech Project</span>
      </footer>
    </div>
  );
}

export default App;