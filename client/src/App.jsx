import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactQuill, { Quill } from "react-quill";
import "react-quill/dist/quill.snow.css";
import { auth, db, storage } from "./firebase.js";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp, updateDoc, doc, arrayUnion } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

const SERVER_URL = "https://suryarepooffi.onrender.com";
const ALLOWED_EMAILS = ["subeeshpacl@gmail.com"];

const PAGE_SIZES = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  Passport: { w: 192, h: 192 }
};

const PASSPORT_SIZES = {
  usa: { label: "USA (2x2 in)", w: 600, h: 600 },
  india: { label: "India (35x45 mm)", w: 413, h: 531 },
  uk: { label: "UK (35x45 mm)", w: 413, h: 531 },
  schengen: { label: "Schengen (35x45 mm)", w: 413, h: 531 },
  canada: { label: "Canada (50x70 mm)", w: 591, h: 827 }
};

const fallbackThemes = {
  light: { bg: "#ffffff", accent: "#111827" },
  dark: { bg: "#0b1020", accent: "#e5e7eb" },
  ocean: { bg: "#0b1d2a", accent: "#7dd3fc" },
  sunset: { bg: "#2a0b1d", accent: "#fb7185" }
};

const Font = Quill.import("formats/font");
Font.whitelist = ["serif", "monospace", "sans"];
Quill.register(Font, true);

export default function App() {
  const [view, setView] = useState("home");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authInFlight, setAuthInFlight] = useState(false);
  const [editorHtml, setEditorHtml] = useState("<p>Drop your ideas here...</p><p><br/></p><p>Export them as a styled PDF.</p>");
  const [themes, setThemes] = useState(fallbackThemes);
  const [themeKey, setThemeKey] = useState("ocean");
  const [siteTheme, setSiteTheme] = useState("dark");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [pageSize, setPageSize] = useState("A4");
  const [orientation, setOrientation] = useState("portrait");
  const [margin, setMargin] = useState(48);
  const [exportFormat, setExportFormat] = useState("pdf");
  const [passportSizeKey, setPassportSizeKey] = useState("usa");
  const [imagePdfOptions, setImagePdfOptions] = useState({
    fitToImage: false,
    compressImages: false,
    imageQuality: 0.8
  });
  const [passportAi, setPassportAi] = useState({
    faceCrop: true,
    bgRemove: true,
    autoCenter: true,
    eyeGuides: true,
    redEye: true,
    lighting: true
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [manglishEnabled, setManglishEnabled] = useState(false);
  const [manglishError, setManglishError] = useState("");
  const [manglishSuggestions, setManglishSuggestions] = useState([]);
  const [manglishRange, setManglishRange] = useState(null);
  const [jpegImages, setJpegImages] = useState([]);
  const [jpegLoading, setJpegLoading] = useState(false);
  const [passportPreviews, setPassportPreviews] = useState([]);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectForm, setProjectForm] = useState({
    title: "",
    description: "",
    date: "",
    files: [],
    status: "pending",
    paidStatus: "unpaid"
  });
  const [projectItems, setProjectItems] = useState([{ item: "", quantity: "", price: "" }]);
  const [projects, setProjects] = useState([]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectPaidFilter, setProjectPaidFilter] = useState("all");
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editorProjectId, setEditorProjectId] = useState("");
  const [jpegProjectId, setJpegProjectId] = useState("");
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableValues, setTableValues] = useState(() => Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 0)));
  const editorRef = useRef(null);
  const applyingRef = useRef(false);
  const suggestTimerRef = useRef(null);
  const abortRef = useRef(null);
  const lastWordRef = useRef("");
  const aiRef = useRef({
    ready: false,
    detector: null,
    segmenter: null,
    faceLandmarksDetection: null,
    bodyPix: null
  });
  const aiLoadPromiseRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch(`${SERVER_URL}/api/themes`)
      .then((res) => res.json())
      .then((data) => {
        if (mounted && data) setThemes(data);
      })
      .catch(() => {
        // ignore and fallback
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.theme = siteTheme;
    document.documentElement.style.colorScheme = siteTheme === "light" ? "light" : "dark";
  }, [siteTheme]);

  const selectedTheme = useMemo(() => themes[themeKey] || fallbackThemes.light, [themes, themeKey]);
  const [jobs, setJobs] = useState([]);
  const themeKeys = useMemo(() => Object.keys(themes || fallbackThemes), [themes]);
  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = projectStatusFilter === "all" || project.status === projectStatusFilter;
      const matchesPaid = projectPaidFilter === "all" || project.paidStatus === projectPaidFilter;
      const haystack = [
        project.title,
        project.description,
        project.date,
        project.files ? project.files.map((file) => file.name).join(" ") : ""
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      return matchesStatus && matchesPaid && matchesSearch;
    });
  }, [projects, projectSearch, projectStatusFilter, projectPaidFilter]);

  

  const plainText = useMemo(() => {
    const tmp = document.createElement("div");
    tmp.innerHTML = editorHtml || "";
    return tmp.textContent || tmp.innerText || "";
  }, [editorHtml]);

  const pageDimensions = useMemo(() => {
    if (pageSize === "Passport") {
      const selected = PASSPORT_SIZES[passportSizeKey] || PASSPORT_SIZES.usa;
      return { width: selected.w, height: selected.h };
    }
    const size = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
    if (orientation === "landscape") {
      return { width: size.h, height: size.w };
    }
    return { width: size.w, height: size.h };
  }, [pageSize, orientation, passportSizeKey]);

  const previewPages = useMemo(() => {
    const html = editorHtml || "";
    const pieces = html.split(/<hr[^>]*class=["']page-break["'][^>]*>/gi);
    const cleaned = pieces.map((piece) => piece.trim());
    return cleaned.filter((piece) => piece.length);
  }, [editorHtml]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setAuthError("");
      const currentEmail = currentUser?.email?.toLowerCase() || "";
      if (currentEmail && !ALLOWED_EMAILS.includes(currentEmail)) {
        await signOut(auth);
        setUser(null);
        setAuthLoading(false);
        setJobs([]);
        setAuthError("Access denied. Your email is not on the allowlist.");
        return;
      }

      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setJobs(data);
        const projectQuery = query(collection(db, "projects"), orderBy("createdAt", "desc"));
        const projectSnapshot = await getDocs(projectQuery);
        const projectData = projectSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setProjects(projectData);
      } else {
        setJobs([]);
        setProjects([]);
      }
    });
    return () => unsub();
  }, []);

  const handleGoogleLogin = async () => {
    if (authInFlight) return;
    setAuthError("");
    try {
      setAuthInFlight(true);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account"
      });
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = err?.code || "";
      const messageMap = {
        "auth/popup-closed-by-user": "Sign-in popup closed.",
        "auth/cancelled-popup-request": "Sign-in was cancelled.",
        "auth/popup-blocked": "Popup blocked. Allow popups and try again.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
        "auth/network-request-failed": "Network error. Check your connection and try again."
      };
      setAuthError(messageMap[code] || err?.message || "Login failed.");
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setView("home");
  };

  useEffect(() => {
    if (!manglishEnabled) {
      setManglishSuggestions([]);
      setManglishRange(null);
      setManglishError("");
    }
  }, [manglishEnabled]);

  useEffect(() => {
    if (pageSize === "Passport" && exportFormat === "pdf") {
      setExportFormat("jpeg");
    }
    if (pageSize !== "Passport" && exportFormat !== "pdf") {
      setExportFormat("pdf");
    }
    if (pageSize === "Fit") {
      setImagePdfOptions((prev) => ({ ...prev, fitToImage: true }));
    }
  }, [pageSize, exportFormat]);

  useEffect(() => {
    const needsAi =
      pageSize === "Passport" &&
      (passportAi.faceCrop || passportAi.bgRemove || passportAi.autoCenter || passportAi.redEye || passportAi.lighting);
    if (needsAi) {
      ensureAiModels();
    }
  }, [pageSize, passportAi]);

  const resizeTable = (rows, cols) => {
    setTableValues((prev) => {
      const next = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (prev[r] && prev[r][c] != null ? prev[r][c] : 0))
      );
      return next;
    });
  };

  const distributeTotalEvenly = (total, rows = tableRows, cols = tableCols) => {
    const count = rows * cols;
    if (!count) return;
    const perCell = total / count;
    setTableValues(Array.from({ length: rows }, () => Array.from({ length: cols }, () => perCell)));
  };

  const handleTableTotalChange = (value) => {
    const total = Number(value) || 0;
    setTableTotal(total);
    distributeTotalEvenly(total);
  };

  const handleTableCellChange = (rowIdx, colIdx, value) => {
    const nextValues = tableValues.map((row) => row.map((cell) => cell));
    nextValues[rowIdx][colIdx] = Number(value) || 0;
    const rows = nextValues.length;
    const cols = rows ? nextValues[0].length : 0;
    const count = rows * cols;
    if (count <= 1) {
      nextValues[rowIdx][colIdx] = tableTotal;
      setTableValues(nextValues);
      return;
    }
    const sum = nextValues.flat().reduce((acc, cell) => acc + (Number(cell) || 0), 0);
    const remaining = tableTotal - sum;
    const remainingCount = count - 1;
    const delta = remaining / remainingCount;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (r === rowIdx && c === colIdx) continue;
        nextValues[r][c] = (Number(nextValues[r][c]) || 0) + delta;
      }
    }
    setTableValues(nextValues);
  };


  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await generatePassportPreviews();
    };
    run().catch(() => {
      if (!cancelled) setPassportPreviews([]);
    });
    return () => {
      cancelled = true;
    };
  }, [pageSize, passportSizeKey, passportAi, jpegImages]);

  const ensureAiModels = async () => {
    if (aiRef.current.ready) return;
    if (aiLoadPromiseRef.current) {
      await aiLoadPromiseRef.current;
      return;
    }
    setAiLoading(true);
    const loadPromise = (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        const faceLandmarksDetection = await import("@tensorflow-models/face-landmarks-detection");
        const bodyPix = await import("@tensorflow-models/body-pix");
        const detector = await faceLandmarksDetection.createDetector(
          faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
          { runtime: "tfjs", refineLandmarks: true }
        );
        const segmenter = await bodyPix.load({
          architecture: "MobileNetV1",
          outputStride: 16,
          multiplier: 0.75,
          quantBytes: 2
        });
        aiRef.current = { ready: true, detector, segmenter, faceLandmarksDetection, bodyPix };
      } catch (err) {
        console.error("AI model load failed:", err);
      }
    })()
      .catch((err) => console.error(err))
      .finally(() => {
        aiLoadPromiseRef.current = null;
        setAiLoading(false);
      });
    aiLoadPromiseRef.current = loadPromise;
    await loadPromise;
  };

  const getEyeCenter = (keypoints, side) => {
    if (!Array.isArray(keypoints)) return null;
    const matches = keypoints.filter((pt) => {
      const name = String(pt?.name || "").toLowerCase();
      return name.includes(side) && name.includes("eye");
    });
    if (!matches.length) return null;
    const sum = matches.reduce(
      (acc, pt) => ({ x: acc.x + (pt.x || 0), y: acc.y + (pt.y || 0) }),
      { x: 0, y: 0 }
    );
    return { x: sum.x / matches.length, y: sum.y / matches.length };
  };

  const applyAutoLevels = (ctx, width, height) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (max <= min + 1) return;
    const scale = 255 / (max - min);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, (data[i] - min) * scale));
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - min) * scale));
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - min) * scale));
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const reduceRedEye = (ctx, width, height, leftEye, rightEye) => {
    if (!leftEye || !rightEye) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const eyeSize = Math.max(14, Math.round(width * 0.06));
    const areas = [leftEye, rightEye].map((eye) => ({
      x: Math.max(0, Math.round(eye.x - eyeSize / 2)),
      y: Math.max(0, Math.round(eye.y - eyeSize / 2)),
      w: Math.min(width, Math.round(eyeSize)),
      h: Math.min(height, Math.round(eyeSize))
    }));
    areas.forEach((area) => {
      for (let y = area.y; y < area.y + area.h; y += 1) {
        for (let x = area.x; x < area.x + area.w; x += 1) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          if (r > g * 1.4 && r > b * 1.4) {
            data[idx] = Math.round((g + b) / 2);
          }
        }
      }
    });
    ctx.putImageData(imageData, 0, 0);
  };

  const removeBackground = async (sourceCanvas) => {
    if (!aiRef.current.segmenter) return sourceCanvas;
    const { width, height } = sourceCanvas;
    const seg = await aiRef.current.segmenter.segmentPerson(sourceCanvas, {
      internalResolution: "medium",
      segmentationThreshold: 0.7
    });
    const ctx = sourceCanvas.getContext("2d");
    if (!ctx) return sourceCanvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < seg.data.length; i += 1) {
      if (seg.data[i] === 0) {
        data[i * 4 + 3] = 0;
      }
    }
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const outCtx = out.getContext("2d");
    if (!outCtx) return sourceCanvas;
    outCtx.putImageData(imageData, 0, 0);
    return out;
  };

  const processPassportImage = async (img, outputWidth, outputHeight) => {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = img.width;
    sourceCanvas.height = img.height;
    const sourceCtx = sourceCanvas.getContext("2d");
    if (!sourceCtx) return null;
    sourceCtx.drawImage(img, 0, 0);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) return null;
    outputCtx.fillStyle = "#ffffff";
    outputCtx.fillRect(0, 0, outputWidth, outputHeight);

    let faceBox = null;
    let leftEye = null;
    let rightEye = null;
    if (passportAi.faceCrop || passportAi.autoCenter || passportAi.redEye) {
      await ensureAiModels();
      if (aiRef.current.detector) {
        const faces = await aiRef.current.detector.estimateFaces(sourceCanvas, { flipHorizontal: false });
        const face = faces && faces[0];
        if (face?.box) {
          faceBox = {
            x: face.box.xMin,
            y: face.box.yMin,
            width: face.box.xMax - face.box.xMin,
            height: face.box.yMax - face.box.yMin
          };
        }
        const keypoints = face?.keypoints || [];
        const left = getEyeCenter(keypoints, "left");
        const right = getEyeCenter(keypoints, "right");
        if (left && right) {
          leftEye = left;
          rightEye = right;
        }
      }
    }

    let preparedCanvas = sourceCanvas;
    if (passportAi.bgRemove) {
      await ensureAiModels();
      preparedCanvas = await removeBackground(preparedCanvas);
    }

    const targetCenterX = outputWidth * 0.5;
    const targetEyeY = outputHeight * 0.45;
    const targetTopY = outputHeight * 0.18;
    const targetChinY = outputHeight * 0.74;
    const hasFaceAnchor = Boolean(faceBox || (leftEye && rightEye));
    const faceHeight = faceBox?.height || img.height * 0.6;
    const desiredFaceHeight = targetChinY - targetTopY;
    const scale = (passportAi.autoCenter || passportAi.faceCrop) && hasFaceAnchor
      ? (desiredFaceHeight / faceHeight) * 0.85
      : Math.max(outputWidth / img.width, outputHeight / img.height);
    const faceCenterX = faceBox ? faceBox.x + faceBox.width / 2 : img.width / 2;
    const eyeX = leftEye && rightEye ? (leftEye.x + rightEye.x) / 2 : faceCenterX;
    const eyeY = leftEye && rightEye ? (leftEye.y + rightEye.y) / 2 : faceBox ? faceBox.y + faceBox.height * 0.35 : img.height / 2;
    const dx = targetCenterX - eyeX * scale;
    const dy = targetEyeY - eyeY * scale;

    outputCtx.save();
    outputCtx.drawImage(preparedCanvas, dx, dy, img.width * scale, img.height * scale);
    outputCtx.restore();

    if (passportAi.lighting) {
      applyAutoLevels(outputCtx, outputWidth, outputHeight);
    }

    if (passportAi.redEye && leftEye && rightEye) {
      const scaleX = img.width * scale / img.width;
      const scaleY = img.height * scale / img.height;
      const mappedLeft = { x: dx + leftEye.x * scaleX, y: dy + leftEye.y * scaleY };
      const mappedRight = { x: dx + rightEye.x * scaleX, y: dy + rightEye.y * scaleY };
      reduceRedEye(outputCtx, outputWidth, outputHeight, mappedLeft, mappedRight);
    }

    return outputCanvas;
  };

  const generatePassportPreviews = async () => {
    if (pageSize !== "Passport" || !jpegImages.length) {
      setPassportPreviews([]);
      return;
    }
    const selectedPassport = PASSPORT_SIZES[passportSizeKey] || PASSPORT_SIZES.usa;
    const targetWidth = selectedPassport.w;
    const targetHeight = selectedPassport.h;
    const previewTasks = jpegImages.map(
      (img) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            Promise.resolve(processPassportImage(image, targetWidth, targetHeight))
              .then((canvas) => {
                if (!canvas) return resolve(null);
                resolve(canvas.toDataURL("image/jpeg", 0.9));
              })
              .catch(() => resolve(null));
          };
          image.src = img.dataUrl;
        })
    );
    const results = await Promise.all(previewTasks);
    setPassportPreviews(results.filter(Boolean));
  };

  const handleImageInsert = () => {
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.click();
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const quill = editorRef.current?.getEditor();
        const range = quill?.getSelection(true);
        if (quill && range) {
          quill.insertEmbed(range.index, "image", reader.result, "user");
          quill.setSelection(range.index + 1, 0);
        }
      };
      reader.readAsDataURL(file);
    };
  };

  const handleInsertPageBreak = () => {
    const quill = editorRef.current?.getEditor();
    const range = quill?.getSelection(true);
    if (!quill || !range) return;
    quill.clipboard.dangerouslyPasteHTML(range.index, "<hr class=\"page-break\" />");
    quill.setSelection(range.index + 1, 0);
  };

  const getCurrentWordRange = (editor) => {
    const selection = editor.getSelection();
    const cursor = selection?.index ?? editor.getLength();
    const text = editor.getText(0, cursor);
    let end = cursor;
    let start = end;
    while (start > 0 && /[A-Za-z]/.test(text[start - 1])) start -= 1;
    if (start === end) return null;
    return { start, end, word: text.slice(start, end) };
  };

  const applySuggestion = (editor, suggestion, rangeOverride) => {
    const range = rangeOverride || getCurrentWordRange(editor);
    if (!range || !suggestion) return null;
    const { start, end } = range;
    const formats = editor.getFormat(start, end - start);
    applyingRef.current = true;
    editor.deleteText(start, end - start, "api");
    editor.insertText(start, suggestion, formats, "api");
    editor.setSelection(start + suggestion.length, 0, "api");
    applyingRef.current = false;
    setManglishSuggestions([]);
    setManglishRange(null);
    lastWordRef.current = "";
    return start + suggestion.length;
  };

  const updateSuggestion = (editor) => {
    if (!manglishEnabled) return;
    const range = getCurrentWordRange(editor);
    if (!range || !range.word) {
      setManglishSuggestions([]);
      setManglishRange(null);
      return;
    }
    const word = range.word;
    if (!/[A-Za-z]/.test(word) || word.length < 2) {
      setManglishSuggestions([]);
      setManglishRange(null);
      return;
    }
    if (word === lastWordRef.current) return;
    lastWordRef.current = word;
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(async () => {
      try {
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch(`${SERVER_URL}/api/manglish?text=${encodeURIComponent(word)}`, {
          signal: controller.signal
        });
        const data = await res.json();
        const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setManglishSuggestions(suggestions);
        setManglishRange({ start: range.start, end: range.end });
        setManglishError("");
      } catch (err) {
        if (err?.name === "AbortError") return;
        setManglishSuggestions([]);
        setManglishRange(null);
        setManglishError("Manglish suggestions failed.");
      }
    }, 120);
  };

  const handleEditorChange = (content, delta, source, editor) => {
    setEditorHtml(content);
    if (applyingRef.current) return;
    updateSuggestion(editor);
  };

  const handleEditorKeyDown = (event) => {
    if (!manglishEnabled) return;
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const firstSuggestion = manglishSuggestions[0];
    if (event.key === "Tab" && firstSuggestion && manglishRange) {
      event.preventDefault();
      applySuggestion(editor, firstSuggestion, {
        ...manglishRange,
        word: editor.getText(manglishRange.start, manglishRange.end - manglishRange.start)
      });
      return;
    }
    if ((event.key === " " || event.key === "Enter") && firstSuggestion && manglishRange) {
      event.preventDefault();
      const index = applySuggestion(editor, firstSuggestion, {
        ...manglishRange,
        word: editor.getText(manglishRange.start, manglishRange.end - manglishRange.start)
      });
      if (index != null) {
        const insertChar = event.key === "Enter" ? "\n" : " ";
        editor.insertText(index, insertChar, "api");
        editor.setSelection(index + 1, 0, "api");
      }
    }
  };

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ font: [] }, { size: ["small", false, "large", "huge"] }],
          ["bold", "italic", "underline", "strike"],
          [{ color: [] }, { background: [] }],
          [{ script: "sub" }, { script: "super" }],
          [{ header: 1 }, { header: 2 }, "blockquote", "code-block"],
          [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
          [{ align: [] }],
          ["link", "image"],
          ["clean"]
        ],
        handlers: {
          image: handleImageInsert
        }
      }
    }),
    []
  );

  const formats = [
    "font",
    "size",
    "bold",
    "italic",
    "underline",
    "strike",
    "color",
    "background",
    "script",
    "header",
    "blockquote",
    "code-block",
    "list",
    "indent",
    "align",
    "link",
    "image"
  ];

  const handleDownload = async () => {
    if (!plainText.trim()) {
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: editorHtml,
          theme: themeKey,
          fontColor,
          title: "Text to PDF",
          pageSize,
          orientation,
          margin
        })
      });

      if (!res.ok) {
        let message = "Failed to convert";
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
          if (data?.detail) message = `${message} ${data.detail}`;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "text-to-pdf.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      if (user) {
        const newJob = {
          name: `Text Export ${new Date().toLocaleTimeString()}`,
          type: "Text PDF",
          date: "Just now",
          createdAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, "jobs"), newJob);
        setJobs((prev) => [{ id: docRef.id, ...newJob }, ...prev].slice(0, 6));
      }
      if (editorProjectId) {
        await recordProjectDownload(editorProjectId, {
          name: "text-to-pdf.pdf",
          kind: "editor",
          format: "pdf",
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error(err);
      alert("Conversion failed. Check the server and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJpegUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const readers = files.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
          reader.readAsDataURL(file);
        })
    );
    const results = await Promise.all(readers);
    setJpegImages((prev) => [...prev, ...results]);
    event.target.value = "";
  };

  const removeJpegImage = (index) => {
    setJpegImages((prev) => prev.filter((_, i) => i !== index));
  };

  const clearJpegImages = () => setJpegImages([]);

  const moveJpegImage = (from, to) => {
    setJpegImages((prev) => {
      const copy = [...prev];
      const item = copy.splice(from, 1)[0];
      copy.splice(to, 0, item);
      return copy;
    });
  };

  const updateProjectField = (field, value) => {
    setProjectForm((prev) => ({ ...prev, [field]: value }));
  };

  const addProjectFiles = (files) => {
    setProjectForm((prev) => ({
      ...prev,
      files: [...(prev.files || []), ...files]
    }));
  };

  const updateProjectItem = (index, field, value) => {
    setProjectItems((prev) => prev.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)));
  };

  const addProjectItem = () => {
    setProjectItems((prev) => [...prev, { item: "", quantity: "", price: "" }]);
  };

  const removeProjectItem = (index) => {
    setProjectItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const computeProjectTotal = (items) =>
    items.reduce((sum, row) => {
      const qty = Number(row.quantity) || 0;
      const price = Number(row.price) || 0;
      return sum + qty * price;
    }, 0);

  const uploadProjectFiles = async (projectId, files) => {
    if (!files.length) return [];
    const uploads = files.map(async (file) => {
      const nameSafe = file.name.replace(/\s+/g, "_");
      const fileRef = storageRef(storage, `projects/${projectId}/${Date.now()}-${nameSafe}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      return {
        name: file.name,
        size: file.size,
        type: file.type,
        url
      };
    });
    return Promise.all(uploads);
  };

  const handleProjectSubmit = async () => {
    const cleanedItems = projectItems
      .filter((row) => row.item || row.quantity || row.price)
      .map((row) => ({
        ...row,
        quantity: Number(row.quantity) || 0,
        price: Number(row.price) || 0
      }));
    const total = computeProjectTotal(cleanedItems);
    const existingFiles = (projectForm.files || []).filter((file) => file && file.url);
    const newFiles = (projectForm.files || []).filter((file) => file instanceof File);
    const newProject = {
      ...projectForm,
      files: [],
      items: cleanedItems,
      total
    };
    try {
      if (user) {
        const isLocalId = editingProjectId && editingProjectId.startsWith("p-");
        if (editingProjectId && !isLocalId) {
          let uploadedFiles = [];
          try {
            uploadedFiles = await uploadProjectFiles(editingProjectId, newFiles);
          } catch (uploadErr) {
            console.error("File upload failed:", uploadErr);
            throw new Error(uploadErr?.message || "File upload failed.");
          }
          const mergedFiles = [...existingFiles, ...uploadedFiles];
          const updatePayload = { ...newProject, files: mergedFiles };
          await updateDoc(doc(db, "projects", editingProjectId), updatePayload);
          setProjects((prev) =>
            prev.map((project) => (project.id === editingProjectId ? { ...project, ...updatePayload } : project))
          );
        } else {
          const docRef = await addDoc(collection(db, "projects"), { ...newProject, createdAt: serverTimestamp() });
          let uploadedFiles = [];
          try {
            uploadedFiles = await uploadProjectFiles(docRef.id, newFiles);
          } catch (uploadErr) {
            console.error("File upload failed:", uploadErr);
            throw new Error(uploadErr?.message || "File upload failed.");
          }
          const mergedFiles = [...existingFiles, ...uploadedFiles];
          await updateDoc(doc(db, "projects", docRef.id), { files: mergedFiles });
          setProjects((prev) => [{ id: docRef.id, ...newProject, files: mergedFiles }, ...prev]);
        }
      } else {
        const localId = editingProjectId || `p-${Date.now()}`;
        if (editingProjectId) {
          setProjects((prev) =>
            prev.map((project) =>
              project.id === editingProjectId ? { ...project, ...newProject, files: existingFiles } : project
            )
          );
        } else {
          setProjects((prev) => [{ id: localId, ...newProject, files: existingFiles }, ...prev]);
        }
      }
      setProjectForm({ title: "", description: "", date: "", files: [], status: "pending", paidStatus: "unpaid" });
      setProjectItems([{ item: "", quantity: "", price: "" }]);
      setShowProjectForm(false);
      setEditingProjectId(null);
    } catch (err) {
      console.error("Failed to save project:", err);
      const code = err?.code ? ` (${err.code})` : "";
      const message = err?.message || "Unknown error";
      alert(`Failed to save project${code}. ${message}`);
    }
  };

  const handleProjectEdit = (project) => {
    setEditingProjectId(project.id);
    setProjectForm({
      title: project.title || "",
      description: project.description || "",
      date: project.date || "",
      files: project.files || [],
      status: project.status || "pending",
      paidStatus: project.paidStatus || "unpaid"
    });
    setProjectItems(project.items?.length ? project.items.map((row) => ({
      item: row.item || "",
      quantity: row.quantity || "",
      price: row.price || ""
    })) : [{ item: "", quantity: "", price: "" }]);
    setShowProjectForm(true);
  };

  const handleJpegConvert = async () => {
    if (!jpegImages.length) return;
    if (pageSize === "Passport" && exportFormat !== "pdf") {
      setJpegLoading(true);
      const selectedPassport = PASSPORT_SIZES[passportSizeKey] || PASSPORT_SIZES.usa;
      const targetWidth = selectedPassport.w;
      const targetHeight = selectedPassport.h;
      const downloads = jpegImages.map((img) => {
        return new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            Promise.resolve(processPassportImage(image, targetWidth, targetHeight))
              .then((canvas) => {
                if (!canvas) return resolve();
                const format = exportFormat === "jpg" ? "jpeg" : exportFormat;
                const mime = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
                const dataUrl = canvas.toDataURL(mime, 0.92);
                const a = document.createElement("a");
                a.href = dataUrl;
                const baseName = img.name?.replace(/\.[^/.]+$/, "") || "passport";
                a.download = `${baseName}-passport.${exportFormat}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                resolve();
              })
              .catch((err) => {
                console.error("Passport AI failed:", err);
                resolve();
              });
          };
          image.src = img.dataUrl;
        });
      });
      await Promise.all(downloads);
      if (jpegProjectId) {
        await recordProjectDownload(jpegProjectId, {
          name: `passport-images.${exportFormat}`,
          kind: "passport",
          format: exportFormat,
          count: jpegImages.length,
          createdAt: serverTimestamp()
        });
      }
      setJpegLoading(false);
      return;
    }
    setJpegLoading(true);
    try {
      const { PDFDocument, PageSizes } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const pageSizeKey = pageSize === "Letter" ? "Letter" : "A4";
      const baseSize = PageSizes[pageSizeKey];
      const marginPt = Math.max(0, Math.round(margin * 0.75));
      const toArrayBuffer = async (dataUrl) => {
        const res = await fetch(dataUrl);
        return res.arrayBuffer();
      };
      const toCompressedJpeg = async (imgDataUrl) => {
        const image = new Image();
        image.src = imgDataUrl;
        await new Promise((resolve) => {
          image.onload = resolve;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return imgDataUrl;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        return canvas.toDataURL("image/jpeg", imagePdfOptions.imageQuality);
      };
      for (const img of jpegImages) {
        const dataUrl = imagePdfOptions.compressImages ? await toCompressedJpeg(img.dataUrl) : img.dataUrl;
        const bytes = await toArrayBuffer(dataUrl);
        const isPng = dataUrl.startsWith("data:image/png");
        const embeddedImage = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        const imgWidth = embeddedImage.width;
        const imgHeight = embeddedImage.height;
        let pageWidth = baseSize[0];
        let pageHeight = baseSize[1];
        if (orientation === "landscape") {
          [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }
        if (imagePdfOptions.fitToImage || pageSize === "Fit") {
          pageWidth = imgWidth;
          pageHeight = imgHeight;
        }
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const maxWidth = pageWidth - marginPt * 2;
        const maxHeight = pageHeight - marginPt * 2;
        const scale = imagePdfOptions.fitToImage ? 1 : Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
        const drawWidth = imgWidth * scale;
        const drawHeight = imgHeight * scale;
        const x = (pageWidth - drawWidth) / 2;
        const y = (pageHeight - drawHeight) / 2;
        page.drawImage(embeddedImage, { x, y, width: drawWidth, height: drawHeight });
      }
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "images.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      if (jpegProjectId) {
        await recordProjectDownload(jpegProjectId, {
          name: "images.pdf",
          kind: "images",
          format: "pdf",
          count: jpegImages.length,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Image conversion failed.");
    } finally {
      setJpegLoading(false);
    }
  };

  const recordProjectDownload = async (projectId, entry) => {
    try {
      if (user) {
        await updateDoc(doc(db, "projects", projectId), {
          downloads: arrayUnion(entry)
        });
      }
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? { ...project, downloads: [...(project.downloads || []), entry] }
            : project
        )
      );
    } catch (err) {
      console.error("Failed to attach download:", err);
    }
  };

  const handleThemeCycle = () => {
    if (!themeKeys.length) return;
    const currentIndex = Math.max(0, themeKeys.indexOf(themeKey));
    const nextIndex = (currentIndex + 1) % themeKeys.length;
    setThemeKey(themeKeys[nextIndex]);
  };

  const Hero = (
    <header className="hero">
      <div>
        <p className="badge">OnDocs</p>
        <h1>Smart document tools for quick conversions.</h1>
        <p className="subtitle">
          Convert images, prep passport photos, and craft styled documents in one workspace.
        </p>
      </div>
      <div className="orb" />
    </header>
  );

  const AuthView = (
    <div className="panel auth-panel">
      <div className="panel-header">
        <h2>Admin Login</h2>
        <span className="hint">Allowed emails only</span>
      </div>
      <div className="auth-form">
        <button className="cta" type="button" onClick={handleGoogleLogin} disabled={authInFlight}>
          {authInFlight ? "Signing In..." : "Sign in with Google"}
        </button>
        {authError ? <p className="auth-error">{authError}</p> : null}
      </div>
    </div>
  );

  const HomeView = (
    <>
      {Hero}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Projects</h2>
            <span className="hint">Track status, payment, and line items</span>
          </div>
          <div className="project-actions">
            <button className="ghost" type="button" onClick={() => setShowProjectForm((prev) => !prev)}>
              {showProjectForm ? "Close" : "Add Project"}
            </button>
            <button className="ghost" type="button" onClick={() => setShowAllProjects((prev) => !prev)}>
              {showAllProjects ? "Show Less" : "View All"}
            </button>
          </div>
        </div>
        <div className="project-filters">
          <input
            placeholder="Search projects..."
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
          />
          <select value={projectStatusFilter} onChange={(e) => setProjectStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="processed">Processed</option>
            <option value="completed">Completed</option>
          </select>
          <select value={projectPaidFilter} onChange={(e) => setProjectPaidFilter(e.target.value)}>
            <option value="all">All Payments</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </div>
        {showProjectForm ? (
          <div className="project-form">
            <label>
              <span>Title</span>
              <input value={projectForm.title} onChange={(e) => updateProjectField("title", e.target.value)} />
            </label>
            <label>
              <span>Description</span>
              <textarea value={projectForm.description} onChange={(e) => updateProjectField("description", e.target.value)} />
            </label>
            <label>
              <span>Date</span>
              <input type="date" value={projectForm.date} onChange={(e) => updateProjectField("date", e.target.value)} />
            </label>
            <label>
              <span>Status</span>
              <select value={projectForm.status} onChange={(e) => updateProjectField("status", e.target.value)}>
                <option value="pending">Pending</option>
                <option value="processed">Processed</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>
              <span>Payment</span>
              <select value={projectForm.paidStatus} onChange={(e) => updateProjectField("paidStatus", e.target.value)}>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            <label>
              <span>Files</span>
              <input
                type="file"
                multiple
                onChange={(e) => addProjectFiles(Array.from(e.target.files || []))}
              />
              {projectForm.files.length ? (
                <span className="hint">{projectForm.files.map((file) => file.name || "File").join(", ")}</span>
              ) : null}
            </label>

            <div className="project-items">
              <div className="project-items-header">
                <strong>Items</strong>
                <button className="ghost" type="button" onClick={addProjectItem}>
                  Add Row
                </button>
              </div>
              {projectItems.map((row, idx) => (
                <div key={`item-${idx}`} className="project-row">
                  <input
                    placeholder="Item"
                    value={row.item}
                    onChange={(e) => updateProjectItem(idx, "item", e.target.value)}
                  />
                  <input
                    placeholder="Quantity"
                    type="number"
                    min="0"
                    value={row.quantity}
                    onChange={(e) => updateProjectItem(idx, "quantity", e.target.value)}
                  />
                  <input
                    placeholder="Price"
                    type="number"
                    min="0"
                    value={row.price}
                    onChange={(e) => updateProjectItem(idx, "price", e.target.value)}
                  />
                  <div className="row-total">
                    {(Number(row.quantity) || 0) * (Number(row.price) || 0)}
                  </div>
                  <button className="ghost" type="button" onClick={() => removeProjectItem(idx)} disabled={projectItems.length === 1}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="project-total">
                <span>Total</span>
                <strong>{computeProjectTotal(projectItems)}</strong>
              </div>
            </div>
            <button className="cta" type="button" onClick={handleProjectSubmit}>
              {editingProjectId ? "Update Project" : "Create Project"}
            </button>
          </div>
        ) : null}

        {filteredProjects.length ? (
          <div className="project-table">
            <div className="project-table-header">
              <strong>Recent Projects</strong>
            </div>
            {(showAllProjects ? filteredProjects : filteredProjects.slice(0, 3)).map((project) => (
              <div key={project.id} className="project-card">
                <div>
                  <strong>{project.title || "Untitled Project"}</strong>
                  <span>{project.description}</span>
                </div>
                <div className="project-meta">
                  <span>{project.date || "No date"}</span>
                  <span>Status: {project.status || "pending"}</span>
                  <span>Payment: {project.paidStatus || "unpaid"}</span>
                  <div className="project-files">
                    {(project.files && project.files.length ? project.files : []).map((file, idx) => (
                      <div key={`${file.name || "file"}-${idx}`} className="project-file-row">
                        <span>{file.name || "File"}</span>
                        {file.url ? (
                          <a className="ghost" href={file.url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          <button className="ghost" type="button" disabled>
                            No link
                          </button>
                        )}
                      </div>
                    ))}
                    {(!project.files || !project.files.length) && <span>No files</span>}
                  </div>
                  <strong>Total: {project.total}</strong>
                  <button className="ghost" type="button" onClick={() => handleProjectEdit(project)}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card-grid">
        <button className="feature-card" type="button" onClick={() => setView("jpeg")}>
          <span className="feature-tag">Quick Convert</span>
          <h3>JPEG to PDF</h3>
          <p>Drop images and batch-export a clean PDF in seconds.</p>
        </button>
        <button className="feature-card" type="button" onClick={() => setView("table")}>
          <span className="feature-tag">Spreadsheet</span>
          <h3>Table Tool</h3>
          <p>Auto-balance totals with dynamic subtotals.</p>
        </button>
        <button
          className="feature-card"
          type="button"
          onClick={() => {
            setPageSize("Passport");
            setOrientation("portrait");
            setMargin(12);
            setPassportSizeKey("usa");
            setView("jpeg");
          }}
        >
          <span className="feature-tag">Photo Tools</span>
          <h3>Photo to Passport</h3>
          <p>Export images at 2x2 inch passport size quickly.</p>
        </button>
        <button className="feature-card primary" type="button" onClick={() => setView("editor")}>
          <span className="feature-tag">OnDocs</span>
          <h3>Open Editor</h3>
          <p>Write, format, and export rich text PDF with themes.</p>
        </button>
      </section>


    </>
  );

  const TableToolPanel = (
    <section className="panel">
      <div className="panel-header">
        <h2>Table Tool</h2>
        <span className="hint">Even split total across cells</span>
      </div>
      <div className="table-controls">
        <label>
          <span>Rows</span>
          <input
            type="number"
            min="1"
            value={tableRows}
            onChange={(e) => {
              const next = Math.max(1, Number(e.target.value) || 1);
              setTableRows(next);
              resizeTable(next, tableCols);
              distributeTotalEvenly(tableTotal, next, tableCols);
            }}
          />
        </label>
        <label>
          <span>Columns</span>
          <input
            type="number"
            min="1"
            value={tableCols}
            onChange={(e) => {
              const next = Math.max(1, Number(e.target.value) || 1);
              setTableCols(next);
              resizeTable(tableRows, next);
              distributeTotalEvenly(tableTotal, tableRows, next);
            }}
          />
        </label>
        <label>
          <span>Total</span>
          <input
            type="number"
            value={tableTotal}
            onChange={(e) => handleTableTotalChange(e.target.value)}
          />
        </label>
      </div>
        <div className="table-grid">
        <div className="table-row table-header">
          {Array.from({ length: tableCols }, (_, c) => (
            <span key={`h-${c}`}>Col {c + 1}</span>
          ))}
          <span>Row Total</span>
        </div>
        {tableValues.map((row, r) => {
          const rowTotal = row.reduce((acc, cell) => acc + (Number(cell) || 0), 0);
          return (
            <div key={`r-${r}`} className="table-row">
              {row.map((cell, c) => (
                <input
                  key={`c-${r}-${c}`}
                  type="number"
                  value={Number.isFinite(cell) ? cell.toFixed(2) : 0}
                  onChange={(e) => handleTableCellChange(r, c, e.target.value)}
                />
              ))}
              <strong>{rowTotal.toFixed(2)}</strong>
            </div>
          );
        })}
        <div className="table-row table-footer">
          {Array.from({ length: tableCols }, (_, c) => {
            const colTotal = tableValues.reduce((acc, row) => acc + (Number(row[c]) || 0), 0);
            return (
              <strong key={`f-${c}`}>{colTotal.toFixed(2)}</strong>
            );
          })}
          <strong>{tableValues.flat().reduce((acc, cell) => acc + (Number(cell) || 0), 0).toFixed(2)}</strong>
        </div>
      </div>
    </section>
  );

  const EditorView = (
    <>
      <header className="hero compact">
        <div>
          <p className="badge">OnDocs Editor</p>
          <h1>Turn text into a themed PDF with style.</h1>
          <p className="subtitle">Pick a theme, tune your font color, and export instantly.</p>
        </div>
        <button className="ghost" type="button" onClick={() => setView("home")}>
          Back to Home
        </button>
      </header>

      <main className="grid">
        <section className={`panel ${pulse ? "pulse" : ""}`}>
          <div className="panel-header">
            <div>
              <h2>Editor</h2>
              <span className="hint">Rich text + page breaks</span>
            </div>
            <label className="toggle toggle-top">
              <input type="checkbox" checked={manglishEnabled} onChange={(e) => setManglishEnabled(e.target.checked)} />
              <span>Manglish typing</span>
            </label>
          </div>
          <ReactQuill
            ref={editorRef}
            theme="snow"
            value={editorHtml}
            onChange={handleEditorChange}
            onKeyDown={handleEditorKeyDown}
            modules={modules}
            formats={formats}
            placeholder="Type or paste your text here..."
          />
          <div className="editor-actions">
            <button className="ghost" type="button" onClick={handleInsertPageBreak}>
              Insert Page Break
            </button>
          </div>
          {manglishEnabled && manglishSuggestions.length ? (
            <div className="manglish-suggestion">
              <span>Suggestion:</span>
              <div className="manglish-chips">
                {manglishSuggestions.slice(0, 5).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip"
                    onClick={() => {
                      const editor = editorRef.current?.getEditor();
                      if (!editor) return;
                      applySuggestion(editor, item, manglishRange);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <em>Tab to accept first</em>
            </div>
          ) : null}
          {manglishEnabled && (
            <p className="hint">
              {manglishError || "Manglish mode is active."}
            </p>
          )}
        </section>

        <section className="panel controls">
          <div className="panel-header">
            <h2>Styling</h2>
            <span className="hint">Pick a theme + font</span>
          </div>

          <div className="mode-row">
            <span>Site mode</span>
            <div className="mode-actions">
              <button
                className={`ghost ${siteTheme === "light" ? "active" : ""}`}
                type="button"
                onClick={() => setSiteTheme("light")}
              >
                Light
              </button>
              <button
                className={`ghost ${siteTheme === "dark" ? "active" : ""}`}
                type="button"
                onClick={() => setSiteTheme("dark")}
              >
                Dark
              </button>
            </div>
          </div>

          <div className="theme-grid">
            {Object.entries(themes).map(([key, theme]) => (
              <button
                key={key}
                className={`theme-card ${key === themeKey ? "active" : ""}`}
                onClick={() => setThemeKey(key)}
                style={{ background: theme.bg, color: theme.accent }}
              >
                <span>{key}</span>
                <span className="theme-dot" style={{ background: theme.accent }} />
              </button>
            ))}
          </div>

          <label className="color-row">
            <span>Font color</span>
            <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} />
          </label>

          <div className="page-settings">
            <div>
              <span>Page size</span>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Passport">Passport (2x2 in)</option>
              </select>
            </div>
            {pageSize === "Passport" ? (
              <div>
                <span>Country size</span>
                <select value={passportSizeKey} onChange={(e) => setPassportSizeKey(e.target.value)}>
                  {Object.entries(PASSPORT_SIZES).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <span>Export</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                disabled={pageSize !== "Passport"}
              >
                {pageSize === "Passport" ? (
                  <>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WEBP</option>
                  </>
                ) : (
                  <option value="pdf">PDF</option>
                )}
              </select>
            </div>
            <div>
              <span>Orientation</span>
              <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
            <div>
              <span>Margins</span>
              <input
                type="range"
                min="24"
                max="96"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="preview-shell">
            <h3>Preview</h3>
            <div className={`preview-pages ${pageSize === "Passport" ? "preview-pages-tight" : ""}`}>
              {(previewPages.length ? previewPages : ["<p>Your text preview will appear here.</p>"]).map((pageHtml, idx) => (
                <div className="preview-page" style={{ background: selectedTheme.bg, color: fontColor }} key={idx}>
                  <div className="preview-content" dangerouslySetInnerHTML={{ __html: pageHtml }} />
                </div>
              ))}
            </div>
          </div>

          <label className="project-attach">
            <span>Attach to project</span>
            <select value={editorProjectId} onChange={(e) => setEditorProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title || "Untitled Project"}
                </option>
              ))}
            </select>
          </label>

          <button className={`cta ${isLoading ? "loading" : ""}`} onClick={handleDownload} disabled={isLoading}>
            {isLoading ? "Generating..." : "Download PDF"}
          </button>
        </section>

        {TableToolPanel}
      </main>
    </>
  );

  const TableView = (
    <>
      <header className="hero compact">
        <div>
          <p className="badge">Table Tool</p>
          <h1>Auto-balance totals with live subtotals.</h1>
          <p className="subtitle">Add rows and columns, set a total, and let the table balance itself.</p>
        </div>
        <button className="ghost" type="button" onClick={() => setView("home")}>
          Back to Home
        </button>
      </header>
      <main className="grid">
        {TableToolPanel}
      </main>
    </>
  );

  const JpegView = (
    <>
      <header className="hero compact">
        <div>
          <p className="badge">JPEG → PDF</p>
          <h1>Convert images into a single PDF.</h1>
          <p className="subtitle">Upload images, reorder them, and export as PDF or passport photos.</p>
        </div>
        <button className="ghost" type="button" onClick={() => setView("home")}>
          Back to Home
        </button>
      </header>

      <main className="grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Images</h2>
            <span className="hint">Supported: JPG, PNG, WEBP</span>
          </div>
          <label className="upload-box">
            <input type="file" accept="image/*" multiple onChange={handleJpegUpload} />
            <div>
              <strong>Drop or click to upload</strong>
              <span>Add multiple images to build your PDF.</span>
            </div>
          </label>
          <div className="thumb-grid">
            {jpegImages.map((img, index) => (
              <div key={`${img.name}-${index}`} className="thumb-card">
                <img src={img.dataUrl} alt={img.name} />
                <div className="thumb-meta">
                  <span>{img.name}</span>
                  <div className="thumb-actions">
                    <button className="ghost" type="button" disabled={index === 0} onClick={() => moveJpegImage(index, index - 1)}>
                      Up
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      disabled={index === jpegImages.length - 1}
                      onClick={() => moveJpegImage(index, index + 1)}
                    >
                      Down
                    </button>
                    <button className="ghost" type="button" onClick={() => removeJpegImage(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {jpegImages.length ? (
            <button className="ghost" type="button" onClick={clearJpegImages}>
              Clear all
            </button>
          ) : null}
        </section>

        <section className="panel controls">
          <div className="panel-header">
            <h2>Output</h2>
            <span className="hint">PDF settings</span>
          </div>
          <div className="page-settings">
            <div>
              <span>Page size</span>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Fit">Fit to image</option>
                <option value="Passport">Passport (2x2 in)</option>
              </select>
            </div>
            <div>
              <span>Export</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                disabled={pageSize !== "Passport"}
              >
                {pageSize === "Passport" ? (
                  <>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WEBP</option>
                  </>
                ) : (
                  <option value="pdf">PDF</option>
                )}
              </select>
            </div>
            <div>
              <span>Orientation</span>
              <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
            <div>
              <span>Margins</span>
              <input
                type="range"
                min="12"
                max="96"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
            </div>
          </div>
          {pageSize !== "Passport" ? (
            <div className="image-options">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={imagePdfOptions.fitToImage}
                  onChange={(e) => setImagePdfOptions((prev) => ({ ...prev, fitToImage: e.target.checked }))}
                />
                Fit page to image size
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={imagePdfOptions.compressImages}
                  onChange={(e) => setImagePdfOptions((prev) => ({ ...prev, compressImages: e.target.checked }))}
                />
                Compress images
              </label>
              <label className="range-row">
                <span>Image quality</span>
                <input
                  type="range"
                  min="0.4"
                  max="1"
                  step="0.05"
                  value={imagePdfOptions.imageQuality}
                  onChange={(e) => setImagePdfOptions((prev) => ({ ...prev, imageQuality: Number(e.target.value) }))}
                  disabled={!imagePdfOptions.compressImages}
                />
                <em>{imagePdfOptions.imageQuality.toFixed(2)}</em>
              </label>
            </div>
          ) : null}
          {pageSize === "Passport" ? (
            <div className="ai-panel">
              <div className="ai-header">
                <strong>Passport AI</strong>
                <span className="hint">{aiLoading ? "Loading models..." : "Runs on device"}</span>
              </div>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={passportAi.faceCrop}
                  onChange={(e) => setPassportAi((prev) => ({ ...prev, faceCrop: e.target.checked }))}
                />
                Auto face detect + crop
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={passportAi.bgRemove}
                  onChange={(e) => setPassportAi((prev) => ({ ...prev, bgRemove: e.target.checked }))}
                />
                Background removal
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={passportAi.autoCenter}
                  onChange={(e) => setPassportAi((prev) => ({ ...prev, autoCenter: e.target.checked }))}
                />
                Auto centering + scale
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={passportAi.eyeGuides}
                  onChange={(e) => setPassportAi((prev) => ({ ...prev, eyeGuides: e.target.checked }))}
                />
                Head/eye alignment guides
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={passportAi.redEye}
                  onChange={(e) => setPassportAi((prev) => ({ ...prev, redEye: e.target.checked }))}
                />
                Red-eye correction
              </label>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={passportAi.lighting}
                  onChange={(e) => setPassportAi((prev) => ({ ...prev, lighting: e.target.checked }))}
                />
                Lighting correction
              </label>
            </div>
          ) : null}
          <div className="preview-shell">
            <h3>Preview</h3>
            <div className="preview-pages">
              {(pageSize === "Passport" && passportPreviews.length ? passportPreviews : (jpegImages.length ? jpegImages.map((item) => item.dataUrl) : [""])).map((imgSrc, idx) => (
                <div className="preview-page" key={idx} style={{ background: "#ffffff" }}>
                  {imgSrc ? <img src={imgSrc} alt={`Preview ${idx + 1}`} className="preview-image" /> : <p>Upload images to preview.</p>}
                  {pageSize === "Passport" && passportAi.eyeGuides ? (
                    <div className="passport-guides" aria-hidden="true">
                      <span className="guide-line guide-eye" />
                      <span className="guide-line guide-chin" />
                      <span className="guide-line guide-top" />
                      <span className="guide-line guide-center" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <label className="project-attach">
            <span>Attach to project</span>
            <select value={jpegProjectId} onChange={(e) => setJpegProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title || "Untitled Project"}
                </option>
              ))}
            </select>
          </label>

          <button className={`cta ${jpegLoading ? "loading" : ""}`} onClick={handleJpegConvert} disabled={jpegLoading || !jpegImages.length}>
            {jpegLoading
              ? "Converting..."
              : pageSize === "Passport" && exportFormat !== "pdf"
                ? "Download Images"
                : "Download PDF"}
          </button>
        </section>
      </main>
    </>
  );

  return (
    <div
      className="app"
      data-theme={siteTheme}
      style={{
        "--theme-bg": selectedTheme.bg,
        "--theme-accent": selectedTheme.accent,
        "--page-width": `${pageDimensions.width}px`,
        "--page-height": `${pageDimensions.height}px`,
        "--page-padding": `${margin}px`
      }}
    >
      <div className="topbar">
        <div>
          <strong>OnDocs</strong>
          <span>Doc tools studio</span>
        </div>
        <div className="topbar-actions">
          <button className="ghost" type="button" onClick={() => setView("home")}>Home</button>
          <button className="ghost" type="button" onClick={() => setView("editor")}>Editor</button>
          <button className="ghost" type="button" onClick={() => setView("table")}>Table Tool</button>
          <button className="ghost" type="button" onClick={handleThemeCycle}>Next theme</button>
          <button
            className={`ghost ${siteTheme === "light" ? "active" : ""}`}
            type="button"
            onClick={() => setSiteTheme(siteTheme === "light" ? "dark" : "light")}
          >
            {siteTheme === "light" ? "Dark mode" : "Light mode"}
          </button>
          {user ? (
            <button className="ghost" type="button" onClick={handleLogout}>Logout</button>
          ) : null}
        </div>
      </div>
      {authLoading ? (
        <p className="hint">Checking login...</p>
      ) : user ? (
        view === "home"
          ? HomeView
          : view === "editor"
            ? EditorView
            : view === "table"
              ? TableView
              : JpegView
      ) : (
        AuthView
      )}
      <footer className="footer">
        <p> created by Rekkes.</p>
        <span>Built for fast document flows and passport-ready exports.</span>
      </footer>
    </div>
  );
}
