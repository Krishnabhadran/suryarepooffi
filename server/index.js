import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 5179;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/", (_req, res) => {
  res.send("OnDocs API is running");
});

const themes = {
  light: { bg: "#ffffff", accent: "#111827" },
  dark: { bg: "#0b1020", accent: "#e5e7eb" },
  ocean: { bg: "#0b1d2a", accent: "#7dd3fc" },
  sunset: { bg: "#2a0b1d", accent: "#fb7185" }
};

const PAGE_SIZES = {
  A4: {
    css: "A4",
    pdf: { format: "A4" },
    pdfKit: "A4",
    supportsOrientation: true
  },
  Letter: {
    css: "Letter",
    pdf: { format: "Letter" },
    pdfKit: "Letter",
    supportsOrientation: true
  },
  Passport: {
    css: "2in 2in",
    pdf: { width: "2in", height: "2in" },
    pdfKit: [144, 144],
    supportsOrientation: false
  }
};

const resolvePageSize = (pageSize) => PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
const resolveCssPageSize = (config, orientation) =>
  config.supportsOrientation ? `${config.css} ${orientation}` : config.css;

app.get("/api/themes", (_req, res) => {
  res.json(themes);
});

app.get("/api/manglish", async (req, res) => {
  const text = (req.query.text || "").toString().trim();
  if (!text) {
    return res.status(400).json({ error: "Text is required." });
  }

  try {
    const url =
      "https://inputtools.google.com/request" +
      `?text=${encodeURIComponent(text)}` +
      "&itc=ml-t-i0-und" +
      "&num=6&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test";

    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ error: "Manglish lookup failed.", status: response.status, body: body.slice(0, 200) });
    }
    const data = await response.json();
    const status = data?.[0] || "ERROR";
    const suggestions = data?.[1]?.[0]?.[1] || [];

    res.json({ status, suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Manglish lookup failed." });
  }
});

let browserPromise;
let puppeteerDisabled = false;
const getBrowser = () => {
  if (puppeteerDisabled) {
    return null;
  }
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }
  return browserPromise;
};

app.post("/api/convert", async (req, res) => {
  const { html, theme = "light", fontColor, title = "Text to PDF", pageSize = "A4", orientation = "portrait", margin = 48 } =
    req.body || {};

  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "HTML content is required." });
  }

  const selectedTheme = themes[theme] || themes.light;
  const safeFontColor = typeof fontColor === "string" && fontColor.trim() ? fontColor : selectedTheme.accent;

  const pageSizeConfig = resolvePageSize(pageSize);
  const safeOrientation = orientation === "landscape" ? "landscape" : "portrait";
  const safeMargin = Number.isFinite(Number(margin)) ? Math.max(8, Math.min(96, Number(margin))) : 48;
  const cssPageSize = resolveCssPageSize(pageSizeConfig, safeOrientation);

  const documentHtml = `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: ${cssPageSize}; margin: ${safeMargin}px; }
      body {
        margin: 0;
        font-family: "Times New Roman", serif;
        background: ${selectedTheme.bg};
        color: ${safeFontColor};
      }
      .page {
        min-height: 100vh;
      }
      h1, h2, h3 {
        color: ${selectedTheme.accent};
      }
      img {
        max-width: 100%;
      }
      hr.page-break { border: 0; page-break-after: always; }
      .ql-align-center { text-align: center; }
      .ql-align-right { text-align: right; }
      .ql-align-justify { text-align: justify; }
      .ql-size-small { font-size: 0.85em; }
      .ql-size-large { font-size: 1.3em; }
      .ql-size-huge { font-size: 1.6em; }
      .ql-font-serif { font-family: "Times New Roman", serif; }
      .ql-font-monospace { font-family: "Courier New", monospace; }
      .ql-font-sans { font-family: Arial, sans-serif; }
    </style>
  </head>
  <body>
    <div class="page">
      ${title ? `<h1>${title}</h1>` : ""}
      ${html}
    </div>
  </body>
</html>
`;

  try {
    if (!process.env.PUPPETEER_SKIP) {
      const browser = await getBrowser();
      if (browser) {
        const page = await browser.newPage();
        await page.setContent(documentHtml, { waitUntil: "networkidle0" });
        const pdfOptions = pageSizeConfig.pdf?.format
          ? { format: pageSizeConfig.pdf.format, landscape: safeOrientation === "landscape" }
          : { width: pageSizeConfig.pdf.width, height: pageSizeConfig.pdf.height, landscape: false };
        const pdfBuffer = await page.pdf({
          ...pdfOptions,
          printBackground: true
        });
        await page.close();

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=converted.pdf");
        res.setHeader("X-Pdf-Engine", "puppeteer");
        res.send(pdfBuffer);
        return;
      }
    }
  } catch (err) {
    console.error("Puppeteer PDF failed:", err);
    puppeteerDisabled = true;
  }

  // Fallback: render plain text with PDFKit
  try {
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const regularFontPath = path.join(process.cwd(), "fonts", "NotoSansMalayalam-Regular.ttf");
    const hasMalayalamFont = fs.existsSync(regularFontPath);
    const hasMalayalamText = /[\u0D00-\u0D7F]/.test(plainText);

    if (hasMalayalamText && !hasMalayalamFont) {
      return res.status(400).json({
        error: "Malayalam font missing.",
        detail: "Place NotoSansMalayalam-Regular.ttf in server/fonts to render Malayalam correctly."
      });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=converted.pdf");
    res.setHeader("X-Pdf-Engine", "pdfkit-fallback");

    const doc = new PDFDocument({
      size: pageSizeConfig.pdfKit,
      layout: pageSizeConfig.supportsOrientation ? safeOrientation : "portrait",
      margin: safeMargin
    });
    doc.on("error", (pdfErr) => {
      console.error("PDFKit error:", pdfErr);
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF generation failed.", detail: String(pdfErr?.message || pdfErr) });
      }
    });
    doc.pipe(res);
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(selectedTheme.bg);
    if (hasMalayalamFont) {
      doc.font(regularFontPath);
    }
    doc.fillColor(selectedTheme.accent).fontSize(18).text(title || "Text to PDF", safeMargin, safeMargin);
    doc.fillColor(safeFontColor).fontSize(12).text(plainText || " ", safeMargin, safeMargin + 40, {
      width: doc.page.width - safeMargin * 2
    });
    doc.end();
  } catch (fallbackErr) {
    console.error("PDFKit fallback failed:", fallbackErr);
    res.status(500).json({ error: "PDF generation failed.", detail: String(fallbackErr?.message || fallbackErr) });
  }
});

app.post("/api/images-to-pdf", (req, res) => {
  const { images = [], pageSize = "A4", orientation = "portrait", margin = 24 } = req.body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "At least one image is required." });
  }

  const pageSizeConfig = resolvePageSize(pageSize);
  const safeOrientation = orientation === "landscape" ? "landscape" : "portrait";
  const safeMargin = Number.isFinite(Number(margin)) ? Math.max(8, Math.min(96, Number(margin))) : 24;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=images.pdf");
  res.setHeader("X-Pdf-Engine", "pdfkit-images");

  const doc = new PDFDocument({
    size: pageSizeConfig.pdfKit,
    layout: pageSizeConfig.supportsOrientation ? safeOrientation : "portrait",
    margin: safeMargin
  });
  doc.on("error", (err) => {
    console.error("PDFKit image error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Image PDF generation failed.", detail: String(err?.message || err) });
    }
  });
  doc.pipe(res);

  images.forEach((dataUrl, index) => {
    if (index > 0) doc.addPage();
    try {
      const base64 = dataUrl.split(",")[1];
      const buffer = Buffer.from(base64, "base64");
      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
      doc.image(buffer, safeMargin, safeMargin, {
        fit: [doc.page.width - safeMargin * 2, doc.page.height - safeMargin * 2],
        align: "center",
        valign: "center"
      });
    } catch (err) {
      console.error("Failed to render image:", err);
    }
  });

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
