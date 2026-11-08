#!/usr/bin/env node
// Generate motorcycle road-distance isochrones (isodistance polygons) for a
// branch dataset, via the self-hosted graphhopper-bd server.
//
// For every branch {lat, lon, max_distance_km} it queries GraphHopper's
// /isochrone endpoint with isochrone_type=distance so the polygon covers every
// point reachable within max_distance_km of ROUTE distance by motorcycle in
// all directions (not straight-line radius).
//
// Usage:
//   node scripts/generate-isochrones.mjs data/brac_branches.json
//   node scripts/generate-isochrones.mjs data/brac_branches.json --out data/custom.geojson
//
// Options:
//   --out <file>        Output GeoJSON path (default: data/<input-stem>_isochrones.geojson)
//   --profile <name>    GraphHopper profile (default: motorcycle)
//   --concurrency <n>   Parallel isochrone requests (default: 3)
//
// Env:
//   GRAPHHOPPER_URL     GraphHopper base URL (default: http://localhost:8989).
//                       Only this script needs it — billing itself classifies
//                       via the generated file, no routing server required.
//
// Input: a branch file like data/brac_branches.json — either
// {branches: [...]} or a bare array. Each branch needs lat, lon and
// max_distance_km; id/branch_name/district/area/category are carried into the
// output properties when present.
//
// Output: GeoJSON FeatureCollection — one Polygon feature per branch with the
// branch metadata as properties, written to the dashboard's data/ dir so it
// can be consumed the same way as data/dhaka_city_corporation.geojson.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_URL = (
  process.env.GRAPHHOPPER_URL ?? "http://localhost:8989"
).replace(/\/+$/, "");

const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const inputFile = args.find((a) => !a.startsWith("--"));
if (!inputFile) {
  console.error("Usage: node scripts/generate-isochrones.mjs <branches.json> [--out file.geojson]");
  process.exit(2);
}
const inPath = path.resolve(inputFile);
const outPath = path.resolve(
  argValue("--out") ??
    path.join(
      path.dirname(inPath),
      `${path.basename(inPath).replace(/\.json$/i, "")}_isochrones.geojson`,
    ),
);
const profile = argValue("--profile") ?? "motorcycle";
const concurrency = Number(argValue("--concurrency") ?? 3);

const REQUEST_TIMEOUT_MS = 120_000;
const RETRIES = 3;

async function fetchIsochrone(branch) {
  const url =
    `${BASE_URL}/isochrone?point=${branch.lat},${branch.lon}` +
    `&profile=${encodeURIComponent(profile)}&buckets=1` +
    `&distance_limit=${Math.round(branch.max_distance_km * 1000)}`;

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // GraphHopper puts the useful detail in the JSON body's message
        const detail = body?.message ?? body;
        // 4xx = bad request (unsnappable point etc.) — retrying won't help
        if (response.status < 500) {
          throw new NonRetryable(
            `HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
          );
        }
        throw new Error(`HTTP ${response.status}: ${detail ?? "(no body)"}`);
      }
      const feature = body?.polygons?.[0];
      if (!feature?.geometry) {
        throw new NonRetryable("response contained no polygon");
      }
      return feature.geometry;
    } catch (error) {
      if (error instanceof NonRetryable) throw error;
      lastError = error;
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

class NonRetryable extends Error {}

/** GeoJSON rings must be closed; GH closes them but be defensive. */
function closeRings(geometry) {
  const coordinates = geometry.coordinates;
  if (geometry.type === "Polygon") {
    for (const ring of coordinates) {
      const [first] = ring;
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    }
  }
  return geometry;
}

function branchProperties(branch, source) {
  const props = {
    branch_id: branch.id,
    branch_name: branch.branch_name,
    max_distance_km: branch.max_distance_km,
    max_distance_m: Math.round(branch.max_distance_km * 1000),
    center: [branch.lon, branch.lat],
  };
  for (const key of ["district", "area", "category"]) {
    if (branch[key] != null) props[key] = branch[key];
  }
  if (source.org_uuid != null) props.org_uuid = source.org_uuid;
  if (source.org_name != null) props.org_name = source.org_name;
  return props;
}

async function main() {
  const startedAt = Date.now();

  // fail fast if the routing server isn't up
  const health = await fetch(`${BASE_URL}/health`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!health?.ok) {
    console.error(
      `GraphHopper is not reachable at ${BASE_URL} — start it with: cd ../graphhopper-bd && docker compose up -d`,
    );
    process.exit(1);
  }
  const info = await fetch(`${BASE_URL}/info`).then((r) => r.json());
  if (!info.profiles?.some((p) => p.name === profile)) {
    console.error(
      `Profile "${profile}" not found on server (available: ${info.profiles.map((p) => p.name).join(", ")})`,
    );
    process.exit(1);
  }

  const source = JSON.parse(await readFile(inPath, "utf8"));
  const branches = Array.isArray(source) ? source : source.branches;
  if (!Array.isArray(branches) || branches.length === 0) {
    console.error(`${inPath} contains no branches array`);
    process.exit(1);
  }

  const features = [];
  const failures = [];
  let skipped = 0;
  let nextIndex = 0;
  let done = 0;

  async function worker() {
    while (nextIndex < branches.length) {
      const branch = branches[nextIndex++];
      done++;
      const label = branch.branch_name ?? `branch ${branch.id}`;
      if (
        typeof branch.lat !== "number" ||
        typeof branch.lon !== "number" ||
        typeof branch.max_distance_km !== "number"
      ) {
        skipped++;
        failures.push({ branch: label, error: "missing lat/lon/max_distance_km" });
        continue;
      }
      const t0 = Date.now();
      try {
        const geometry = closeRings(await fetchIsochrone(branch));
        features.push({ type: "Feature", properties: branchProperties(branch, source), geometry });
        console.log(`[${done}/${branches.length}] ${label} — ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (error) {
        failures.push({ branch: label, error: String(error.message ?? error) });
        console.error(`[${label}] FAILED: ${error.message ?? error}`);
      }
    }
  }

  console.log(
    `Generating isochrones for ${branches.length} branches ` +
      `(profile=${profile}, server=${BASE_URL}) → ${path.relative(process.cwd(), outPath)}`,
  );
  await Promise.all(Array.from({ length: concurrency }, worker));

  const collection = {
    type: "FeatureCollection",
    // foreign members for provenance — legal in GeoJSON, ignored by consumers
    org_name: source.org_name,
    org_uuid: source.org_uuid,
    generated_at: new Date().toISOString(),
    generated_by: `scripts/generate-isochrones.mjs (graphhopper-bd ${info.version}, profile=${profile}, distance isochrone)`,
    source_file: path.relative(path.dirname(outPath), inPath),
    features,
  };

  await writeFile(outPath, JSON.stringify(collection));
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nDone in ${seconds}s: ${features.length} polygons, ${failures.length - skipped} failed` +
      `${skipped ? `, ${skipped} skipped (bad input)` : ""} → ${outPath}`,
  );
  if (failures.length > skipped) {
    console.error("\nFailed branches:");
    for (const f of failures.slice(skipped)) console.error(`  - ${f.branch}: ${f.error}`);
    process.exit(1);
  }
}

await main();
