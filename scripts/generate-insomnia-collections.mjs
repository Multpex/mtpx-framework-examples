#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(scriptDir, "..");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toGraphqlLiteral(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => toGraphqlLiteral(item)).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).map(([key, nested]) => `${key}: ${toGraphqlLiteral(nested)}`);
    return `{ ${entries.join(", ")} }`;
  }
  return "null";
}

function stripVariableDefinitions(query) {
  return query.replace(
    /^(\s*(?:query|mutation|subscription)\b(?:\s+[A-Za-z_][A-Za-z0-9_]*)?)\s*\([\s\S]*?\)\s*\{/,
    "$1 {",
  );
}

function parseVariables(rawVariables) {
  if (!rawVariables) return null;
  if (typeof rawVariables === "object") return rawVariables;
  if (typeof rawVariables !== "string") return null;
  const trimmed = rawVariables.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function inlineVariables(query, variables) {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    return query;
  }

  const keys = Object.keys(variables);
  if (keys.length === 0) return query;

  let output = stripVariableDefinitions(query);
  for (const key of keys.sort((a, b) => b.length - a.length)) {
    const literal = toGraphqlLiteral(variables[key]);
    output = output.replace(new RegExp(`\\$${escapeRegExp(key)}\\b`, "g"), literal);
  }
  return output;
}

function ensureGraphqlContentType(headers) {
  const normalized = Array.isArray(headers) ? headers : [];
  const existing = normalized.find(
    (header) => String(header?.key ?? "").toLowerCase() === "content-type",
  );
  if (existing) {
    existing.value = "application/graphql";
    return normalized;
  }
  normalized.push({ key: "Content-Type", value: "application/graphql" });
  return normalized;
}

function extractGraphqlFromRequest(request) {
  const body = request?.body;
  if (!body) return null;

  if (body.mode === "graphql" && body.graphql?.query) {
    return {
      query: body.graphql.query,
      variables: parseVariables(body.graphql.variables),
    };
  }

  if (body.mode === "raw" && typeof body.raw === "string") {
    const trimmed = body.raw.trim();
    if (!trimmed.startsWith("{")) return null;

    try {
      const payload = JSON.parse(trimmed);
      if (typeof payload?.query === "string") {
        return {
          query: payload.query,
          variables: parseVariables(payload.variables),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function transformItems(items, stats) {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (Array.isArray(item?.item)) {
      transformItems(item.item, stats);
      continue;
    }

    const request = item?.request;
    if (!request) continue;

    const gql = extractGraphqlFromRequest(request);
    if (!gql) continue;

    const query = inlineVariables(gql.query, gql.variables);
    request.header = ensureGraphqlContentType(request.header);
    request.body = { mode: "raw", raw: query };
    stats.requests += 1;
  }
}

function transformCollection(collection) {
  const out = JSON.parse(JSON.stringify(collection));
  const stats = { requests: 0 };
  transformItems(out.item, stats);

  if (out.info?.name) {
    out.info.name = `${out.info.name} (Insomnia)`;
  }
  if (typeof out.info?.description === "string") {
    const note = "Generated for Insomnia import: GraphQL requests are sent as application/graphql raw body.";
    out.info.description = `${out.info.description}\n\n${note}`;
  }

  return { out, stats };
}

function main() {
  const allFiles = walk(examplesRoot);
  const collectionFiles = allFiles.filter(
    (file) =>
      file.endsWith(".postman_collection.json") &&
      !file.endsWith(".insomnia.postman_collection.json"),
  );
  const environmentFiles = allFiles.filter(
    (file) =>
      file.endsWith(".postman_environment.json") &&
      !file.endsWith(".insomnia.postman_environment.json"),
  );

  let transformedCollections = 0;
  let transformedRequests = 0;

  for (const file of collectionFiles) {
    const source = JSON.parse(fs.readFileSync(file, "utf8"));
    const { out, stats } = transformCollection(source);
    const outputFile = file.replace(
      /\.postman_collection\.json$/,
      ".insomnia.postman_collection.json",
    );
    fs.writeFileSync(outputFile, JSON.stringify(out, null, 2) + "\n");
    transformedCollections += 1;
    transformedRequests += stats.requests;
  }

  for (const file of environmentFiles) {
    const outputFile = file.replace(
      /\.postman_environment\.json$/,
      ".insomnia.postman_environment.json",
    );
    fs.copyFileSync(file, outputFile);
  }

  console.log(
    `Generated ${transformedCollections} Insomnia collections and ${environmentFiles.length} environments (${transformedRequests} GraphQL request(s) transformed).`,
  );
}

main();
