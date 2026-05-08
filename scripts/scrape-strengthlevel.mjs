// Scrape https://strengthlevel.com/strength-standards to collect all exercises,
// download their icon.png files, pull the how-to guide (intro + form check +
// ordered steps with images) from /exercises/<slug>, and emit a JSON index.
//
// Output:
//   public/exercises/exercises.json
//   public/exercises/icons/<slug>.png
//   public/exercises/howto/<slug>/step-<n>.jpg

import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "public", "exercises");
const ICONS_DIR = path.join(OUT_DIR, "icons");
const HOWTO_DIR = path.join(OUT_DIR, "howto");
const JSON_PATH = path.join(OUT_DIR, "exercises.json");

const SOURCE_URL = "https://strengthlevel.com/strength-standards";
const SITEMAP_URL = "https://strengthlevel.com/sitemap.xml";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0 Safari/537.36";

async function fetchText(url, { allowRedirect = true } = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    redirect: allowRedirect ? "follow" : "manual",
  });
  if (!allowRedirect && (response.status === 301 || response.status === 302)) {
    return { redirected: true, text: "", status: response.status };
  }
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return { redirected: false, text: await response.text(), status: response.status };
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseExerciseCards(html) {
  const items = new Map();
  const cardRegex =
    /<a\s+href="\/strength-standards\/([a-z0-9-]+)"[^>]*class="button is-fullwidth exerciseitem__button"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*>/g;

  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const [, slug, name] = match;
    items.set(slug, {
      slug,
      name: name.trim(),
    });
  }
  return items;
}

// The /strength-standards index only surfaces a curated subset (a few dozen
// out of ~280 exercises). The sitemap lists every exercise page, so we use
// it as the authoritative list. Comparison pages ("x-vs-y") and the /male,
// /female, /kg, /lb listing variants are filtered out.
const SLUG_BLOCKLIST = new Set([
  "male",
  "female",
  "kg",
  "lb",
  // Language listing variants. These are locale aggregator pages, not
  // exercises. Only `english` appears at /strength-standards/<locale> but we
  // defensively list a handful in case they leak in.
  "english",
  "deutsch",
  "espanol",
  "francais",
  "italiano",
]);

async function fetchSitemapSlugs() {
  const { text } = await fetchText(SITEMAP_URL);
  const regex = /strength-standards\/([a-z0-9-]+)/g;
  const slugs = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    const slug = match[1];
    if (slug.includes("-vs-")) continue;
    if (SLUG_BLOCKLIST.has(slug)) continue;
    slugs.add(slug);
  }
  return slugs;
}

function parseStandardsTitle(html) {
  // Standards pages render the exercise name inside the first <h1>, suffixed
  // with " Standards" (e.g. "Wrist Curl Standards"). Strip that suffix.
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const raw = stripHtml(match[1]);
  return raw.replace(/\s+Standards\s*$/i, "").trim() || null;
}

const STRENGTH_LEVEL_KEYS = [
  "beginner",
  "novice",
  "intermediate",
  "advanced",
  "elite",
];

/** Bodyweight benchmarks are split differently from barbell kg tables. */
function splitStandardsSexBlocks(html) {
  // Canonical split heading is `<h2>…`; older pages occasionally used `<h3>`.
  const maleRe =
    /<h[1-6][^>]*>\s*Male\b[^<{]{3,240}Standards\s*<\/h[1-6]>/i;
  const femaleRe =
    /<h[1-6][^>]*>\s*Female\b[^<{]{3,240}Standards\s*<\/h[1-6]>/i;
  const m = maleRe.exec(html);
  const f = femaleRe.exec(html);
  if (!m) return { male: null, female: null };
  const maleStart = m.index;
  const femaleStart = f ? f.index : html.length;
  return {
    male: html.slice(maleStart, femaleStart),
    female: f ? html.slice(femaleStart) : null,
  };
}

/** First tab-group block for titles like Entire Community. */
function sliceTabGroup(html, title) {
  const marker = `data-tab-group="${title}"`;
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  return html.slice(idx, idx + 14_000);
}

function decodeHtmlCell(inner) {
  return inner
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStrengthLevelTdTbodyPairs(tbodyHtml, parseSecond) {
  const out = {};
  const rowRe =
    /<tr>\s*<td>([^<]+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(tbodyHtml)) !== null) {
    const levelKey = decodeHtmlCell(row[1]).trim().toLowerCase();
    if (!STRENGTH_LEVEL_KEYS.includes(levelKey)) continue;
    const value = parseSecond(row[2]);
    if (value == null || !Number.isFinite(value)) continue;
    out[levelKey] = value;
  }
  if (STRENGTH_LEVEL_KEYS.every((key) => typeof out[key] === "number")) {
    return out;
  }
  return null;
}

function parseEntireCommunityRepsTierRow(cellHtml) {
  const text = decodeHtmlCell(cellHtml);
  if (/^<\s*1$/i.test(text)) return 0;
  const numeric = Number(text.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseEntireCommunitySignedKgTierRow(cellHtml) {
  const text = decodeHtmlCell(cellHtml).replace(/^\+/, "");
  const m = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]);
}

function extractRepsCommunityTbody(blockHtml) {
  const m = blockHtml.match(
    /<thead>[\s\S]*?>Reps\s*<\/th>\s*<\/tr>\s*<\/thead>\s*<tbody>([\s\S]*?)<\/tbody>/i,
  );
  return m ? m[1] : null;
}

function extractOneRmCommunityTbody(blockHtml) {
  const m = blockHtml.match(
    /<thead>[\s\S]*?>1RM Weight\s*<\/th>\s*<\/tr>\s*<\/thead>\s*<tbody>([\s\S]*?)<\/tbody>/i,
  );
  return m ? m[1] : null;
}

function extractBodyweightMatricesForSex(sexHtml) {
  const repsRegion = (() => {
    const start = sexHtml.indexOf("Reps By Weight and Age");
    if (start === -1) return null;
    const kgEnd = sexHtml.indexOf(">1RM Weight (kg)<", start);
    const lbEnd = sexHtml.indexOf(">1RM Weight (lb)<", start);
    let end =
      kgEnd !== -1
        ? kgEnd
        : lbEnd !== -1
          ? lbEnd
          : sexHtml.length;
    if (end === -1) end = sexHtml.length;
    return sexHtml.slice(start, end);
  })();

  const oneRmKgStart = sexHtml.indexOf(">1RM Weight (kg)<");
  const oneRmLbStart = sexHtml.indexOf(">1RM Weight (lb)<");
  const oneRmSliceStart =
    oneRmKgStart !== -1
      ? oneRmKgStart
      : oneRmLbStart !== -1
        ? oneRmLbStart
        : -1;
  const oneRmRegion =
    oneRmSliceStart === -1
      ? null
      : sexHtml.slice(oneRmSliceStart);

  let repsMatrixTbody = null;
  if (repsRegion) {
    const m = repsRegion.match(
      /<h4[^>]*>\s*By Bodyweight\s*<\/h4>\s*<div class="table-container">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
    );
    repsMatrixTbody = m ? m[1] : null;
  }

  let oneRmMatrixTbody = null;
  if (oneRmRegion) {
    const m = oneRmRegion.match(
      /<h4[^>]*>\s*By Bodyweight\s*<\/h4>\s*<div class="table-container">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
    );
    oneRmMatrixTbody = m ? m[1] : null;
  }

  return { repsMatrixTbody, oneRmMatrixTbody };
}

function parseBwGridRepsRows(tbodyHtml) {
  const rows = [];
  const trRe = /<tr>\s*([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tbodyHtml)) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tm;
    while ((tm = tdRe.exec(tr[1])) !== null) {
      cells.push(tm[1]);
    }
    if (cells.length < 6) continue;
    const bw = Number(decodeHtmlCell(cells[0]));
    if (!Number.isFinite(bw)) continue;
    const tierNums = cells.slice(1, 6).map((c) => {
      const inner = decodeHtmlCell(c);
      if (/^<\s*1$/i.test(inner)) return 0;
      const n = Number(inner.replace(/[^0-9.+-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    });
    rows.push({
      bodyweightKg: bw,
      beginner: tierNums[0],
      novice: tierNums[1],
      intermediate: tierNums[2],
      advanced: tierNums[3],
      elite: tierNums[4],
    });
  }
  return rows.length ? rows : null;
}

function parseBwGridSignedKgRows(tbodyHtml) {
  const rows = [];
  const trRe = /<tr>\s*([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tbodyHtml)) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tm;
    while ((tm = tdRe.exec(tr[1])) !== null) {
      cells.push(tm[1]);
    }
    if (cells.length < 6) continue;
    const bw = Number(decodeHtmlCell(cells[0]));
    if (!Number.isFinite(bw)) continue;
    const tierNums = cells.slice(1, 6).map((c) => {
      const text = decodeHtmlCell(c).replace(/^\+/, "");
      const m = text.match(/^(-?\d+(?:\.\d+)?)/);
      return m ? Number(m[1]) : NaN;
    });
    if (tierNums.some((n) => !Number.isFinite(n))) continue;
    rows.push({
      bodyweightKg: bw,
      beginner: tierNums[0],
      novice: tierNums[1],
      intermediate: tierNums[2],
      advanced: tierNums[3],
      elite: tierNums[4],
    });
  }
  return rows.length ? rows : null;
}

function parseBodyweightSexStandards(sexHtml) {
  const entireBlock = sliceTabGroup(sexHtml, "Entire Community");
  if (!entireBlock) return null;
  const repsTbody = extractRepsCommunityTbody(entireBlock);
  if (!repsTbody) return null;

  const entireRepsByTier = parseStrengthLevelTdTbodyPairs(
    repsTbody,
    parseEntireCommunityRepsTierRow,
  );
  if (!entireRepsByTier) return null;

  const oneRmTbody = extractOneRmCommunityTbody(entireBlock);
  const entireOneRmAddedKgByTier = oneRmTbody
    ? parseStrengthLevelTdTbodyPairs(
        oneRmTbody,
        parseEntireCommunitySignedKgTierRow,
      )
    : null;

  const { repsMatrixTbody, oneRmMatrixTbody } =
    extractBodyweightMatricesForSex(sexHtml);

  const repsByBodyweightKg = repsMatrixTbody
    ? parseBwGridRepsRows(repsMatrixTbody)
    : null;
  const oneRmAddedKgByBodyweight = oneRmMatrixTbody
    ? parseBwGridSignedKgRows(oneRmMatrixTbody)
    : null;

  return {
    entireCommunityRepsByTier: entireRepsByTier,
    entireCommunityOneRmAddedKgByTier: entireOneRmAddedKgByTier,
    repsByBodyweightKg,
    oneRmAddedKgByBodyweight,
  };
}

function parseBodyweightStandards(html) {
  const blocks = splitStandardsSexBlocks(html);
  if (!blocks.male) return null;

  const male = parseBodyweightSexStandards(blocks.male);
  const female = blocks.female
    ? parseBodyweightSexStandards(blocks.female)
    : null;
  if (!male && !female) return null;
  return { male, female };
}

function parseLevelWeightRows(tbodyHtml) {
  const out = {};
  const rowRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi;
  let row;
  while ((row = rowRegex.exec(tbodyHtml)) !== null) {
    const level = row[1].trim().toLowerCase();
    const raw = row[2].trim();
    const numeric = Number(raw.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric)) continue;
    if (STRENGTH_LEVEL_KEYS.includes(level)) {
      out[level] = numeric;
    }
  }
  if (STRENGTH_LEVEL_KEYS.every((key) => typeof out[key] === "number")) {
    return out;
  }
  return null;
}

function parseSexWeightStandards(html, sex) {
  const marker = `${sex} `;
  const sectionStart = html.indexOf(marker);
  if (sectionStart === -1) return null;
  const section = html.slice(sectionStart);

  const weightTabMatch = section.match(
    /<h4[^>]*>\s*Weight\s*<\/h4>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
  );
  if (!weightTabMatch) return null;
  return parseLevelWeightRows(weightTabMatch[1]);
}

export async function fetchStandards(slug) {
  // Force kg so we can compare directly to most logged weights in the app.
  const url = `https://strengthlevel.com/strength-standards/${slug}/kg`;
  const { text } = await fetchText(url);
  const maleBar = parseSexWeightStandards(text, "Male");
  const femaleBar = parseSexWeightStandards(text, "Female");
  if (maleBar || femaleBar) {
    return {
      kind: "barbellOneRm",
      unit: "kg",
      sourceUrl: url,
      male: maleBar,
      female: femaleBar,
    };
  }
  const body = parseBodyweightStandards(text);
  if (!body) return null;
  return {
    kind: "bodyweight",
    unit: "kg",
    sourceUrl: url,
    male: body.male,
    female: body.female,
  };
}

async function fetchStandardsName(slug) {
  const url = `https://strengthlevel.com/strength-standards/${slug}`;
  try {
    const { text } = await fetchText(url);
    return parseStandardsTitle(text);
  } catch {
    return null;
  }
}

function parseCategorizedList(html) {
  const categoryMap = new Map(); // slug -> category
  const categoryOrder = [];
  const sectionRegex =
    /<h3\s+class="subtitle is-4 is-size-5-mobile">([^<]+)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g;

  let section;
  while ((section = sectionRegex.exec(html)) !== null) {
    const [, categoryRaw, listHtml] = section;
    const category = categoryRaw.trim();
    categoryOrder.push(category);

    const linkRegex = /<a\s+href="\/strength-standards\/([a-z0-9-]+)">([^<]+)<\/a>/g;
    let link;
    while ((link = linkRegex.exec(listHtml)) !== null) {
      categoryMap.set(link[1], { category, name: link[2].trim() });
    }
  }

  return { categoryMap, categoryOrder };
}

function iconUrl(slug, size) {
  return `https://static.strengthlevel.com/images/exercises/${slug}/icons/${slug}-icon-${size}.png`;
}

async function downloadIcon(slug) {
  const destination = path.join(ICONS_DIR, `${slug}.png`);
  if (await exists(destination)) {
    return { path: destination, skipped: true };
  }

  // Prefer the 128px icon (retina quality); fall back to 64px if missing.
  for (const size of [128, 64]) {
    try {
      const buffer = await fetchBuffer(iconUrl(slug, size));
      await writeFile(destination, buffer);
      return { path: destination, size, skipped: false };
    } catch (error) {
      if (size === 64) throw error;
    }
  }
  throw new Error(`Could not download icon for ${slug}`);
}

function stripHtml(input) {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseIntro(html) {
  // "Why do it?" block sits inside the main section-box as the first <p>
  // immediately after the "Why do it?" heading.
  const match = html.match(
    /<h2[^>]*>\s*Why do it\?\s*<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
  );
  return match ? stripHtml(match[1]) : null;
}

function parseFormCheck(html) {
  // Pull all <span>X</span> children of the "Form Check" tag cluster.
  const block = html.match(
    /<h2[^>]*>\s*Form Check\s*<\/h2>[\s\S]*?<div class="tags[^"]*">([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  if (!block) return [];
  const tagRegex = /<span class="tag">[\s\S]*?<span>([^<]+)<\/span>\s*<\/span>/g;
  const items = [];
  let match;
  while ((match = tagRegex.exec(block[1])) !== null) {
    items.push(stripHtml(match[1]));
  }
  return items;
}

function parseSteps(html) {
  // Extract the Instructions section, then walk each <ol>/<picture> pair in
  // document order. Each <ol> may span multiple <li> steps that share one
  // image. Instructions rendering on strengthlevel.com alternates ol/picture
  // inside `.column.is-half` blocks; we flatten to a single ordered list
  // while keeping the ol -> image association.
  const section = html.match(
    /<h2[^>]*>\s*Instructions\s*<\/h2>([\s\S]*?)<div class="notification">/i,
  );
  if (!section) return [];

  const steps = [];
  const sectionHtml = section[1];
  const columnRegex =
    /<ol class="[^"]*instructions[^"]*"[^>]*>([\s\S]*?)<\/ol>[\s\S]*?<picture[^>]*>([\s\S]*?)<\/picture>/g;

  let groupMatch;
  while ((groupMatch = columnRegex.exec(sectionHtml)) !== null) {
    const [, olHtml, pictureHtml] = groupMatch;
    const imgMatch = pictureHtml.match(/<img[^>]+src="([^"]+)"/);
    const imageUrl = imgMatch ? imgMatch[1] : null;

    const liRegex = /<li>([\s\S]*?)<\/li>/g;
    let liMatch;
    while ((liMatch = liRegex.exec(olHtml)) !== null) {
      steps.push({
        text: stripHtml(liMatch[1]),
        imageUrl,
      });
    }
  }
  return steps;
}

async function downloadStepImage(slug, index, imageUrl) {
  const destDir = path.join(HOWTO_DIR, slug);
  await mkdir(destDir, { recursive: true });
  const destination = path.join(destDir, `step-${index}.jpg`);
  if (await exists(destination)) {
    return { path: destination, skipped: true };
  }
  const buffer = await fetchBuffer(imageUrl);
  await writeFile(destination, buffer);
  return { path: destination, skipped: false };
}

async function fetchGuide(slug) {
  const url = `https://strengthlevel.com/exercises/${slug}`;
  const { redirected, text } = await fetchText(url, { allowRedirect: false });
  if (redirected) {
    return { guide: null, imagesDownloaded: 0, imagesSkipped: 0 };
  }

  const intro = parseIntro(text);
  const formCheck = parseFormCheck(text);
  const rawSteps = parseSteps(text);
  if (rawSteps.length === 0 && !intro) {
    return { guide: null, imagesDownloaded: 0, imagesSkipped: 0 };
  }

  // Dedupe identical image URLs so steps sharing one picture point at the
  // same downloaded file.
  let downloaded = 0;
  let skipped = 0;
  const urlToLocal = new Map();
  const steps = [];
  for (let i = 0; i < rawSteps.length; i += 1) {
    const { text: stepText, imageUrl } = rawSteps[i];
    let imagePath = null;
    if (imageUrl) {
      let localPath = urlToLocal.get(imageUrl);
      if (!localPath) {
        const result = await downloadStepImage(slug, i + 1, imageUrl);
        if (result.skipped) skipped += 1;
        else downloaded += 1;
        localPath = `/exercises/howto/${slug}/step-${i + 1}.jpg`;
        urlToLocal.set(imageUrl, localPath);
      }
      imagePath = localPath;
    }
    steps.push({ text: stepText, imagePath });
  }

  return {
    guide: {
      url,
      intro,
      formCheck,
      steps,
    },
    imagesDownloaded: downloaded,
    imagesSkipped: skipped,
  };
}

async function main() {
  const standardsOnlyRaw = process.argv.find((arg) =>
    arg.startsWith("--standards-only="),
  );
  if (standardsOnlyRaw) {
    const slug = standardsOnlyRaw.slice("--standards-only=".length).trim();
    if (!slug) {
      console.error("Missing slug after --standards-only=");
      process.exit(1);
    }
    const standards = await fetchStandards(slug);
    console.log(JSON.stringify(standards, null, 2));
    process.exit(0);
  }

  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(HOWTO_DIR, { recursive: true });

  console.log(`Fetching ${SOURCE_URL}`);
  const { text: html } = await fetchText(SOURCE_URL);
  const cards = parseExerciseCards(html);
  const { categoryMap, categoryOrder } = parseCategorizedList(html);

  console.log(`Fetching ${SITEMAP_URL}`);
  const sitemapSlugs = await fetchSitemapSlugs();

  const allSlugs = new Set([
    ...cards.keys(),
    ...categoryMap.keys(),
    ...sitemapSlugs,
  ]);
  console.log(
    `Discovered ${allSlugs.size} exercises (index: ${cards.size}, sitemap: ${sitemapSlugs.size})`,
  );

  const exercises = [];
  let iconsDownloaded = 0;
  let iconsSkipped = 0;
  let iconsMissing = 0;
  let guidesWithSteps = 0;
  let guidesMissing = 0;
  let stepImagesDownloaded = 0;
  let stepImagesSkipped = 0;
  let standardsWithData = 0;
  let standardsMissing = 0;

  for (const slug of allSlugs) {
    const card = cards.get(slug);
    const meta = categoryMap.get(slug);
    let name = card?.name ?? meta?.name ?? null;
    const category = meta?.category ?? null;

    process.stdout.write(`  ${slug} ... `);

    // Sitemap-only slugs don't have a display name yet — pull it from the
    // standards page <h1>. Falls back to a title-cased slug on failure.
    if (!name) {
      name = (await fetchStandardsName(slug)) ?? slug.replace(/-/g, " ");
    }

    process.stdout.write("icon ");
    let iconResult;
    try {
      iconResult = await downloadIcon(slug);
      if (iconResult.skipped) iconsSkipped += 1;
      else iconsDownloaded += 1;
      process.stdout.write(iconResult.skipped ? "cached" : `ok(${iconResult.size}px)`);
    } catch {
      iconsMissing += 1;
      process.stdout.write("missing");
      console.log(" - skipping");
      continue;
    }

    process.stdout.write(" | standards ");
    let standards = null;
    try {
      standards = await fetchStandards(slug);
      if (standards) {
        standardsWithData += 1;
        process.stdout.write("ok");
      } else {
        standardsMissing += 1;
        process.stdout.write("none");
      }
    } catch (error) {
      standardsMissing += 1;
      process.stdout.write(`fail (${error.message})`);
    }

    process.stdout.write(" | guide ");
    let guide = null;
    try {
      const guideResult = await fetchGuide(slug);
      guide = guideResult.guide;
      stepImagesDownloaded += guideResult.imagesDownloaded;
      stepImagesSkipped += guideResult.imagesSkipped;
      if (guide) {
        guidesWithSteps += 1;
        process.stdout.write(
          `ok(${guide.steps.length} steps, ${guideResult.imagesDownloaded} dl, ${guideResult.imagesSkipped} cache)`,
        );
      } else {
        guidesMissing += 1;
        process.stdout.write("none");
      }
    } catch (error) {
      guidesMissing += 1;
      process.stdout.write(`fail (${error.message})`);
    }
    console.log();

    exercises.push({
      slug,
      name,
      category,
      iconPath: `/exercises/icons/${slug}.png`,
      pageUrl: `https://strengthlevel.com/strength-standards/${slug}`,
      standards,
      guide,
    });
  }

  exercises.sort((a, b) => a.name.localeCompare(b.name));

  const payload = {
    source: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    categories: categoryOrder,
    count: exercises.length,
    exercises,
  };

  await writeFile(JSON_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `\nWrote ${JSON_PATH} (${exercises.length} exercises)\n` +
      `  icons: ${iconsDownloaded} downloaded, ${iconsSkipped} cached, ${iconsMissing} missing (skipped)\n` +
      `  standards: ${standardsWithData} parsed, ${standardsMissing} missing\n` +
      `  guides: ${guidesWithSteps} with steps, ${guidesMissing} missing\n` +
      `  step images: ${stepImagesDownloaded} downloaded, ${stepImagesSkipped} cached`,
  );
}

const SCRAPER_ENTRY = path.normalize(fileURLToPath(import.meta.url));
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.normalize(process.argv[1]) === SCRAPER_ENTRY;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
